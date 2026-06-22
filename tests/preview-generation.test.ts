import { describe, expect, it } from "vitest";

import { createWebsiteBuilderAgent } from "../src/preview-generation/website-builder-agent.js";
import { createWebsiteDesignerAgent } from "../src/preview-generation/website-designer-agent.js";

describe("Preview Website generation agents", () => {
  it("designs an adaptive plan from Business Context and Website Assessment evidence", async () => {
    const designer = createWebsiteDesignerAgent();

    const designPlan = await designer.design({
      prospectBusiness: prospectBusinessDetail(),
      businessContext: businessContext(),
      websiteAssessment: websiteAssessment(),
    });

    expect(designPlan).toMatchObject({
      siteType: "multi_section",
      primaryGoal: "menu_view",
      pitchAngle: "modern_upgrade",
      navigation: {
        style: "prominent_cta",
        items: expect.arrayContaining(["Menu", "Visit"]),
      },
    });
    expect(designPlan.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining(["hero", "menu", "visit"]),
    );
    expect(designPlan.sections[0]?.requiredEvidence).toContain(
      "Detail Cafe serves house-roasted coffee.",
    );
    expect(designPlan.avoid).toContain("Do not invent prices, hours, reviews, awards, credentials, or testimonials.");
  });

  it("builds a source-backed Generated Svelte Website with noindex static assets", async () => {
    const designer = createWebsiteDesignerAgent();
    const builder = createWebsiteBuilderAgent();
    const context = businessContext();
    const prospectBusiness = prospectBusinessDetail();
    const designPlan = await designer.design({
      prospectBusiness,
      businessContext: context,
      websiteAssessment: websiteAssessment(),
    });

    const generatedWebsite = await builder.build({
      prospectBusiness,
      designPlan,
      supportedClaims: context.supportedClaims,
    });

    expect(generatedWebsite.contentJson).toMatchObject({
      hero: {
        headline: "Detail Cafe",
        supportedClaim: "Detail Cafe serves house-roasted coffee.",
      },
    });
    expect(generatedWebsite.sourceFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "src/App.svelte",
          contents: expect.stringContaining("Detail Cafe"),
        }),
      ]),
    );
    expect(generatedWebsite.staticAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "dist/index.html",
          contents: expect.stringContaining("noindex"),
        }),
      ]),
    );
    expect(
      generatedWebsite.staticAssets.find((asset) => asset.relativePath === "dist/index.html")?.contents,
    ).toContain("Detail Cafe serves house-roasted coffee.");
    expect(generatedWebsite.buildMetadata).toMatchObject({
      builder: "svelte",
      status: "built",
    });
  });
});

function prospectBusinessDetail() {
  return {
    id: "prospect-1",
    googlePlaceId: "places/detail-cafe",
    name: "Detail Cafe",
    formattedAddress: "1 Detail St, Beacon, NY",
    categories: ["cafe"],
    prospectStatus: "assessment_complete" as const,
    sourceData: { placeId: "places/detail-cafe" },
    firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
    firstDiscoveredRun: discoveryRunStub(),
    latestDiscoveredRun: discoveryRunStub(),
    appearanceHistory: [],
  };
}

function businessContext() {
  return {
    prospectBusinessId: "prospect-1",
    researchMode: "expanded" as const,
    sources: [
      {
        id: "source-1",
        prospectBusinessId: "prospect-1",
        sourceType: "business_website" as const,
        title: "Detail Cafe menu",
        url: "https://detail.example/menu",
        retrievedAt: new Date("2026-06-22T15:00:00.000Z"),
        termsCompliance: {
          allowed: true,
          checkedAt: new Date("2026-06-22T15:00:00.000Z"),
        },
      },
    ],
    facts: [
      {
        id: "fact-1",
        prospectBusinessId: "prospect-1",
        sourceId: "source-1",
        label: "Menu specialty",
        value: "Detail Cafe serves house-roasted coffee.",
        allowedForGeneration: true,
      },
    ],
    excludedResearchData: [],
    supportedClaims: [
      {
        id: "claim-1",
        prospectBusinessId: "prospect-1",
        statement: "Detail Cafe serves house-roasted coffee.",
        evidence: [{ sourceId: "source-1", factId: "fact-1" }],
        allowedForGeneration: true,
      },
    ],
  };
}

function websiteAssessment() {
  return {
    id: "assessment-1",
    prospectBusinessId: "prospect-1",
    deterministicChecks: {
      pageLoad: "reachable" as const,
      https: "valid" as const,
      mobileViewport: "rendered" as const,
      contactInformationFound: true,
      servicesFound: true,
      brokenAssetsOrConsoleErrors: false,
      thirdPartyOnlyPresence: false,
    },
    opportunityCategory: "outdated_or_low_quality" as const,
    confidence: 0.77,
    summary: "The site is reachable, but key cafe details are hard to scan on mobile.",
    evidence: [
      {
        claim: "The mobile screenshot shows contact details below several long sections.",
        source: "mobile_screenshot" as const,
      },
    ],
    recommendedPitchAngle: "modern_upgrade" as const,
    safeClaims: ["The current website could make contact details easier to find."],
    reviewNotes: ["Verify the mobile contact section before outreach."],
    previewEligibility: {
      eligibleByDefault: true,
      effectiveEligible: true,
      requiresOperatorReview: false,
      overriddenByOperator: false,
      reason: "This Opportunity Category is preview-eligible by default.",
    },
    assessedAt: new Date("2026-06-22T16:50:00.000Z"),
  };
}

function discoveryRunStub() {
  return {
    id: "run-1",
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
