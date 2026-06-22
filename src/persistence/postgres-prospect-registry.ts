import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { excludeSourceDisallowedFacts } from "../business-context/source-compliance.js";
import { deriveSupportedClaims } from "../business-context/supported-claims.js";
import type {
  BusinessContext,
  BusinessContextFact,
  BusinessContextSource,
  BusinessContextStore,
  ExcludedResearchData,
  ResearchMode,
  SupportedClaim,
} from "../business-context/types.js";
import type {
  DiscoveryAppearance,
  DiscoveryRun,
  DiscoveryRunDetail,
  GooglePlaceResult,
  ProspectBusiness,
  ProspectBusinessDetail,
  ProspectRegistry,
  ProspectStatus,
  SearchLocation,
  StartDiscoveryRunInput,
  WorkflowFailure,
} from "../discovery/types.js";
import { derivePreviewEligibility } from "../website-assessment/preview-eligibility.js";
import type {
  PreviewEligibility,
  RecommendedPitchAngle,
  SaveWebsiteAssessmentInput,
  WebsiteAssessment,
  WebsiteAssessmentEvidence,
  WebsiteAssessmentStore,
  WebsiteDeterministicChecks,
  WebsiteScreenshotInput,
} from "../website-assessment/types.js";

type Queryable = Pool | PoolClient;

