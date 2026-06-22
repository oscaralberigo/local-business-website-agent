import { describe, expect, it, vi } from "vitest";

import { runDiscovery } from "../src/discovery/run-discovery.js";
import { InMemoryProspectRegistry } from "../src/persistence/in-memory-prospect-registry.js";
import { assessWebsiteOpportunity } from "../src/website-assessment/assess-website-opportunity.js";
import type { WebsiteReviewerAgent } from "../src/website-assessment/types.js";
import { createWebsiteReviewerAgent } from "../src/website-assessment/website-reviewer-agent.js";

describe("Website Assessment", () => {
  it("persists Website Reviewer Agent evidence and derives Preview Eligibility for upgrade opportunities", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoveryRun = await runDiscovery({
      request: {
        mode: "place_search",
        searchTerm: "salon",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/assessment-salon",
              name: "Assessment Salon",
              formattedAddress: "1 Main St",
              websiteUrl: "https://assessment-salon.example",
              categories: ["salon"],
              sourcePayload: { placeId: "places/assessment-salon" },
            },
          ];
        },
      },
    });
    const prospectBusiness = discoveryRun.discoveredProspects[0]!;
    const reviewerAgent: WebsiteReviewerAgent = {
      review: vi.fn(async () => ({
        opportunityCategory: "outdated_or_low_quality" as const,
        confidence: 0.84,
        summary: "The current website is reachable but the mobile experience hides key booking information.",
        evidence: [
          {
            claim: "The mobile screenshot shows the booking link below a long hero section.",
            source: "mobile_screenshot" as const,
          },
          {
            claim: "The deterministic checks found HTTPS and contact information.",
            source: "deterministic_check" as const,
          },
        ],
        recommendedPitchAngle: "modern_upgrade" as const,
        outreachSafeClaims: ["I noticed your current website could make booking easier to find on mobile."],
        operatorReviewNotes: ["Verify that the booking link is still hard to find before outreach."],
      })),
    };

    const websiteAssessment = await assessWebsiteOpportunity({
      prospectBusiness,
      reviewerAgent,
      assessmentStore: registry,
      input: {
        currentWebsiteUrl: "https://assessment-salon.example",
        htmlText: "<html><body><h1>Assessment Salon</h1><a>Book</a></body></html>",
        deterministicChecks: {
          pageLoad: "reachable",
          https: "valid",
          mobileViewport: "rendered",
          contactInformationFound: true,
          servicesFound: true,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
        desktopScreenshot: {
          uri: "s3://screenshots/assessment-salon-desktop.png",
          capturedAt: new Date("2026-06-22T16:00:00.000Z"),
        },
        mobileScreenshot: {
          uri: "s3://screenshots/assessment-salon-mobile.png",
          capturedAt: new Date("2026-06-22T16:01:00.000Z"),
        },
      },
    });

    expect(reviewerAgent.review).toHaveBeenCalledWith({
      prospectBusiness,
      input: expect.objectContaining({
        currentWebsiteUrl: "https://assessment-salon.example",
        htmlText: expect.stringContaining("Assessment Salon"),
      }),
    });
    expect(websiteAssessment).toMatchObject({
      prospectBusinessId: prospectBusiness.id,
      opportunityCategory: "outdated_or_low_quality",
      confidence: 0.84,
      evidence: [
        { source: "mobile_screenshot" },
        { source: "deterministic_check" },
      ],
      previewEligibility: {
        eligibleByDefault: true,
        requiresOperatorReview: false,
        overriddenByOperator: false,
      },
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusiness.id);
    expect(prospectDetail.websiteAssessment).toMatchObject({
      opportunityCategory: "outdated_or_low_quality",
      safeClaims: ["I noticed your current website could make booking easier to find on mobile."],
      reviewNotes: ["Verify that the booking link is still hard to find before outreach."],
      previewEligibility: {
        eligibleByDefault: true,
        effectiveEligible: true,
      },
    });
  });

  it("keeps unknown opportunities review-gated until the operator overrides Preview Eligibility", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoveryRun = await runDiscovery({
      request: {
        mode: "place_search",
        searchTerm: "restaurant",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/unknown-restaurant",
              name: "Unknown Restaurant",
              websiteUrl: "https://unknown-restaurant.example",
              categories: ["restaurant"],
              sourcePayload: { placeId: "places/unknown-restaurant" },
            },
          ];
        },
      },
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const assessment = await registry.saveWebsiteAssessment({
      prospectBusinessId,
      input: {
        currentWebsiteUrl: "https://unknown-restaurant.example",
        deterministicChecks: {
          pageLoad: "not_checked",
          https: "not_checked",
          mobileViewport: "not_checked",
          contactInformationFound: false,
          servicesFound: false,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
      },
      reviewerOutput: {
        opportunityCategory: "unknown",
        confidence: 0.31,
        summary: "The available evidence is incomplete.",
        evidence: [
          {
            claim: "Desktop and mobile screenshots were not available.",
            source: "deterministic_check",
          },
        ],
        recommendedPitchAngle: "uncertain",
        outreachSafeClaims: [],
        operatorReviewNotes: ["Review the website manually before generation."],
      },
    });

    expect(assessment.previewEligibility).toMatchObject({
      eligibleByDefault: false,
      effectiveEligible: false,
      requiresOperatorReview: true,
      overriddenByOperator: false,
    });

    const overriddenAssessment = await registry.overridePreviewEligibility({
      prospectBusinessId,
      eligible: true,
      reason: "Operator confirmed the current website is incomplete and wants a preview.",
      actor: "operator",
      overriddenAt: new Date("2026-06-22T16:20:00.000Z"),
    });

    expect(overriddenAssessment.previewEligibility).toMatchObject({
      eligibleByDefault: false,
      effectiveEligible: true,
      requiresOperatorReview: true,
      overriddenByOperator: true,
      override: {
        eligible: true,
        reason: "Operator confirmed the current website is incomplete and wants a preview.",
        actor: "operator",
      },
    });
  });

  it("classifies existing websites as possible upgrade opportunities from deterministic evidence", async () => {
    const reviewerAgent = createWebsiteReviewerAgent();

    const reviewerOutput = await reviewerAgent.review({
      prospectBusiness: {
        id: "prospect-website-upgrade",
        googlePlaceId: "places/website-upgrade",
        name: "Website Upgrade Cafe",
        websiteUrl: "https://website-upgrade.example",
        categories: ["cafe"],
        prospectStatus: "discovered",
        sourceData: { placeId: "places/website-upgrade" },
        firstSeenAt: new Date("2026-06-22T17:00:00.000Z"),
        lastSeenAt: new Date("2026-06-22T17:00:00.000Z"),
      },
      input: {
        currentWebsiteUrl: "https://website-upgrade.example",
        htmlText: "<main>Website Upgrade Cafe</main>",
        deterministicChecks: {
          pageLoad: "reachable",
          https: "valid",
          mobileViewport: "failed",
          contactInformationFound: false,
          servicesFound: true,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
        mobileScreenshot: {
          uri: "s3://screenshots/website-upgrade-mobile.png",
          capturedAt: new Date("2026-06-22T17:01:00.000Z"),
        },
      },
    });

    expect(reviewerOutput).toMatchObject({
      opportunityCategory: "outdated_or_low_quality",
      recommendedPitchAngle: "modern_upgrade",
    });
    expect(reviewerOutput.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "deterministic_check",
          claim: "The mobile viewport check failed.",
        }),
      ]),
    );
    expect(reviewerOutput.outreachSafeClaims).toEqual([
      "I noticed some opportunities to make the current website easier for visitors to use.",
    ]);
  });
});
