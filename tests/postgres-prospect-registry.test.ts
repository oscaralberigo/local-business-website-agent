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
});

function sourceReturning(place: GooglePlaceResult): BusinessDiscoverySource {
  return {
    async searchPlaces() {
      return [place];
    },
  };
}
