import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { runDiscovery } from "../src/discovery/run-discovery.js";
import type { BusinessDiscoverySource, GooglePlaceResult, StartDiscoveryRunInput } from "../src/discovery/types.js";
import { PostgresProspectRegistry } from "../src/persistence/postgres-prospect-registry.js";

const discoveryRequest: StartDiscoveryRunInput = {
  mode: "place_search",
  searchTerm: "coffee shop",
  searchLocation: {
    label: "Beacon, NY",
  },
  discoveryLimit: 1,
};

describe("Postgres Prospect Registry", () => {
  it("deduplicates Prospect Businesses by Google Place ID and records each Discovery Appearance", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const firstRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/postgres-cafe",
        name: "Postgres Cafe",
        formattedAddress: "1 Main St",
        websiteUrl: "https://first.example",
        categories: ["cafe"],
        sourcePayload: { version: "first" },
      }),
    });

    const secondRun = await runDiscovery({
      request: {
        ...discoveryRequest,
        searchTerm: "bakery",
      },
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/postgres-cafe",
        name: "Postgres Cafe Bakery",
        formattedAddress: "2 Main St",
        websiteUrl: "https://latest.example",
        categories: ["cafe", "bakery"],
        sourcePayload: { version: "latest" },
      }),
    });

    expect(secondRun.discoveredProspects[0]?.id).toBe(firstRun.discoveredProspects[0]?.id);
    expect(secondRun.discoveredProspects[0]).toMatchObject({
      name: "Postgres Cafe Bakery",
      formattedAddress: "2 Main St",
      websiteUrl: "https://latest.example",
      sourceData: { version: "latest" },
    });

    const prospectDetail = await registry.getProspectBusinessDetail(
      secondRun.discoveredProspects[0]!.id,
    );

    expect(prospectDetail.firstDiscoveredRun.id).toBe(firstRun.id);
    expect(prospectDetail.latestDiscoveredRun.id).toBe(secondRun.id);
    expect(prospectDetail.appearanceHistory.map((appearance) => appearance.discoveryRun.id)).toEqual([
      firstRun.id,
      secondRun.id,
    ]);

    const prospectCount = await pool.query(
      "select count(*)::int as count from prospect_businesses where google_place_id = $1",
      ["places/postgres-cafe"],
    );
    expect(prospectCount.rows[0].count).toBe(1);

    await pool.end();
  });

  it("persists Business Context sources, facts, exclusions, and derived Supported Claims", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/context-cafe",
        name: "Context Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/context-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const businessContext = await registry.saveBusinessContext({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [
        {
          id: "source-allowed",
          sourceType: "business_website",
          url: "https://context.example/about",
          retrievedAt: new Date("2026-06-22T15:00:00.000Z"),
          termsCompliance: {
            allowed: true,
            checkedAt: new Date("2026-06-22T15:00:00.000Z"),
            robotsDirective: "index,follow",
          },
        },
        {
          id: "source-disallowed",
          sourceType: "search_results",
          url: "https://search.example/result",
          retrievedAt: new Date("2026-06-22T15:01:00.000Z"),
          termsCompliance: {
            allowed: false,
            checkedAt: new Date("2026-06-22T15:01:00.000Z"),
            notes: "Source terms disallowed generated use.",
          },
        },
      ],
      facts: [
        {
          sourceId: "source-allowed",
          label: "Menu specialty",
          value: "Context Cafe serves house-roasted coffee.",
          allowedForGeneration: true,
        },
        {
          sourceId: "source-disallowed",
          label: "Blocked fact",
          value: "Context Cafe has a hidden terrace.",
          allowedForGeneration: true,
        },
      ],
      excludedResearchData: [
        {
          sourceId: "source-allowed",
          label: "Staff profile",
          valueSummary: "A staff personal profile was excluded.",
          reason: "staff_personal_profile",
          excludedAt: new Date("2026-06-22T15:02:00.000Z"),
        },
      ],
    });

    expect(businessContext.supportedClaims).toHaveLength(1);
    expect(businessContext.supportedClaims[0]).toMatchObject({
      statement: "Context Cafe serves house-roasted coffee.",
      evidence: [{ sourceId: "source-allowed" }],
    });

    await expectCount(pool, "business_context_sources", prospectBusinessId, 2);
    await expectCount(pool, "business_context_facts", prospectBusinessId, 1);
    await expectCount(pool, "excluded_research_data", prospectBusinessId, 2);
    await expectCount(pool, "supported_claims", prospectBusinessId, 1);

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.businessContext).toMatchObject({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [{ id: "source-allowed" }, { id: "source-disallowed" }],
      facts: [{ sourceId: "source-allowed" }],
      excludedResearchData: [
        { reason: "staff_personal_profile" },
        { reason: "source_terms_disallowed" },
      ],
      supportedClaims: [
        {
          statement: "Context Cafe serves house-roasted coffee.",
          evidence: [{ sourceId: "source-allowed" }],
        },
      ],
    });

    await pool.end();
  });
});

function sourceReturning(place: GooglePlaceResult): BusinessDiscoverySource {
  return {
    async searchPlaces() {
      return [place];
    },
  };
}

async function expectCount(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ count: number }> }> },
  tableName: string,
  prospectBusinessId: string,
  expectedCount: number,
) {
  const result = await pool.query(
    `select count(*)::int as count from ${tableName} where prospect_business_id = $1`,
    [prospectBusinessId],
  );
  expect(result.rows[0].count).toBe(expectedCount);
}
