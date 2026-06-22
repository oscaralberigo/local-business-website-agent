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

  it("persists Website Assessment evidence and operator Preview Eligibility overrides", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/modern-cafe",
        name: "Modern Cafe",
        websiteUrl: "https://modern-cafe.example",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/modern-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    await registry.saveWebsiteAssessment({
      prospectBusinessId,
      input: {
        currentWebsiteUrl: "https://modern-cafe.example",
        htmlText: "<main>Modern Cafe menu and booking</main>",
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
          uri: "s3://screenshots/modern-cafe-desktop.png",
          capturedAt: new Date("2026-06-22T16:30:00.000Z"),
        },
        mobileScreenshot: {
          uri: "s3://screenshots/modern-cafe-mobile.png",
          capturedAt: new Date("2026-06-22T16:31:00.000Z"),
        },
      },
      reviewerOutput: {
        opportunityCategory: "modern_sufficient",
        confidence: 0.91,
        summary: "The website is modern, mobile-friendly, and includes clear contact paths.",
        evidence: [
          {
            claim: "The mobile screenshot shows clear navigation and contact details.",
            source: "mobile_screenshot",
          },
        ],
        recommendedPitchAngle: "no_outreach",
        outreachSafeClaims: [],
        operatorReviewNotes: ["No preview should be generated by default."],
      },
      assessedAt: new Date("2026-06-22T16:32:00.000Z"),
    });

    const storedProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(storedProspect.prospectStatus).toBe("not_preview_eligible");
    expect(storedProspect.websiteAssessment).toMatchObject({
      prospectBusinessId,
      currentWebsiteUrl: "https://modern-cafe.example",
      opportunityCategory: "modern_sufficient",
      evidence: [{ source: "mobile_screenshot" }],
      safeClaims: [],
      reviewNotes: ["No preview should be generated by default."],
      previewEligibility: {
        eligibleByDefault: false,
        effectiveEligible: false,
        requiresOperatorReview: false,
        overriddenByOperator: false,
      },
    });

    const overriddenAssessment = await registry.overridePreviewEligibility({
      prospectBusinessId,
      eligible: true,
      reason: "Operator wants to show a premium redesign concept.",
      actor: "operator",
      overriddenAt: new Date("2026-06-22T16:40:00.000Z"),
    });

    expect(overriddenAssessment.previewEligibility).toMatchObject({
      eligibleByDefault: false,
      effectiveEligible: true,
      overriddenByOperator: true,
      override: {
        reason: "Operator wants to show a premium redesign concept.",
        actor: "operator",
      },
    });

    const updatedProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(updatedProspect.prospectStatus).toBe("assessment_complete");

    await pool.end();
  });

  it("persists Contact Evidence and lets the operator add a verified contact path", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/contact-cafe",
        name: "Contact Cafe",
        websiteUrl: "https://contact-cafe.example",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/contact-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const contactEvidence = await registry.saveContactEvidence({
      prospectBusinessId,
      foundAt: new Date("2026-06-22T18:10:00.000Z"),
      candidates: [
        {
          emailAddress: "hello@contact-cafe.example",
          sourceUrl: "https://contact-cafe.example/contact",
          sourceType: "business_website",
          confidence: 0.94,
          roleClassification: "role",
          acquisitionMethod: "published",
          reason: "Published on the official contact page.",
        },
      ],
    });

    expect(contactEvidence).toEqual([
      expect.objectContaining({
        sourceUrl: "https://contact-cafe.example/contact",
        sourceType: "business_website",
        confidence: 0.94,
        roleClassification: "role",
        outreachApprovalStatus: "pending_operator_approval",
      }),
    ]);

    const manuallyAdded = await registry.addVerifiedContactEvidence({
      prospectBusinessId,
      emailAddress: "bookings@contact-cafe.example",
      sourceUrl: "https://contact-cafe.example/private-operator-notes",
      sourceType: "business_website",
      reason: "Operator verified this inbox during a manual review.",
      actor: "operator",
      approvedAt: new Date("2026-06-22T18:20:00.000Z"),
    });

    expect(manuallyAdded).toMatchObject({
      emailAddress: "bookings@contact-cafe.example",
      outreachApprovalStatus: "approved",
      approvedBy: "operator",
      approvalReason: "Operator verified this inbox during a manual review.",
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.prospectStatus).toBe("drafting_outreach");
    expect(prospectDetail.contactEvidence).toEqual([
      expect.objectContaining({
        emailAddress: "hello@contact-cafe.example",
        outreachApprovalStatus: "pending_operator_approval",
      }),
      expect.objectContaining({
        emailAddress: "bookings@contact-cafe.example",
        outreachApprovalStatus: "approved",
        approvedBy: "operator",
      }),
    ]);

    await expectCount(pool, "contact_evidence", prospectBusinessId, 2);

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
