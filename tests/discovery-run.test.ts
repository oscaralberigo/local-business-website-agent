import { describe, expect, it } from "vitest";
import { runDiscovery } from "../src/discovery/run-discovery.js";
import type { BusinessDiscoverySource, StartDiscoveryRunInput } from "../src/discovery/types.js";
import { InMemoryProspectRegistry } from "../src/persistence/in-memory-prospect-registry.js";

const discoveryRequest: StartDiscoveryRunInput = {
  mode: "place_search",
  searchTerm: "independent coffee shop",
  searchLocation: {
    label: "Beacon, NY",
    latitude: 41.5048,
    longitude: -73.9696,
    radiusMeters: 2000,
  },
  discoveryLimit: 2,
};

describe("Discovery Runs", () => {
  it("persists a Discovery Run with Google Places Prospect Businesses and Discovery Appearances", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoverySource: BusinessDiscoverySource = {
      async searchPlaces() {
        return [
          {
            googlePlaceId: "places/cafe-one",
            name: "Cafe One",
            formattedAddress: "1 Main St, Beacon, NY",
            latitude: 41.5,
            longitude: -73.96,
            websiteUrl: "https://cafe-one.example",
            phoneNumber: "+15555550100",
            categories: ["cafe", "restaurant"],
            rating: 4.7,
            userRatingCount: 118,
            sourcePayload: { id: "places/cafe-one" },
          },
          {
            googlePlaceId: "places/cafe-two",
            name: "Cafe Two",
            formattedAddress: "2 Main St, Beacon, NY",
            categories: ["cafe"],
            sourcePayload: { id: "places/cafe-two" },
          },
          {
            googlePlaceId: "places/over-limit",
            name: "Over Limit Cafe",
            categories: ["cafe"],
            sourcePayload: { id: "places/over-limit" },
          },
        ];
      },
    };

    const detail = await runDiscovery({
      request: discoveryRequest,
      discoverySource,
      registry,
    });

    expect(detail.status).toBe("completed");
    expect(detail.source).toBe("google_places");
    expect(detail.mode).toBe("place_search");
    expect(detail.searchLocation).toEqual(discoveryRequest.searchLocation);
    expect(detail.discoveryLimit).toBe(2);
    expect(detail.resultMetadata).toEqual({
      providerResultCount: 3,
      processedResultCount: 2,
    });
    expect(detail.discoveredProspects).toHaveLength(2);
    expect(detail.discoveredProspects.map((prospect) => prospect.googlePlaceId)).toEqual([
      "places/cafe-one",
      "places/cafe-two",
    ]);
    expect(detail.discoveredProspects[0]).toMatchObject({
      name: "Cafe One",
      prospectStatus: "discovered",
      websiteUrl: "https://cafe-one.example",
    });
    expect(detail.appearances.map((appearance) => appearance.rank)).toEqual([1, 2]);
    expect(detail.workflowFailures).toEqual([]);
  });

  it("stores an operator-visible Workflow Failure when Google Places discovery fails", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoverySource: BusinessDiscoverySource = {
      async searchPlaces() {
        throw new Error("Google Places quota exceeded");
      },
    };

    const detail = await runDiscovery({
      request: {
        ...discoveryRequest,
        mode: "radius_search",
      },
      discoverySource,
      registry,
    });

    expect(detail.status).toBe("failed");
    expect(detail.discoveredProspects).toEqual([]);
    expect(detail.workflowFailures).toHaveLength(1);
    expect(detail.workflowFailures[0]).toMatchObject({
      failedStep: "google_places_discovery",
      errorSummary: "Google Places quota exceeded",
      operatorVisibleStatus: "visible",
      provider: "google_places",
      retryable: true,
    });
  });
});