export class PostgresProspectRegistry
  implements ProspectRegistry, BusinessContextStore, WebsiteAssessmentStore
{
  constructor(private readonly pool: Pool) {}

  async createDiscoveryRun(input: StartDiscoveryRunInput): Promise<DiscoveryRun> {
    const discoveryRun: DiscoveryRun = {
      id: randomUUID(),
      source: "google_places",
      mode: input.mode,
      searchTerm: input.searchTerm,
      searchLocation: input.searchLocation,
      discoveryLimit: input.discoveryLimit,
      status: "running",
      queryMetadata: {
        mode: input.mode,
        searchTerm: input.searchTerm,
        searchLocation: input.searchLocation,
        discoveryLimit: input.discoveryLimit,
      },
      resultMetadata: {},
    };

    await this.pool.query(
      `insert into discovery_runs
        (id, source, mode, search_term, search_location, discovery_limit, status, query_metadata, result_metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        discoveryRun.id,
        discoveryRun.source,
        discoveryRun.mode,
        discoveryRun.searchTerm,
        discoveryRun.searchLocation,
        discoveryRun.discoveryLimit,
        discoveryRun.status,
        discoveryRun.queryMetadata,
        discoveryRun.resultMetadata,
      ],
    );

    return discoveryRun;
  }

  async recordDiscoveredProspect(input: {
    discoveryRunId: string;
    rank: number;
    place: GooglePlaceResult;
  }): Promise<ProspectBusiness> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const prospectBusiness = await this.upsertProspectBusiness(client, input.place);
      await client.query(
        `insert into discovery_appearances
          (discovery_run_id, prospect_business_id, rank, provider_payload)
         values ($1, $2, $3, $4)
         on conflict (discovery_run_id, prospect_business_id) do update
         set rank = excluded.rank,
             provider_payload = excluded.provider_payload,
             appeared_at = now()`,
        [input.discoveryRunId, prospectBusiness.id, input.rank, input.place.sourcePayload],
      );
      await client.query("commit");
      return prospectBusiness;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeDiscoveryRun(input: {
    discoveryRunId: string;
    providerResultCount: number;
    processedResultCount: number;
  }): Promise<void> {
    await this.pool.query(
      `update discovery_runs
       set status = 'completed',
           result_metadata = $2,
           updated_at = now()
       where id = $1`,
      [
        input.discoveryRunId,
        {
          providerResultCount: input.providerResultCount,
          processedResultCount: input.processedResultCount,
        },
      ],
    );
  }

  async failDiscoveryRun(input: {
    discoveryRunId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
  }): Promise<void> {
    await this.pool.query(
      `update discovery_runs
       set status = 'failed',
           result_metadata = $2,
           updated_at = now()
       where id = $1`,
      [input.discoveryRunId, { errorSummary: input.errorSummary }],
    );
    await this.pool.query(
      `insert into workflow_failures
        (id, discovery_run_id, failed_step, error_summary, retryable, operator_visible_status, provider)
       values ($1, $2, $3, $4, $5, 'visible', 'google_places')`,
      [randomUUID(), input.discoveryRunId, input.failedStep, input.errorSummary, input.retryable],
    );
  }

  async getDiscoveryRunDetail(discoveryRunId: string): Promise<DiscoveryRunDetail> {
    const discoveryRun = await this.getDiscoveryRun(discoveryRunId);
    const [appearancesResult, prospectsResult, failuresResult] = await Promise.all([
      this.pool.query(
        `select discovery_run_id, prospect_business_id, rank, provider_payload, appeared_at
         from discovery_appearances
         where discovery_run_id = $1
         order by rank asc`,
        [discoveryRunId],
      ),
      this.pool.query(
        `select p.*
         from prospect_businesses p
         join discovery_appearances a on a.prospect_business_id = p.id
         where a.discovery_run_id = $1
         order by a.rank asc`,
        [discoveryRunId],
      ),
      this.pool.query(
        `select id, discovery_run_id, failed_step, error_summary, retryable, operator_visible_status, provider
         from workflow_failures
         where discovery_run_id = $1
         order by created_at asc`,
        [discoveryRunId],
      ),
    ]);

    return {
      ...discoveryRun,
      appearances: appearancesResult.rows.map(mapAppearanceRow),
      discoveredProspects: prospectsResult.rows.map(mapProspectRow),
      workflowFailures: failuresResult.rows.map(mapWorkflowFailureRow),
    };
  }

  async listDiscoveryRuns(): Promise<DiscoveryRunDetail[]> {
    const result = await this.pool.query(
      `select id
       from discovery_runs
       order by created_at desc`,
    );
    return Promise.all(
      result.rows.map((row: { id: string }) => this.getDiscoveryRunDetail(row.id)),
    );
  }

  async getProspectBusinessDetail(prospectBusinessId: string): Promise<ProspectBusinessDetail> {
    const [prospectResult, appearancesResult] = await Promise.all([
      this.pool.query(
        `select *
         from prospect_businesses
         where id = $1`,
        [prospectBusinessId],
      ),
      this.pool.query(
        `select
           a.discovery_run_id,
           a.prospect_business_id,
           a.rank,
           a.provider_payload,
           a.appeared_at,
           d.id as run_id,
           d.source as run_source,
           d.mode as run_mode,
           d.search_term as run_search_term,
           d.search_location as run_search_location,
           d.discovery_limit as run_discovery_limit,
           d.status as run_status,
           d.query_metadata as run_query_metadata,
           d.result_metadata as run_result_metadata
         from discovery_appearances a
         join discovery_runs d on d.id = a.discovery_run_id
         where a.prospect_business_id = $1
         order by a.appeared_at asc, d.created_at asc`,
        [prospectBusinessId],
      ),
    ]);

    const prospectBusiness = prospectResult.rows[0];
    if (!prospectBusiness) {
      throw new Error(`Prospect Business not found: ${prospectBusinessId}`);
    }

    const appearanceHistory = appearancesResult.rows.map(mapAppearanceDetailRow);
    if (appearanceHistory.length === 0) {
      throw new Error(`Discovery Appearances not found for Prospect Business: ${prospectBusinessId}`);
    }

    return {
      ...mapProspectRow(prospectBusiness),
      firstDiscoveredRun: appearanceHistory[0]!.discoveryRun,
      latestDiscoveredRun: appearanceHistory[appearanceHistory.length - 1]!.discoveryRun,
      appearanceHistory,
      businessContext: await this.getBusinessContext(prospectBusinessId),
      websiteAssessment: await this.getWebsiteAssessment(prospectBusinessId),
    };
  }

  async saveWebsiteAssessment(input: SaveWebsiteAssessmentInput): Promise<WebsiteAssessment> {
    const previewEligibility = derivePreviewEligibility({
      opportunityCategory: input.reviewerOutput.opportunityCategory,
      override: input.previewEligibilityOverride,
    });
    const websiteAssessment: WebsiteAssessment = {
      id: randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      currentWebsiteUrl: input.input.currentWebsiteUrl,
      htmlText: input.input.htmlText,
      deterministicChecks: input.input.deterministicChecks,
      desktopScreenshot: input.input.desktopScreenshot,
      mobileScreenshot: input.input.mobileScreenshot,
      opportunityCategory: input.reviewerOutput.opportunityCategory,
      confidence: input.reviewerOutput.confidence,
      summary: input.reviewerOutput.summary,
      evidence: input.reviewerOutput.evidence,
      recommendedPitchAngle: input.reviewerOutput.recommendedPitchAngle,
      safeClaims: input.reviewerOutput.outreachSafeClaims,
      reviewNotes: input.reviewerOutput.operatorReviewNotes,
      previewEligibility,
      assessedAt: input.assessedAt ?? new Date(),
    };
    const prospectStatus = previewEligibility.effectiveEligible
      ? "assessment_complete"
      : "not_preview_eligible";

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into website_assessments
          (
            id,
            prospect_business_id,
            current_website_url,
            html_text,
            deterministic_checks,
            desktop_screenshot,
            mobile_screenshot,
            opportunity_category,
            confidence,
            summary,
            evidence,
            recommended_pitch_angle,
            safe_claims,
            review_notes,
            preview_eligibility,
            assessed_at
          )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (prospect_business_id) do update
         set current_website_url = excluded.current_website_url,
             html_text = excluded.html_text,
             deterministic_checks = excluded.deterministic_checks,
             desktop_screenshot = excluded.desktop_screenshot,
             mobile_screenshot = excluded.mobile_screenshot,
             opportunity_category = excluded.opportunity_category,
             confidence = excluded.confidence,
             summary = excluded.summary,
             evidence = excluded.evidence,
             recommended_pitch_angle = excluded.recommended_pitch_angle,
             safe_claims = excluded.safe_claims,
             review_notes = excluded.review_notes,
             preview_eligibility = excluded.preview_eligibility,
             assessed_at = excluded.assessed_at`,
        [
          websiteAssessment.id,
          websiteAssessment.prospectBusinessId,
          websiteAssessment.currentWebsiteUrl,
          websiteAssessment.htmlText,
          JSON.stringify(websiteAssessment.deterministicChecks),
          optionalJson(websiteAssessment.desktopScreenshot),
          optionalJson(websiteAssessment.mobileScreenshot),
          websiteAssessment.opportunityCategory,
          websiteAssessment.confidence,
          websiteAssessment.summary,
          JSON.stringify(websiteAssessment.evidence),
          websiteAssessment.recommendedPitchAngle,
          JSON.stringify(websiteAssessment.safeClaims),
          JSON.stringify(websiteAssessment.reviewNotes),
          JSON.stringify(websiteAssessment.previewEligibility),
          websiteAssessment.assessedAt,
        ],
      );
      await client.query(
        `update prospect_businesses
         set prospect_status = $2,
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId, prospectStatus],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return websiteAssessment;
  }

  async overridePreviewEligibility(input: {
    prospectBusinessId: string;
    eligible: boolean;
    reason: string;
    actor: string;
    overriddenAt?: Date;
  }): Promise<WebsiteAssessment> {
    const existingAssessment = await this.getWebsiteAssessment(input.prospectBusinessId);
    if (!existingAssessment) {
      throw new Error(`Website Assessment not found: ${input.prospectBusinessId}`);
    }

    const previewEligibility = derivePreviewEligibility({
      opportunityCategory: existingAssessment.opportunityCategory,
      override: {
        eligible: input.eligible,
        reason: input.reason,
        actor: input.actor,
        overriddenAt: input.overriddenAt ?? new Date(),
      },
    });
    const prospectStatus = previewEligibility.effectiveEligible
      ? "assessment_complete"
      : "not_preview_eligible";

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update website_assessments
         set preview_eligibility = $2
         where prospect_business_id = $1`,
        [input.prospectBusinessId, JSON.stringify(previewEligibility)],
      );
      await client.query(
        `update prospect_businesses
         set prospect_status = $2,
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId, prospectStatus],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return {
      ...existingAssessment,
      previewEligibility,
    };
  }

  async getWebsiteAssessment(prospectBusinessId: string): Promise<WebsiteAssessment | undefined> {
    const result = await this.pool.query(
      `select *
       from website_assessments
       where prospect_business_id = $1`,
      [prospectBusinessId],
    );
    const row = result.rows[0];
    return row ? mapWebsiteAssessmentRow(row) : undefined;
  }

  async saveBusinessContext(input: {
    prospectBusinessId: string;
    researchMode: ResearchMode;
    sources: Array<Omit<BusinessContextSource, "id" | "prospectBusinessId" | "retrievedAt"> & {
      id?: string;
      retrievedAt?: Date;
    }>;
    facts: Array<Omit<BusinessContextFact, "id" | "prospectBusinessId"> & { id?: string }>;
    excludedResearchData: Array<
      Omit<ExcludedResearchData, "id" | "prospectBusinessId" | "excludedAt"> & {
        id?: string;
        excludedAt?: Date;
      }
    >;
  }): Promise<BusinessContext> {
    const filteredContext = excludeSourceDisallowedFacts({
      sources: input.sources,
      facts: input.facts,
      excludedResearchData: input.excludedResearchData,
    });
    const sources = input.sources.map((source) => ({
      ...source,
      id: source.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      retrievedAt: source.retrievedAt ?? new Date(),
    }));
    const facts = filteredContext.facts.map((fact) => ({
      ...fact,
      id: fact.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
    }));
    const excludedResearchData = filteredContext.excludedResearchData.map((excluded) => ({
      ...excluded,
      id: excluded.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      excludedAt: excluded.excludedAt ?? new Date(),
    }));
    const supportedClaims = deriveSupportedClaims({
      prospectBusinessId: input.prospectBusinessId,
      sources,
      facts,
    });

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from supported_claims where prospect_business_id = $1", [
        input.prospectBusinessId,
      ]);
      await client.query("delete from excluded_research_data where prospect_business_id = $1", [
        input.prospectBusinessId,
      ]);
      await client.query("delete from business_context_facts where prospect_business_id = $1", [
        input.prospectBusinessId,
      ]);
      await client.query("delete from business_context_sources where prospect_business_id = $1", [
        input.prospectBusinessId,
      ]);

      for (const source of sources) {
        await client.query(
          `insert into business_context_sources
            (id, prospect_business_id, research_mode, source_type, title, url, retrieved_at, terms_compliance)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            source.id,
            source.prospectBusinessId,
            input.researchMode,
            source.sourceType,
            source.title,
            source.url,
            source.retrievedAt,
            source.termsCompliance,
          ],
        );
      }

      for (const fact of facts) {
        await client.query(
          `insert into business_context_facts
            (id, prospect_business_id, source_id, label, value, source_quote, allowed_for_generation)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            fact.id,
            fact.prospectBusinessId,
            fact.sourceId,
            fact.label,
            fact.value,
            fact.sourceQuote,
            fact.allowedForGeneration,
          ],
        );
      }

      for (const excluded of excludedResearchData) {
        await client.query(
          `insert into excluded_research_data
            (id, prospect_business_id, source_id, label, value_summary, reason, excluded_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            excluded.id,
            excluded.prospectBusinessId,
            excluded.sourceId,
            excluded.label,
            excluded.valueSummary,
            excluded.reason,
            excluded.excludedAt,
          ],
        );
      }

      for (const claim of supportedClaims) {
        await client.query(
          `insert into supported_claims
            (id, prospect_business_id, statement, evidence, allowed_for_generation)
           values ($1, $2, $3, $4, $5)`,
          [
            claim.id,
            claim.prospectBusinessId,
            claim.statement,
            claim.evidence,
            claim.allowedForGeneration,
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return {
      prospectBusinessId: input.prospectBusinessId,
      researchMode: input.researchMode,
      sources,
      facts,
      excludedResearchData,
      supportedClaims,
    };
  }

  private async getDiscoveryRun(discoveryRunId: string): Promise<DiscoveryRun> {
    const result = await this.pool.query(
      `select *
       from discovery_runs
       where id = $1`,
      [discoveryRunId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Discovery Run not found: ${discoveryRunId}`);
    }
    return mapDiscoveryRunRow(row);
  }

  private async getBusinessContext(prospectBusinessId: string): Promise<BusinessContext | undefined> {
    const [sourcesResult, factsResult, excludedResult, claimsResult] = await Promise.all([
      this.pool.query(
        `select id, prospect_business_id, research_mode, source_type, title, url, retrieved_at, terms_compliance
         from business_context_sources
         where prospect_business_id = $1
         order by retrieved_at asc, id asc`,
        [prospectBusinessId],
      ),
      this.pool.query(
        `select id, prospect_business_id, source_id, label, value, source_quote, allowed_for_generation
         from business_context_facts
         where prospect_business_id = $1
         order by source_id asc, created_at asc, id asc`,
        [prospectBusinessId],
      ),
      this.pool.query(
        `select id, prospect_business_id, source_id, label, value_summary, reason, excluded_at
         from excluded_research_data
         where prospect_business_id = $1
         order by excluded_at asc, id asc`,
        [prospectBusinessId],
      ),
      this.pool.query(
        `select id, prospect_business_id, statement, evidence, allowed_for_generation
         from supported_claims
         where prospect_business_id = $1
         order by created_at asc, id asc`,
        [prospectBusinessId],
      ),
    ]);

    if (sourcesResult.rows.length === 0) {
      return undefined;
    }

    return {
      prospectBusinessId,
      researchMode: sourcesResult.rows[0].research_mode,
      sources: sourcesResult.rows.map(mapBusinessContextSourceRow),
      facts: factsResult.rows.map(mapBusinessContextFactRow),
      excludedResearchData: excludedResult.rows.map(mapExcludedResearchDataRow),
      supportedClaims: claimsResult.rows.map(mapSupportedClaimRow),
    };
  }

  private async upsertProspectBusiness(
    client: Queryable,
    place: GooglePlaceResult,
  ): Promise<ProspectBusiness> {
    const result = await client.query(
      `insert into prospect_businesses
        (id, google_place_id, name, formatted_address, latitude, longitude, website_url, phone_number, categories, prospect_status, source_data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'discovered', $10)
       on conflict (google_place_id) do update
       set name = excluded.name,
           formatted_address = excluded.formatted_address,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           website_url = excluded.website_url,
           phone_number = excluded.phone_number,
           categories = excluded.categories,
           source_data = excluded.source_data,
           last_seen_at = now(),
           updated_at = now()
       returning *`,
      [
        randomUUID(),
        place.googlePlaceId,
        place.name,
        place.formattedAddress,
        place.latitude,
        place.longitude,
        place.websiteUrl,
        place.phoneNumber,
        place.categories,
        place.sourcePayload,
      ],
    );

    return mapProspectRow(result.rows[0]);
  }
}

function mapDiscoveryRunRow(row: {
  id: string;
  source: "google_places";
  mode: "place_search" | "radius_search";
  search_term: string;
  search_location: SearchLocation;
  discovery_limit: number;
  status: "running" | "completed" | "failed";
  query_metadata: Record<string, unknown>;
  result_metadata: Record<string, unknown>;
}): DiscoveryRun {
  return {
    id: row.id,
    source: row.source,
    mode: row.mode,
    searchTerm: row.search_term,
    searchLocation: row.search_location,
    discoveryLimit: row.discovery_limit,
    status: row.status,
    queryMetadata: row.query_metadata,
    resultMetadata: row.result_metadata,
  };
}

function mapProspectRow(row: {
  id: string;
  google_place_id: string;
  name: string;
  formatted_address?: string;
  latitude?: number;
  longitude?: number;
  website_url?: string;
  phone_number?: string;
  categories: string[];
  prospect_status: ProspectStatus;
  source_data: unknown;
  first_seen_at: Date;
  last_seen_at: Date;
}): ProspectBusiness {
  return {
    id: row.id,
    googlePlaceId: row.google_place_id,
    name: row.name,
    formattedAddress: row.formatted_address,
    latitude: row.latitude,
    longitude: row.longitude,
    websiteUrl: row.website_url,
    phoneNumber: row.phone_number,
    categories: row.categories,
    prospectStatus: row.prospect_status,
    sourceData: row.source_data,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapWebsiteAssessmentRow(row: {
  id: string;
  prospect_business_id: string;
  current_website_url?: string;
  html_text?: string;
  deterministic_checks: WebsiteDeterministicChecks;
  desktop_screenshot?: WebsiteScreenshotInput | SerializedWebsiteScreenshotInput;
  mobile_screenshot?: WebsiteScreenshotInput | SerializedWebsiteScreenshotInput;
  opportunity_category: WebsiteAssessment["opportunityCategory"];
  confidence: number;
  summary: string;
  evidence: WebsiteAssessmentEvidence[];
  recommended_pitch_angle: RecommendedPitchAngle;
  safe_claims: string[];
  review_notes: string[];
  preview_eligibility: PreviewEligibility | SerializedPreviewEligibility;
  assessed_at: Date;
}): WebsiteAssessment {
  const deterministicChecks = parseJsonb<WebsiteDeterministicChecks>(row.deterministic_checks);
  const desktopScreenshot = parseJsonb<
    WebsiteScreenshotInput | SerializedWebsiteScreenshotInput | undefined
  >(row.desktop_screenshot);
  const mobileScreenshot = parseJsonb<
    WebsiteScreenshotInput | SerializedWebsiteScreenshotInput | undefined
  >(row.mobile_screenshot);
  const previewEligibility = parseJsonb<PreviewEligibility | SerializedPreviewEligibility>(
    row.preview_eligibility,
  );

  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    currentWebsiteUrl: row.current_website_url,
    htmlText: row.html_text,
    deterministicChecks,
    desktopScreenshot: deserializeScreenshot(desktopScreenshot),
    mobileScreenshot: deserializeScreenshot(mobileScreenshot),
    opportunityCategory: row.opportunity_category,
    confidence: row.confidence,
    summary: row.summary,
    evidence: parseJsonb<WebsiteAssessmentEvidence[]>(row.evidence),
    recommendedPitchAngle: row.recommended_pitch_angle,
    safeClaims: parseJsonb<string[]>(row.safe_claims),
    reviewNotes: parseJsonb<string[]>(row.review_notes),
    previewEligibility: deserializePreviewEligibility(previewEligibility),
    assessedAt: row.assessed_at,
  };
}

type SerializedWebsiteScreenshotInput = Omit<WebsiteScreenshotInput, "capturedAt"> & {
  capturedAt: string;
};

type SerializedPreviewEligibility = Omit<PreviewEligibility, "override"> & {
  override?: Omit<NonNullable<PreviewEligibility["override"]>, "overriddenAt"> & {
    overriddenAt: string;
  };
};

function deserializeScreenshot(
  screenshot?: WebsiteScreenshotInput | SerializedWebsiteScreenshotInput,
): WebsiteScreenshotInput | undefined {
  if (!screenshot) {
    return undefined;
  }

  return {
    ...screenshot,
    capturedAt:
      screenshot.capturedAt instanceof Date
        ? screenshot.capturedAt
        : new Date(screenshot.capturedAt),
  };
}

function deserializePreviewEligibility(
  previewEligibility: PreviewEligibility | SerializedPreviewEligibility,
): PreviewEligibility {
  return {
    ...previewEligibility,
    override: previewEligibility.override
      ? {
          ...previewEligibility.override,
          overriddenAt:
            previewEligibility.override.overriddenAt instanceof Date
              ? previewEligibility.override.overriddenAt
              : new Date(previewEligibility.override.overriddenAt),
        }
      : undefined,
  };
}

function optionalJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function parseJsonb<T>(value: T | string | undefined): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

function mapAppearanceRow(row: {
  discovery_run_id: string;
  prospect_business_id: string;
  rank: number;
  provider_payload: unknown;
  appeared_at: Date;
}): DiscoveryAppearance {
  return {
    discoveryRunId: row.discovery_run_id,
    prospectBusinessId: row.prospect_business_id,
    rank: row.rank,
    providerPayload: row.provider_payload,
    appearedAt: row.appeared_at,
  };
}

function mapAppearanceDetailRow(row: {
  discovery_run_id: string;
  prospect_business_id: string;
  rank: number;
  provider_payload: unknown;
  appeared_at: Date;
  run_id: string;
  run_source: "google_places";
  run_mode: "place_search" | "radius_search";
  run_search_term: string;
  run_search_location: SearchLocation;
  run_discovery_limit: number;
  run_status: "running" | "completed" | "failed";
  run_query_metadata: Record<string, unknown>;
  run_result_metadata: Record<string, unknown>;
}): DiscoveryAppearance & { discoveryRun: DiscoveryRun } {
  return {
    ...mapAppearanceRow(row),
    discoveryRun: mapDiscoveryRunRow({
      id: row.run_id,
      source: row.run_source,
      mode: row.run_mode,
      search_term: row.run_search_term,
      search_location: row.run_search_location,
      discovery_limit: row.run_discovery_limit,
      status: row.run_status,
      query_metadata: row.run_query_metadata,
      result_metadata: row.run_result_metadata,
    }),
  };
}

function mapWorkflowFailureRow(row: {
  id: string;
  discovery_run_id: string;
  failed_step: string;
  error_summary: string;
  retryable: boolean;
  operator_visible_status: string;
  provider: "google_places";
}): WorkflowFailure {
  return {
    id: row.id,
    discoveryRunId: row.discovery_run_id,
    failedStep: row.failed_step,
    errorSummary: row.error_summary,
    retryable: row.retryable,
    operatorVisibleStatus: row.operator_visible_status,
    provider: row.provider,
  };
}

function mapBusinessContextSourceRow(row: {
  id: string;
  prospect_business_id: string;
  source_type: BusinessContextSource["sourceType"];
  title?: string;
  url?: string;
  retrieved_at: Date;
  terms_compliance: BusinessContextSource["termsCompliance"];
}): BusinessContextSource {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    sourceType: row.source_type,
    title: row.title,
    url: row.url,
    retrievedAt: row.retrieved_at,
    termsCompliance: row.terms_compliance,
  };
}

function mapBusinessContextFactRow(row: {
  id: string;
  prospect_business_id: string;
  source_id: string;
  label: string;
  value: string;
  source_quote?: string;
  allowed_for_generation: boolean;
}): BusinessContextFact {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    sourceId: row.source_id,
    label: row.label,
    value: row.value,
    sourceQuote: row.source_quote,
    allowedForGeneration: row.allowed_for_generation,
  };
}

function mapExcludedResearchDataRow(row: {
  id: string;
  prospect_business_id: string;
  source_id?: string;
  label: string;
  value_summary: string;
  reason: ExcludedResearchData["reason"];
  excluded_at: Date;
}): ExcludedResearchData {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    sourceId: row.source_id,
    label: row.label,
    valueSummary: row.value_summary,
    reason: row.reason,
    excludedAt: row.excluded_at,
  };
}

function mapSupportedClaimRow(row: {
  id: string;
  prospect_business_id: string;
  statement: string;
  evidence: SupportedClaim["evidence"] | SupportedClaim["evidence"][number];
  allowed_for_generation: boolean;
}): SupportedClaim {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    statement: row.statement,
    evidence: Array.isArray(row.evidence) ? row.evidence : [row.evidence],
    allowedForGeneration: row.allowed_for_generation,
  };
}
