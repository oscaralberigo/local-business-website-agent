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
import { classifyContactApprovalStatus, shouldPersistContactCandidate } from "../contact-finder/contact-suitability.js";
import type {
  ContactCandidate,
  ContactEvidence,
  ContactEvidenceSourceType,
  ContactEvidenceStore,
} from "../contact-finder/types.js";
import type {
  DiscoveryAppearance,
  DiscoveryRun,
  DiscoveryRunDetail,
  GooglePlaceResult,
  ProspectBusiness,
  ProspectBusinessDetail,
  ProspectRegistry,
  ProspectStatus,
  SaveWorkflowStateInput,
  SearchLocation,
  StartDiscoveryRunInput,
  WorkflowFailure,
  WorkflowState,
  WorkflowStateStatus,
  WorkflowStateStore,
} from "../discovery/types.js";
import type {
  DraftOutreach,
  DraftOutreachOperatorEdit,
  DraftOutreachStore,
  OutreachEmail,
  OutreachEmailStore,
  OutreachFailureMetadata,
  OutreachSuppressionCheck,
  OutreachSuppressionStatus,
  OutreachSuppressionStore,
  OutreachWorkflowFailureStore,
  SaveDraftOutreachInput,
  SaveOutreachEmailInput,
} from "../outreach/types.js";
import type {
  OperatorEditableField,
  PreviewArtifact,
  PreviewBuildMetadata,
  PreviewPublication,
  PreviewSourceReference,
  PreviewWebsite,
  PreviewWebsiteOperatorEdit,
  PreviewWebsiteStatus,
  PreviewWebsiteStore,
  SavePreviewWebsiteInput,
  WebsiteDesignPlan,
} from "../preview-generation/types.js";
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
  implements
    ProspectRegistry,
    BusinessContextStore,
    WebsiteAssessmentStore,
    ContactEvidenceStore,
    PreviewWebsiteStore,
    DraftOutreachStore,
    OutreachEmailStore,
    OutreachSuppressionStore,
    OutreachWorkflowFailureStore,
    WorkflowStateStore
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
    const failureResult = await this.pool.query(
      `insert into workflow_failures
        (id, discovery_run_id, failed_step, error_summary, retryable, operator_visible_status, provider)
       values ($1, $2, $3, $4, $5, 'visible', 'google_places')
       returning id`,
      [randomUUID(), input.discoveryRunId, input.failedStep, input.errorSummary, input.retryable],
    );
    await this.saveWorkflowState({
      workflowKey: `discovery-run:${input.discoveryRunId}`,
      discoveryRunId: input.discoveryRunId,
      currentStep: input.failedStep,
      status: "failed",
      lastFailureId: failureResult.rows[0]?.id,
      stateData: {
        errorSummary: input.errorSummary,
      },
    });
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
        `select id, discovery_run_id, prospect_business_id, failed_step, error_summary, retryable, operator_visible_status, provider, created_at
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
      workflowState: await this.getWorkflowStateForDiscoveryRun(discoveryRunId),
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
      contactEvidence: await this.getContactEvidence(prospectBusinessId),
      draftOutreach: await this.getDraftOutreach(prospectBusinessId),
      outreachEmails: await this.getOutreachEmails(prospectBusinessId),
      workflowFailures: await this.getProspectWorkflowFailures(prospectBusinessId),
      workflowState: await this.getWorkflowStateForProspect(prospectBusinessId),
      previewWebsite: await this.getPreviewWebsite(prospectBusinessId),
      websiteAssessment: await this.getWebsiteAssessment(prospectBusinessId),
    };
  }

  async saveWorkflowState(input: SaveWorkflowStateInput): Promise<WorkflowState> {
    return this.saveWorkflowStateWithClient(this.pool, input);
  }

  private async saveWorkflowStateWithClient(
    client: Queryable,
    input: SaveWorkflowStateInput,
  ): Promise<WorkflowState> {
    const id = randomUUID();
    const now = new Date();
    const result = await client.query(
      `insert into workflow_states
        (
          id,
          workflow_key,
          discovery_run_id,
          prospect_business_id,
          current_step,
          status,
          attempt_count,
          max_attempts,
          last_failure_id,
          state_data,
          prompt_versions,
          agent_output_summaries,
          source_references,
          paused_at,
          resumed_at,
          created_at,
          updated_at
        )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
       on conflict (workflow_key) do update
       set discovery_run_id = excluded.discovery_run_id,
           prospect_business_id = excluded.prospect_business_id,
           current_step = excluded.current_step,
           status = excluded.status,
           attempt_count = excluded.attempt_count,
           max_attempts = excluded.max_attempts,
           last_failure_id = excluded.last_failure_id,
           state_data = excluded.state_data,
           prompt_versions = excluded.prompt_versions,
           agent_output_summaries = excluded.agent_output_summaries,
           source_references = excluded.source_references,
           paused_at = excluded.paused_at,
           resumed_at = excluded.resumed_at,
           updated_at = excluded.updated_at
       returning *`,
      [
        id,
        input.workflowKey,
        input.discoveryRunId,
        input.prospectBusinessId,
        input.currentStep,
        input.status,
        input.attemptCount ?? 0,
        input.maxAttempts ?? 3,
        input.lastFailureId,
        JSON.stringify(input.stateData ?? {}),
        JSON.stringify(input.promptVersions ?? {}),
        JSON.stringify(input.agentOutputSummaries ?? []),
        JSON.stringify(input.sourceReferences ?? []),
        input.pausedAt,
        input.resumedAt,
        now,
      ],
    );

    return mapWorkflowStateRow(result.rows[0]);
  }

  async getWorkflowState(workflowKey: string): Promise<WorkflowState | undefined> {
    const result = await this.pool.query(
      `select *
       from workflow_states
       where workflow_key = $1`,
      [workflowKey],
    );
    const row = result.rows[0];
    return row ? mapWorkflowStateRow(row) : undefined;
  }

  async getWorkflowStateForDiscoveryRun(discoveryRunId: string): Promise<WorkflowState | undefined> {
    const result = await this.pool.query(
      `select *
       from workflow_states
       where discovery_run_id = $1
       order by updated_at desc, created_at desc
       limit 1`,
      [discoveryRunId],
    );
    const row = result.rows[0];
    return row ? mapWorkflowStateRow(row) : undefined;
  }

  async getWorkflowStateForProspect(prospectBusinessId: string): Promise<WorkflowState | undefined> {
    const result = await this.pool.query(
      `select *
       from workflow_states
       where prospect_business_id = $1
       order by updated_at desc, created_at desc
       limit 1`,
      [prospectBusinessId],
    );
    const row = result.rows[0];
    return row ? mapWorkflowStateRow(row) : undefined;
  }

  async retryWorkflowFailure(input: {
    workflowFailureId: string;
    actor: string;
  }): Promise<WorkflowState> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const failureResult = await client.query(
        `select id, discovery_run_id, prospect_business_id, failed_step, error_summary, retryable, operator_visible_status, provider, created_at
         from workflow_failures
         where id = $1`,
        [input.workflowFailureId],
      );
      const failureRow = failureResult.rows[0];
      if (!failureRow) {
        throw new Error(`Workflow Failure not found: ${input.workflowFailureId}`);
      }

      const failure = mapWorkflowFailureRow(failureRow);
      if (!failure.retryable) {
        throw new Error(`Workflow Failure is not retryable: ${input.workflowFailureId}`);
      }

      const workflowKey = workflowKeyForFailure(failure);
      const existingStateResult = await client.query(
        `select *
         from workflow_states
         where workflow_key = $1`,
        [workflowKey],
      );
      const existingState = existingStateResult.rows[0]
        ? mapWorkflowStateRow(existingStateResult.rows[0])
        : undefined;
      const workflowState = await this.saveWorkflowStateWithClient(client, {
        workflowKey,
        discoveryRunId: failure.discoveryRunId,
        prospectBusinessId: failure.prospectBusinessId,
        currentStep: failure.failedStep,
        status: "retrying",
        attemptCount: (existingState?.attemptCount ?? 0) + 1,
        maxAttempts: existingState?.maxAttempts ?? 3,
        lastFailureId: failure.id,
        stateData: {
          ...(existingState?.stateData ?? {}),
          retryRequestedBy: input.actor,
          retryRequestedAt: new Date().toISOString(),
        },
        promptVersions: existingState?.promptVersions,
        agentOutputSummaries: existingState?.agentOutputSummaries,
        sourceReferences: existingState?.sourceReferences,
        resumedAt: new Date(),
      });

      await client.query(
        `update workflow_failures
         set operator_visible_status = 'retrying'
         where id = $1`,
        [input.workflowFailureId],
      );
      await client.query("commit");
      return workflowState;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveContactEvidence(input: {
    prospectBusinessId: string;
    candidates: ContactCandidate[];
    foundAt?: Date;
  }): Promise<ContactEvidence[]> {
    const foundAt = input.foundAt ?? new Date();
    const contactEvidence: ContactEvidence[] = input.candidates
      .filter(shouldPersistContactCandidate)
      .map((candidate) => ({
        id: randomUUID(),
        prospectBusinessId: input.prospectBusinessId,
        emailAddress: candidate.emailAddress,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        confidence: candidate.confidence,
        roleClassification: candidate.roleClassification,
        outreachApprovalStatus: classifyContactApprovalStatus(candidate),
        reason: candidate.reason,
        foundAt,
      }));
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from contact_evidence
         where prospect_business_id = $1
           and outreach_approval_status != 'approved'`,
        [input.prospectBusinessId],
      );

      for (const evidence of contactEvidence) {
        await client.query(
          `insert into contact_evidence
            (
              id,
              prospect_business_id,
              email_address,
              source_url,
              source_type,
              confidence,
              role_classification,
              outreach_approval_status,
              reason,
              found_at,
              approved_at,
              approved_by,
              approval_reason
            )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            evidence.id,
            evidence.prospectBusinessId,
            evidence.emailAddress,
            evidence.sourceUrl,
            evidence.sourceType,
            evidence.confidence,
            evidence.roleClassification,
            evidence.outreachApprovalStatus,
            evidence.reason,
            evidence.foundAt,
            evidence.approvedAt,
            evidence.approvedBy,
            evidence.approvalReason,
          ],
        );
      }

      const approvedResult = await client.query(
        `select count(*)::int as count
         from contact_evidence
         where prospect_business_id = $1
           and outreach_approval_status = 'approved'`,
        [input.prospectBusinessId],
      );
      const prospectStatus = deriveProspectStatusFromContactEvidence({
        hasApprovedContact: approvedResult.rows[0]?.count > 0,
        hasPendingContact: contactEvidence.some(
          (evidence) => evidence.outreachApprovalStatus === "pending_operator_approval",
        ),
      });

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

    return contactEvidence;
  }

  async approveContactEvidence(input: {
    prospectBusinessId: string;
    contactEvidenceId: string;
    actor: string;
    reason: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence> {
    const approvedAt = input.approvedAt ?? new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update contact_evidence
         set outreach_approval_status = 'approved',
             approved_at = $3,
             approved_by = $4,
             approval_reason = $5
         where id = $1
           and prospect_business_id = $2
           and outreach_approval_status != 'blocked'
         returning *`,
        [
          input.contactEvidenceId,
          input.prospectBusinessId,
          approvedAt,
          input.actor,
          input.reason,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error(`Contact Evidence not found or blocked: ${input.contactEvidenceId}`);
      }

      await client.query(
        `update prospect_businesses
         set prospect_status = 'drafting_outreach',
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId],
      );
      await client.query("commit");
      return mapContactEvidenceRow(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async addVerifiedContactEvidence(input: {
    prospectBusinessId: string;
    emailAddress: string;
    sourceUrl: string;
    sourceType: ContactEvidenceSourceType;
    reason: string;
    actor: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence> {
    const approvedAt = input.approvedAt ?? new Date();
    const evidence: ContactEvidence = {
      id: randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      emailAddress: input.emailAddress,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      confidence: 1,
      roleClassification: "role",
      outreachApprovalStatus: "approved",
      reason: input.reason,
      foundAt: approvedAt,
      approvedAt,
      approvedBy: input.actor,
      approvalReason: input.reason,
    };

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into contact_evidence
          (
            id,
            prospect_business_id,
            email_address,
            source_url,
            source_type,
            confidence,
            role_classification,
            outreach_approval_status,
            reason,
            found_at,
            approved_at,
            approved_by,
            approval_reason
          )
         values ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9, $9, $10, $8)`,
        [
          evidence.id,
          evidence.prospectBusinessId,
          evidence.emailAddress,
          evidence.sourceUrl,
          evidence.sourceType,
          evidence.confidence,
          evidence.roleClassification,
          evidence.reason,
          approvedAt,
          input.actor,
        ],
      );
      await client.query(
        `update prospect_businesses
         set prospect_status = 'drafting_outreach',
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId],
      );
      await client.query("commit");
      return evidence;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

  async savePreviewWebsite(input: SavePreviewWebsiteInput): Promise<PreviewWebsite> {
    const id = randomUUID();
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into preview_websites
          (
            id,
            prospect_business_id,
            slug,
            status,
            design_plan,
            content_json,
            source_references,
            build_metadata,
            artifact,
            operator_editable_fields,
            created_at,
            updated_at
          )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (prospect_business_id) do update
         set slug = excluded.slug,
             status = excluded.status,
             design_plan = excluded.design_plan,
             content_json = excluded.content_json,
             source_references = excluded.source_references,
             build_metadata = excluded.build_metadata,
             artifact = excluded.artifact,
             operator_editable_fields = excluded.operator_editable_fields,
             updated_at = excluded.updated_at
         returning *`,
        [
          id,
          input.prospectBusinessId,
          input.slug,
          input.status,
          JSON.stringify(input.designPlan),
          JSON.stringify(input.contentJson),
          JSON.stringify(input.sourceReferences),
          JSON.stringify(input.buildMetadata),
          JSON.stringify(input.artifact),
          JSON.stringify(input.operatorEditableFields),
          now,
        ],
      );

      await client.query(
        `update prospect_businesses
         set prospect_status = $2,
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId, prospectStatusFromPreviewWebsiteStatus(input.status)],
      );
      await client.query("commit");

      return mapPreviewWebsiteRow(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePreviewWebsiteOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: PreviewWebsiteOperatorEdit[];
  }): Promise<PreviewWebsite> {
    const existingPreviewWebsite = await this.getPreviewWebsite(input.prospectBusinessId);
    if (!existingPreviewWebsite) {
      throw new Error(`Preview Website not found: ${input.prospectBusinessId}`);
    }

    const contentJson = structuredClone(existingPreviewWebsite.contentJson);
    const designPlan = structuredClone(existingPreviewWebsite.designPlan);
    const operatorEditableFields = structuredClone(existingPreviewWebsite.operatorEditableFields);
    const reviewablePaths = new Set(operatorEditableFields.map((field) => field.path));

    for (const edit of input.edits) {
      if (!reviewablePaths.has(edit.path)) {
        throw new Error(`Preview Website field is not reviewable: ${edit.path}`);
      }

      if (edit.path.startsWith("contentJson.")) {
        setJsonPath(contentJson, edit.path.slice("contentJson.".length), edit.value);
      } else if (edit.path.startsWith("designPlan.")) {
        setJsonPath(designPlan, edit.path.slice("designPlan.".length), edit.value);
      } else {
        throw new Error(`Preview Website field is not reviewable: ${edit.path}`);
      }

      const editableField = operatorEditableFields.find((field) => field.path === edit.path);
      if (editableField) {
        editableField.value = edit.value;
      }
    }

    const result = await this.pool.query(
      `update preview_websites
       set content_json = $2,
           design_plan = $3,
           operator_editable_fields = $4,
           updated_at = now()
       where prospect_business_id = $1
       returning *`,
      [
        input.prospectBusinessId,
        JSON.stringify(contentJson),
        JSON.stringify(designPlan),
        JSON.stringify(operatorEditableFields),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Preview Website not found: ${input.prospectBusinessId}`);
    }

    return mapPreviewWebsiteRow(row);
  }

  async publishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
    approvalReason: string;
    publication: PreviewPublication;
  }): Promise<PreviewWebsite> {
    const publication: PreviewPublication = {
      ...input.publication,
      approvedBy: input.actor,
      approvalReason: input.approvalReason,
    };
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update preview_websites
         set status = 'published',
             publication = $2,
             updated_at = now()
         where prospect_business_id = $1
         returning *`,
        [input.prospectBusinessId, JSON.stringify(publication)],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error(`Preview Website not found: ${input.prospectBusinessId}`);
      }

      await client.query(
        `update prospect_businesses
         set prospect_status = 'preview_published',
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId],
      );
      await client.query("commit");

      return mapPreviewWebsiteRow(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async unpublishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
  }): Promise<PreviewWebsite> {
    const existingPreviewWebsite = await this.getPreviewWebsite(input.prospectBusinessId);
    if (!existingPreviewWebsite?.publication) {
      throw new Error(`Published Preview not found: ${input.prospectBusinessId}`);
    }

    const publication: PreviewPublication = {
      ...existingPreviewWebsite.publication,
      unpublishedAt: new Date(),
      unpublishedBy: input.actor,
    };
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update preview_websites
         set status = 'ready_for_review',
             publication = $2,
             updated_at = now()
         where prospect_business_id = $1
         returning *`,
        [input.prospectBusinessId, JSON.stringify(publication)],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error(`Preview Website not found: ${input.prospectBusinessId}`);
      }

      await client.query(
        `update prospect_businesses
         set prospect_status = 'preview_ready_for_review',
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId],
      );
      await client.query("commit");

      return mapPreviewWebsiteRow(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveDraftOutreach(input: SaveDraftOutreachInput): Promise<DraftOutreach> {
    const id = randomUUID();
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into draft_outreach
          (
            id,
            prospect_business_id,
            subject,
            body_text,
            body_html,
            claims_used,
            compliance_notes,
            requires_operator_review,
            created_at,
            updated_at
          )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         on conflict (prospect_business_id) do update
         set subject = excluded.subject,
             body_text = excluded.body_text,
             body_html = excluded.body_html,
             claims_used = excluded.claims_used,
             compliance_notes = excluded.compliance_notes,
             requires_operator_review = excluded.requires_operator_review,
             updated_at = excluded.updated_at
         returning *`,
        [
          id,
          input.prospectBusinessId,
          input.subject,
          input.bodyText,
          input.bodyHtml,
          JSON.stringify(input.claimsUsed),
          JSON.stringify(input.complianceNotes),
          input.requiresOperatorReview,
          now,
        ],
      );

      await client.query(
        `update prospect_businesses
         set prospect_status = 'outreach_ready_for_review',
             updated_at = now()
         where id = $1`,
        [input.prospectBusinessId],
      );
      await client.query("commit");

      return mapDraftOutreachRow(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraftOutreachOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: DraftOutreachOperatorEdit;
  }): Promise<DraftOutreach> {
    const existingDraft = await this.getDraftOutreach(input.prospectBusinessId);
    if (!existingDraft) {
      throw new Error(`Draft Outreach not found: ${input.prospectBusinessId}`);
    }

    const result = await this.pool.query(
      `update draft_outreach
       set subject = $2,
           body_text = $3,
           body_html = $4,
           updated_at = now()
       where prospect_business_id = $1
       returning *`,
      [
        input.prospectBusinessId,
        input.edits.subject ?? existingDraft.subject,
        input.edits.bodyText ?? existingDraft.bodyText,
        input.edits.bodyHtml ?? existingDraft.bodyHtml,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Draft Outreach not found: ${input.prospectBusinessId}`);
    }

    return mapDraftOutreachRow(row);
  }

  async saveOutreachEmail(input: SaveOutreachEmailInput): Promise<OutreachEmail> {
    const id = randomUUID();
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into outreach_emails
          (
            id,
            prospect_business_id,
            draft_outreach_id,
            recipient_email_address,
            provider,
            provider_message_id,
            send_status,
            suppression_status,
            sent_at,
            failure_metadata,
            created_at,
            updated_at
          )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         returning *`,
        [
          id,
          input.prospectBusinessId,
          input.draftOutreachId,
          input.recipientEmailAddress,
          input.provider,
          input.providerMessageId,
          input.sendStatus,
          input.suppressionStatus,
          input.sentAt,
          input.failureMetadata ? JSON.stringify(input.failureMetadata) : null,
          now,
        ],
      );

      if (input.sendStatus === "sent") {
        await client.query(
          `update prospect_businesses
           set prospect_status = 'outreach_sent',
               updated_at = now()
           where id = $1`,
          [input.prospectBusinessId],
        );
      }
      await client.query("commit");

      return mapOutreachEmailRow(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOutreachSuppressionStatus(input: {
    prospectBusinessId: string;
    emailAddress: string;
  }): Promise<OutreachSuppressionCheck> {
    const result = await this.pool.query(
      `select suppression_status, reason
       from outreach_suppressions
       where lower(email_address) = lower($1)
          or prospect_business_id = $2
       order by created_at desc
       limit 1`,
      [input.emailAddress, input.prospectBusinessId],
    );
    const row = result.rows[0] as
      | { suppression_status: Exclude<OutreachSuppressionStatus, "clear">; reason: string }
      | undefined;
    if (!row) {
      return { status: "clear" };
    }

    return {
      status: row.suppression_status,
      reason: row.reason,
    };
  }

  async recordOutreachSuppression(input: {
    prospectBusinessId?: string;
    emailAddress: string;
    status: Exclude<OutreachSuppressionStatus, "clear">;
    reason: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into outreach_suppressions
        (id, prospect_business_id, email_address, suppression_status, reason)
       values ($1, $2, $3, $4, $5)
       on conflict (email_address) do update
       set prospect_business_id = excluded.prospect_business_id,
           suppression_status = excluded.suppression_status,
           reason = excluded.reason,
           created_at = now()`,
      [randomUUID(), input.prospectBusinessId, input.emailAddress, input.status, input.reason],
    );
  }

  async recordOutreachWorkflowFailure(input: {
    prospectBusinessId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
    provider: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into workflow_failures
        (id, prospect_business_id, failed_step, error_summary, retryable, operator_visible_status, provider)
       values ($1, $2, $3, $4, $5, 'visible', $6)`,
      [
        randomUUID(),
        input.prospectBusinessId,
        input.failedStep,
        input.errorSummary,
        input.retryable,
        input.provider,
      ],
    );
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

  private async getContactEvidence(prospectBusinessId: string): Promise<ContactEvidence[]> {
    const result = await this.pool.query(
      `select *
       from contact_evidence
       where prospect_business_id = $1
       order by found_at asc, created_at asc`,
      [prospectBusinessId],
    );
    return result.rows.map(mapContactEvidenceRow);
  }

  private async getPreviewWebsite(prospectBusinessId: string): Promise<PreviewWebsite | undefined> {
    const result = await this.pool.query(
      `select *
       from preview_websites
       where prospect_business_id = $1`,
      [prospectBusinessId],
    );
    const row = result.rows[0];
    return row ? mapPreviewWebsiteRow(row) : undefined;
  }

  private async getDraftOutreach(prospectBusinessId: string): Promise<DraftOutreach | undefined> {
    const result = await this.pool.query(
      `select *
       from draft_outreach
       where prospect_business_id = $1`,
      [prospectBusinessId],
    );
    const row = result.rows[0];
    return row ? mapDraftOutreachRow(row) : undefined;
  }

  private async getOutreachEmails(prospectBusinessId: string): Promise<OutreachEmail[]> {
    const result = await this.pool.query(
      `select *
       from outreach_emails
       where prospect_business_id = $1
       order by created_at asc`,
      [prospectBusinessId],
    );
    return result.rows.map(mapOutreachEmailRow);
  }

  private async getProspectWorkflowFailures(prospectBusinessId: string): Promise<WorkflowFailure[]> {
    const result = await this.pool.query(
      `select id, discovery_run_id, prospect_business_id, failed_step, error_summary, retryable, operator_visible_status, provider, created_at
       from workflow_failures
       where prospect_business_id = $1
       order by created_at asc`,
      [prospectBusinessId],
    );
    return result.rows.map(mapWorkflowFailureRow);
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

function mapContactEvidenceRow(row: {
  id: string;
  prospect_business_id: string;
  email_address: string;
  source_url: string;
  source_type: ContactEvidenceSourceType;
  confidence: number;
  role_classification: ContactEvidence["roleClassification"];
  outreach_approval_status: ContactEvidence["outreachApprovalStatus"];
  reason: string;
  found_at: Date;
  approved_at?: Date;
  approved_by?: string;
  approval_reason?: string;
}): ContactEvidence {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    emailAddress: row.email_address,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    confidence: row.confidence,
    roleClassification: row.role_classification,
    outreachApprovalStatus: row.outreach_approval_status,
    reason: row.reason,
    foundAt: row.found_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    approvalReason: row.approval_reason,
  };
}

function mapPreviewWebsiteRow(row: {
  id: string;
  prospect_business_id: string;
  slug: string;
  status: PreviewWebsiteStatus;
  design_plan: WebsiteDesignPlan;
  content_json: Record<string, unknown>;
  source_references: PreviewSourceReference[];
  build_metadata: PreviewBuildMetadata;
  artifact: PreviewArtifact;
  operator_editable_fields: OperatorEditableField[];
  publication?: PreviewPublication | SerializedPreviewPublication | string | null;
  created_at: Date;
  updated_at: Date;
}): PreviewWebsite {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    slug: row.slug,
    status: row.status,
    designPlan: parseJsonb<WebsiteDesignPlan>(row.design_plan),
    contentJson: parseJsonb<Record<string, unknown>>(row.content_json),
    sourceReferences: parseJsonb<PreviewSourceReference[]>(row.source_references),
    buildMetadata: parseJsonb<PreviewBuildMetadata>(row.build_metadata),
    artifact: parseJsonb<PreviewArtifact>(row.artifact),
    operatorEditableFields: parseJsonb<OperatorEditableField[]>(row.operator_editable_fields),
    publication: deserializePreviewPublication(
      row.publication ? parseJsonb<PreviewPublication | SerializedPreviewPublication>(row.publication) : undefined,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDraftOutreachRow(row: {
  id: string;
  prospect_business_id: string;
  subject: string;
  body_text: string;
  body_html: string;
  claims_used: DraftOutreach["claimsUsed"];
  compliance_notes: string[];
  requires_operator_review: boolean;
  created_at: Date;
  updated_at: Date;
}): DraftOutreach {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    claimsUsed: parseJsonb<DraftOutreach["claimsUsed"]>(row.claims_used),
    complianceNotes: parseJsonb<string[]>(row.compliance_notes),
    requiresOperatorReview: row.requires_operator_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutreachEmailRow(row: {
  id: string;
  prospect_business_id: string;
  draft_outreach_id?: string;
  recipient_email_address: string;
  provider: string;
  provider_message_id?: string;
  send_status: OutreachEmail["sendStatus"];
  suppression_status: OutreachSuppressionStatus;
  sent_at?: Date;
  failure_metadata?: OutreachFailureMetadata | string | null;
  created_at: Date;
  updated_at: Date;
}): OutreachEmail {
  return {
    id: row.id,
    prospectBusinessId: row.prospect_business_id,
    draftOutreachId: row.draft_outreach_id,
    recipientEmailAddress: row.recipient_email_address,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    sendStatus: row.send_status,
    suppressionStatus: row.suppression_status,
    sentAt: row.sent_at,
    failureMetadata: row.failure_metadata
      ? parseJsonb<OutreachFailureMetadata>(row.failure_metadata)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

type SerializedPreviewPublication = Omit<
  PreviewPublication,
  "publishedAt" | "unpublishedAt"
> & {
  publishedAt: string;
  unpublishedAt?: string;
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

function deserializePreviewPublication(
  publication?: PreviewPublication | SerializedPreviewPublication,
): PreviewPublication | undefined {
  if (!publication) {
    return undefined;
  }

  return {
    ...publication,
    publishedAt:
      publication.publishedAt instanceof Date
        ? publication.publishedAt
        : new Date(publication.publishedAt),
    unpublishedAt: publication.unpublishedAt
      ? publication.unpublishedAt instanceof Date
        ? publication.unpublishedAt
        : new Date(publication.unpublishedAt)
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
  discovery_run_id?: string;
  prospect_business_id?: string;
  failed_step: string;
  error_summary: string;
  retryable: boolean;
  operator_visible_status: string;
  provider: string;
  created_at: Date;
}): WorkflowFailure {
  return {
    id: row.id,
    discoveryRunId: row.discovery_run_id,
    prospectBusinessId: row.prospect_business_id,
    failedStep: row.failed_step,
    errorSummary: row.error_summary,
    retryable: row.retryable,
    operatorVisibleStatus: row.operator_visible_status,
    provider: row.provider,
    createdAt: row.created_at,
  };
}

function mapWorkflowStateRow(row: {
  id: string;
  workflow_key: string;
  discovery_run_id?: string;
  prospect_business_id?: string;
  current_step: string;
  status: WorkflowStateStatus;
  attempt_count: number;
  max_attempts: number;
  last_failure_id?: string;
  state_data: Record<string, unknown> | string;
  prompt_versions: Record<string, string> | string;
  agent_output_summaries: Record<string, unknown>[] | string;
  source_references: Record<string, unknown>[] | string;
  paused_at?: Date;
  resumed_at?: Date;
  created_at: Date;
  updated_at: Date;
}): WorkflowState {
  return {
    id: row.id,
    workflowKey: row.workflow_key,
    discoveryRunId: row.discovery_run_id,
    prospectBusinessId: row.prospect_business_id,
    currentStep: row.current_step,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastFailureId: row.last_failure_id,
    stateData: parseJsonb<Record<string, unknown>>(row.state_data),
    promptVersions: parseJsonb<Record<string, string>>(row.prompt_versions),
    agentOutputSummaries: parseJsonb<Record<string, unknown>[]>(row.agent_output_summaries),
    sourceReferences: parseJsonb<Record<string, unknown>[]>(row.source_references),
    pausedAt: row.paused_at,
    resumedAt: row.resumed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function workflowKeyForFailure(failure: WorkflowFailure): string {
  if (failure.discoveryRunId) {
    return `discovery-run:${failure.discoveryRunId}`;
  }

  if (failure.prospectBusinessId) {
    return `prospect-business:${failure.prospectBusinessId}`;
  }

  return `workflow-failure:${failure.id}`;
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

function deriveProspectStatusFromContactEvidence(input: {
  hasApprovedContact: boolean;
  hasPendingContact: boolean;
}): ProspectStatus {
  if (input.hasApprovedContact) {
    return "drafting_outreach";
  }

  if (input.hasPendingContact) {
    return "finding_contact";
  }

  return "contact_unavailable";
}

function prospectStatusFromPreviewWebsiteStatus(status: PreviewWebsiteStatus): ProspectStatus {
  if (status === "published") {
    return "preview_published";
  }

  if (status === "ready_for_review") {
    return "preview_ready_for_review";
  }

  return "failed";
}

function setJsonPath(target: unknown, relativePath: string, value: string | number | boolean | null): void {
  const segments = relativePath.split(".").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Preview Website edit path is empty.");
  }

  let current: unknown = target;
  for (const [index, segment] of segments.entries()) {
    const finalSegment = index === segments.length - 1;

    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) {
        throw new Error(`Preview Website edit path is invalid: ${relativePath}`);
      }

      if (finalSegment) {
        current[arrayIndex] = value;
        return;
      }

      current = current[arrayIndex];
      continue;
    }

    if (typeof current !== "object" || current === null || !(segment in current)) {
      throw new Error(`Preview Website edit path is invalid: ${relativePath}`);
    }

    const record = current as Record<string, unknown>;
    if (finalSegment) {
      record[segment] = value;
      return;
    }

    current = record[segment];
  }
}
