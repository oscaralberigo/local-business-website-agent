import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  DiscoveryAppearance,
  DiscoveryRun,
  DiscoveryRunDetail,
  GooglePlaceResult,
  ProspectBusiness,
  ProspectBusinessDetail,
  ProspectRegistry,
  SearchLocation,
  StartDiscoveryRunInput,
  WorkflowFailure,
} from "../discovery/types.js";

type Queryable = Pool | PoolClient;

export class PostgresProspectRegistry implements ProspectRegistry {
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
  prospect_status: "discovered" | "failed";
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
