import { describe, expect, it } from "vitest";

import { createBusinessContextResearcher } from "../src/business-context/business-context-researcher.js";
import type { BusinessContextResearchTool } from "../src/business-context/types.js";
import { runDiscovery } from "../src/discovery/run-discovery.js";
import { InMemoryProspectRegistry } from "../src/persistence/in-memory-prospect-registry.js";

describe("Business Context research", () => {
  it("uses approved Research Tools in expanded mode and excludes source-disallowed facts", async () => {
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/context-cafe",
      name: "Context Cafe",
      categories: ["cafe"],
      prospectStatus: "discovered" as const,
      sourceData: { placeId: "places/context-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
    };
    const calls: string[] = [];
    const researchTools: BusinessContextResearchTool[] = [
      {
        toolName: "business_website",
        async gather(input) {
          calls.push(`${input.researchMode}:business_website`);
          return {
            sources: [
              {
                id: "source-allowed",
                sourceType: "business_website",
                url: "https://context.example/about",
                termsCompliance: {
                  allowed: true,
                  checkedAt: new Date("2026-06-22T15:00:00.000Z"),
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
            ],
            excludedResearchData: [],
          };
        },
      },
      {
        toolName: "search_results",
        async gather(input) {
          calls.push(`${input.researchMode}:search_results`);
          return {
            sources: [
              {
                id: "source-disallowed",
                sourceType: "search_results",
                url: "https://search.example/result",
                termsCompliance: {
                  allowed: false,
                  checkedAt: new Date("2026-06-22T15:00:00.000Z"),
                  notes: "Source terms disallowed generated use.",
                },
              },
            ],
            facts: [
              {
                sourceId: "source-disallowed",
                label: "Disallowed source fact",
                value: "Context Cafe has a hidden terrace.",
                allowedForGeneration: true,
              },
            ],
            excludedResearchData: [],
          };
        },
      },
    ];

    const researcher = createBusinessContextResearcher({ researchTools });
    const result = await researcher.research({ prospectBusiness, researchMode: "expanded" });

    expect(calls).toEqual(["expanded:business_website", "expanded:search_results"]);
    expect(result.sources).toHaveLength(2);
    expect(result.facts).toEqual([
      {
        sourceId: "source-allowed",
        label: "Menu specialty",
        value: "Context Cafe serves house-roasted coffee.",
        allowedForGeneration: true,
      },
    ]);
    expect(result.excludedResearchData).toEqual([
      {
        sourceId: "source-disallowed",
        label: "Disallowed source fact",
        valueSummary: "Context Cafe has a hidden terrace.",
        reason: "source_terms_disallowed",
      },
    ]);
  });

  it("persists Business Context evidence and derives only source-backed Supported Claims", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoveryRun = await runDiscovery({
      request: {
        mode: "place_search",
        searchTerm: "coffee shop",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/context-cafe",
              name: "Context Cafe",
              categories: ["cafe"],
              sourcePayload: { placeId: "places/context-cafe" },
            },
          ];
        },
      },
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const businessContext = await registry.saveBusinessContext({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [
        {
          id: "source-allowed",
          sourceType: "business_website",
          title: "Context Cafe about page",
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
          sourceType: "compliant_page_extraction",
          title: "Blocked page",
          url: "https://context.example/private",
          retrievedAt: new Date("2026-06-22T15:01:00.000Z"),
          termsCompliance: {
            allowed: false,
            checkedAt: new Date("2026-06-22T15:01:00.000Z"),
            notes: "Robots directive disallows extraction.",
          },
        },
      ],
      facts: [
        {
          sourceId: "source-allowed",
          label: "Menu specialty",
          value: "Context Cafe serves house-roasted coffee.",
          sourceQuote: "house-roasted coffee",
          allowedForGeneration: true,
        },
        {
          sourceId: "source-allowed",
          label: "Unsupported award",
          value: "Context Cafe is the best coffee shop in Beacon.",
          allowedForGeneration: false,
        },
        {
          sourceId: "source-disallowed",
          label: "Disallowed source fact",
          value: "Context Cafe has a secret menu.",
          allowedForGeneration: true,
        },
      ],
      excludedResearchData: [
        {
          sourceId: "source-allowed",
          label: "Personal mobile number",
          valueSummary: "A staff member mobile number appeared on a public page.",
          reason: "personal_contact",
          excludedAt: new Date("2026-06-22T15:02:00.000Z"),
        },
      ],
    });

    expect(businessContext).toMatchObject({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [
        { id: "source-allowed", sourceType: "business_website" },
        { id: "source-disallowed", sourceType: "compliant_page_extraction" },
      ],
      facts: [
        { sourceId: "source-allowed", allowedForGeneration: true },
        { sourceId: "source-allowed", allowedForGeneration: false },
      ],
      excludedResearchData: [{ reason: "personal_contact" }, { reason: "source_terms_disallowed" }],
      supportedClaims: [
        {
          statement: "Context Cafe serves house-roasted coffee.",
          evidence: [{ sourceId: "source-allowed" }],
          allowedForGeneration: true,
        },
      ],
    });
    expect(businessContext.supportedClaims).toHaveLength(1);
  });
});

function discoveryRunStub(id: string) {
  return {
    id,
    source: "google_places" as const,
    mode: "place_search" as const,
    searchTerm: "coffee shop",
    searchLocation: { label: "Beacon, NY" },
    discoveryLimit: 10,
    status: "completed" as const,
    queryMetadata: {},
    resultMetadata: {},
  };
}
