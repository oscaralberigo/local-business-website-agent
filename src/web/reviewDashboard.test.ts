import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { BusinessContextResearcher } from "../business-context/types.js";
import type { ContactFinderAgent } from "../contact-finder/types.js";
import { loadRuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { createReviewDashboardApp } from "./app.js";
import type { WebsiteReviewerAgent } from "../website-assessment/types.js";

const baseConfiguration = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  PREVIEW_BASE_URL: "https://previews.example.com",
  OPERATOR_USERNAME: "operator",
  OPERATOR_PASSWORD: "correct horse battery staple",
  OPERATOR_SESSION_SECRET: "session-secret-that-must-not-render",
  DATABASE_URL: "postgres://operator:database-secret@postgres:5432/local_business_agent",
  GOOGLE_PLACES_API_KEY: "google-places-secret",
  OPENAI_API_KEY: "openai-secret",
  RESEND_API_KEY: "resend-secret",
  REVIEW_REQUIRE_PREVIEW_PUBLICATION: "true",
  REVIEW_REQUIRE_OUTREACH_SENDING: "true",
  DISCOVERY_LIMIT: "25"
};

describe("Review Dashboard bootstrap slice", () => {
  it("protects the dashboard, lets the operator log in, writes a baseline audit event, and never renders secret values", async () => {
    const secretValues = {
      operatorPassword: "correct horse battery staple",
      sessionSecret: "session-secret-that-must-not-render",
      databaseUrl: "postgres://operator:database-secret@postgres:5432/local_business_agent",
      googlePlacesKey: "google-places-secret",
      openAiKey: "openai-secret",
      resendKey: "resend-secret"
    };

    const configuration = loadRuntimeConfiguration({
      ...baseConfiguration,
      OPERATOR_PASSWORD: secretValues.operatorPassword,
      OPERATOR_SESSION_SECRET: secretValues.sessionSecret,
      DATABASE_URL: secretValues.databaseUrl,
      GOOGLE_PLACES_API_KEY: secretValues.googlePlacesKey,
      OPENAI_API_KEY: secretValues.openAiKey,
      RESEND_API_KEY: secretValues.resendKey
    });

    const events: Array<{
      id: number;
      occurredAt: Date;
      actor: string;
      eventType: string;
      summary: string;
    }> = [];

    const auditTrail = {
      verifyConnection: vi.fn(async () => ({ connected: true })),
      record: vi.fn(async (event: { actor: string; eventType: string; summary: string }) => {
        events.unshift({
          id: events.length + 1,
          occurredAt: new Date("2026-06-22T14:30:00.000Z"),
          ...event
        });
      }),
      listRecent: vi.fn(async () => events)
    };

    const app = createReviewDashboardApp({ auditTrail, configuration });
    const operator = request.agent(app);

    await operator.get("/dashboard").expect(302).expect("Location", "/login");

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: secretValues.operatorPassword })
      .expect(302)
      .expect("Location", "/dashboard");

    await operator.post("/audit-trail/baseline").expect(302).expect("Location", "/dashboard");

    const response = await operator.get("/dashboard").expect(200);

    expect(response.text).toContain("Settings / Config Readout");
    expect(response.text).toContain("Preview base URL");
    expect(response.text).toContain("https://previews.example.com");
    expect(response.text).toContain("Postgres connection");
    expect(response.text).toContain("Connected");
    expect(response.text).toContain("Audit Trail");
    expect(response.text).toContain("Baseline audit trail event recorded from Review Dashboard.");
    expect(response.text).toContain("operator.authenticated");

    for (const secret of Object.values(secretValues)) {
      expect(response.text).not.toContain(secret);
    }
  });

  it("serves authenticated Prospect Business detail with first/latest Discovery Run and appearance history", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => ({
        id: "prospect-1",
        googlePlaceId: "places/detail-cafe",
        name: "Detail Cafe",
        formattedAddress: "1 Detail St",
        categories: ["cafe"],
        prospectStatus: "discovered" as const,
        sourceData: { version: "latest" },
        firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
        lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
        firstDiscoveredRun: {
          id: "run-1",
          source: "google_places" as const,
          mode: "place_search" as const,
          searchTerm: "coffee shop",
          searchLocation: { label: "Beacon, NY" },
          discoveryLimit: 10,
          status: "completed" as const,
          queryMetadata: {},
          resultMetadata: {},
        },
        latestDiscoveredRun: {
          id: "run-2",
          source: "google_places" as const,
          mode: "radius_search" as const,
          searchTerm: "espresso bar",
          searchLocation: { label: "Beacon, NY" },
          discoveryLimit: 10,
          status: "completed" as const,
          queryMetadata: {},
          resultMetadata: {},
        },
        appearanceHistory: [
          {
            discoveryRunId: "run-1",
            prospectBusinessId: "prospect-1",
            rank: 1,
            providerPayload: { version: "first" },
            appearedAt: new Date("2026-06-20T10:00:00.000Z"),
            discoveryRun: {
              id: "run-1",
              source: "google_places" as const,
              mode: "place_search" as const,
              searchTerm: "coffee shop",
              searchLocation: { label: "Beacon, NY" },
              discoveryLimit: 10,
              status: "completed" as const,
              queryMetadata: {},
              resultMetadata: {},
            },
          },
          {
            discoveryRunId: "run-2",
            prospectBusinessId: "prospect-1",
            rank: 2,
            providerPayload: { version: "latest" },
            appearedAt: new Date("2026-06-21T11:00:00.000Z"),
            discoveryRun: {
              id: "run-2",
              source: "google_places" as const,
              mode: "radius_search" as const,
              searchTerm: "espresso bar",
              searchLocation: { label: "Beacon, NY" },
              discoveryLimit: 10,
              status: "completed" as const,
              queryMetadata: {},
              resultMetadata: {},
            },
          },
        ],
      })),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator.get("/api/prospect-businesses/prospect-1").expect(200);

    expect(response.body.prospectBusiness).toMatchObject({
      id: "prospect-1",
      name: "Detail Cafe",
      firstDiscoveredRun: {
        id: "run-1",
        searchTerm: "coffee shop",
      },
      latestDiscoveredRun: {
        id: "run-2",
        searchTerm: "espresso bar",
      },
      appearanceHistory: [
        {
          discoveryRunId: "run-1",
          rank: 1,
          providerPayload: { version: "first" },
        },
        {
          discoveryRunId: "run-2",
          rank: 2,
          providerPayload: { version: "latest" },
        },
      ],
    });
    expect(prospectRegistry.getProspectBusinessDetail).toHaveBeenCalledWith("prospect-1");
  });

  it("lets the operator trigger expanded Business Context research and returns source-backed Supported Claims", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/detail-cafe",
      name: "Detail Cafe",
      formattedAddress: "1 Detail St",
      categories: ["cafe"],
      prospectStatus: "discovered" as const,
      sourceData: { placeId: "places/detail-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
    };
    const persistedContext = {
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
            robotsDirective: "index,follow",
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
          sourceQuote: "House-roasted coffee",
          allowedForGeneration: true,
        },
      ],
      excludedResearchData: [
        {
          id: "excluded-1",
          prospectBusinessId: "prospect-1",
          sourceId: "source-1",
          label: "Personal mobile number",
          valueSummary: "A staff member mobile number appeared on the page.",
          reason: "personal_contact" as const,
          excludedAt: new Date("2026-06-22T15:00:00.000Z"),
        },
      ],
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
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveBusinessContext: vi.fn(async () => persistedContext),
    };
    const businessContextResearcher: BusinessContextResearcher = {
      research: vi.fn(async () => ({
        researchMode: "expanded" as const,
        sources: persistedContext.sources.map(({ id: _id, prospectBusinessId: _prospectBusinessId, retrievedAt: _retrievedAt, ...source }) => source),
        facts: persistedContext.facts.map(({ id: _id, prospectBusinessId: _prospectBusinessId, ...fact }) => fact),
        excludedResearchData: persistedContext.excludedResearchData.map(({ id: _id, prospectBusinessId: _prospectBusinessId, excludedAt: _excludedAt, ...excluded }) => excluded),
      })),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      businessContextResearcher,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/business-context-research")
      .send({})
      .expect(201);

    expect(businessContextResearcher.research).toHaveBeenCalledWith({
      prospectBusiness,
      researchMode: "expanded",
    });
    expect(prospectRegistry.saveBusinessContext).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      researchMode: "expanded",
      sources: expect.any(Array),
      facts: expect.any(Array),
      excludedResearchData: expect.any(Array),
    });
    expect(response.body.businessContext).toMatchObject({
      prospectBusinessId: "prospect-1",
      researchMode: "expanded",
      sources: [{ id: "source-1", sourceType: "business_website", url: "https://detail.example/menu" }],
      facts: [{ id: "fact-1", sourceId: "source-1", allowedForGeneration: true }],
      excludedResearchData: [{ id: "excluded-1", reason: "personal_contact" }],
      supportedClaims: [
        {
          id: "claim-1",
          statement: "Detail Cafe serves house-roasted coffee.",
          evidence: [{ sourceId: "source-1", factId: "fact-1" }],
          allowedForGeneration: true,
        },
      ],
    });
  });

  it("lets the operator trigger Website Assessment and returns evidence-backed Preview Eligibility", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/detail-cafe",
      name: "Detail Cafe",
      websiteUrl: "https://detail.example",
      categories: ["cafe"],
      prospectStatus: "discovered" as const,
      sourceData: { placeId: "places/detail-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
    };
    const websiteAssessment = {
      id: "assessment-1",
      prospectBusinessId: "prospect-1",
      currentWebsiteUrl: "https://detail.example",
      htmlText: "<main>Detail Cafe</main>",
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
      safeClaims: ["I noticed the current website could make contact details easier to find."],
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
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveWebsiteAssessment: vi.fn(async () => websiteAssessment),
      overridePreviewEligibility: vi.fn(),
      getWebsiteAssessment: vi.fn(),
    };
    const websiteReviewerAgent: WebsiteReviewerAgent = {
      review: vi.fn(async () => ({
        opportunityCategory: "outdated_or_low_quality" as const,
        confidence: 0.77,
        summary: "The site is reachable, but key cafe details are hard to scan on mobile.",
        evidence: websiteAssessment.evidence,
        recommendedPitchAngle: "modern_upgrade" as const,
        outreachSafeClaims: websiteAssessment.safeClaims,
        operatorReviewNotes: websiteAssessment.reviewNotes,
      })),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      websiteReviewerAgent,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/website-assessment")
      .send({
        currentWebsiteUrl: "https://detail.example",
        htmlText: "<main>Detail Cafe</main>",
        deterministicChecks: websiteAssessment.deterministicChecks,
        desktopScreenshot: {
          uri: "s3://screenshots/detail-cafe-desktop.png",
          capturedAt: "2026-06-22T16:48:00.000Z",
        },
        mobileScreenshot: {
          uri: "s3://screenshots/detail-cafe-mobile.png",
          capturedAt: "2026-06-22T16:49:00.000Z",
        },
      })
      .expect(201);

    expect(websiteReviewerAgent.review).toHaveBeenCalledWith({
      prospectBusiness,
      input: expect.objectContaining({
        currentWebsiteUrl: "https://detail.example",
        htmlText: "<main>Detail Cafe</main>",
        deterministicChecks: websiteAssessment.deterministicChecks,
      }),
    });
    expect(prospectRegistry.saveWebsiteAssessment).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      input: expect.objectContaining({
        currentWebsiteUrl: "https://detail.example",
        mobileScreenshot: {
          uri: "s3://screenshots/detail-cafe-mobile.png",
          capturedAt: new Date("2026-06-22T16:49:00.000Z"),
        },
      }),
      reviewerOutput: expect.objectContaining({
        opportunityCategory: "outdated_or_low_quality",
        confidence: 0.77,
      }),
    });
    expect(response.body.websiteAssessment).toMatchObject({
      opportunityCategory: "outdated_or_low_quality",
      evidence: [{ source: "mobile_screenshot" }],
      previewEligibility: {
        eligibleByDefault: true,
        effectiveEligible: true,
      },
    });

    const dashboard = await operator.get("/dashboard").expect(200);
    expect(dashboard.text).toContain("Website Assessment");
    expect(dashboard.text).toContain("Preview Eligibility");
  });

  it("lets the operator find, approve, and add Contact Evidence", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/detail-cafe",
      name: "Detail Cafe",
      websiteUrl: "https://detail.example",
      categories: ["cafe"],
      prospectStatus: "assessment_complete" as const,
      sourceData: { placeId: "places/detail-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
    };
    const foundContactEvidence = [
      {
        id: "contact-1",
        prospectBusinessId: "prospect-1",
        emailAddress: "hello@detail.example",
        sourceUrl: "https://detail.example/contact",
        sourceType: "business_website" as const,
        confidence: 0.95,
        roleClassification: "role" as const,
        outreachApprovalStatus: "pending_operator_approval" as const,
        reason: "Published on the official contact page.",
        foundAt: new Date("2026-06-22T18:30:00.000Z"),
      },
    ];
    const approvedContactEvidence = {
      ...foundContactEvidence[0]!,
      outreachApprovalStatus: "approved" as const,
      approvedAt: new Date("2026-06-22T18:35:00.000Z"),
      approvedBy: "operator",
      approvalReason: "Operator verified this is the correct inbox.",
    };
    const manuallyAddedContactEvidence = {
      id: "contact-2",
      prospectBusinessId: "prospect-1",
      emailAddress: "bookings@detail.example",
      sourceUrl: "https://detail.example/contact",
      sourceType: "business_website" as const,
      confidence: 1,
      roleClassification: "role" as const,
      outreachApprovalStatus: "approved" as const,
      reason: "Operator verified this contact path manually.",
      foundAt: new Date("2026-06-22T18:40:00.000Z"),
      approvedAt: new Date("2026-06-22T18:40:00.000Z"),
      approvedBy: "operator",
      approvalReason: "Operator verified this contact path manually.",
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveContactEvidence: vi.fn(async () => foundContactEvidence),
      approveContactEvidence: vi.fn(async () => approvedContactEvidence),
      addVerifiedContactEvidence: vi.fn(async () => manuallyAddedContactEvidence),
    };
    const contactFinderAgent: ContactFinderAgent = {
      findContact: vi.fn(async () => [
        {
          emailAddress: "hello@detail.example",
          sourceUrl: "https://detail.example/contact",
          sourceType: "business_website" as const,
          confidence: 0.95,
          roleClassification: "role" as const,
          acquisitionMethod: "published" as const,
          reason: "Published on the official contact page.",
        },
      ]),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      contactFinderAgent,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const findResponse = await operator
      .post("/api/prospect-businesses/prospect-1/contact-finding")
      .send({})
      .expect(201);

    expect(contactFinderAgent.findContact).toHaveBeenCalledWith({ prospectBusiness });
    expect(prospectRegistry.saveContactEvidence).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      candidates: expect.any(Array),
    });
    expect(findResponse.body.contactEvidence).toMatchObject([
      {
        id: "contact-1",
        sourceUrl: "https://detail.example/contact",
        outreachApprovalStatus: "pending_operator_approval",
      },
    ]);

    const approvalResponse = await operator
      .post("/api/prospect-businesses/prospect-1/contact-evidence/contact-1/approval")
      .send({ reason: "Operator verified this is the correct inbox." })
      .expect(200);

    expect(prospectRegistry.approveContactEvidence).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      contactEvidenceId: "contact-1",
      actor: "operator",
      reason: "Operator verified this is the correct inbox.",
    });
    expect(approvalResponse.body.contactEvidence).toMatchObject({
      id: "contact-1",
      outreachApprovalStatus: "approved",
      approvedBy: "operator",
    });

    const manualResponse = await operator
      .post("/api/prospect-businesses/prospect-1/contact-evidence")
      .send({
        emailAddress: "bookings@detail.example",
        sourceUrl: "https://detail.example/contact",
        sourceType: "business_website",
        reason: "Operator verified this contact path manually.",
      })
      .expect(201);

    expect(prospectRegistry.addVerifiedContactEvidence).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      emailAddress: "bookings@detail.example",
      sourceUrl: "https://detail.example/contact",
      sourceType: "business_website",
      reason: "Operator verified this contact path manually.",
      actor: "operator",
    });
    expect(manualResponse.body.contactEvidence).toMatchObject({
      emailAddress: "bookings@detail.example",
      outreachApprovalStatus: "approved",
    });
  });

  it("lets the operator override Preview Eligibility with a reason", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const overriddenAssessment = {
      id: "assessment-1",
      prospectBusinessId: "prospect-1",
      deterministicChecks: {
        pageLoad: "not_checked" as const,
        https: "not_checked" as const,
        mobileViewport: "not_checked" as const,
        contactInformationFound: false,
        servicesFound: false,
        brokenAssetsOrConsoleErrors: false,
        thirdPartyOnlyPresence: false,
      },
      opportunityCategory: "unknown" as const,
      confidence: 0.31,
      summary: "Evidence is incomplete.",
      evidence: [],
      recommendedPitchAngle: "uncertain" as const,
      safeClaims: [],
      reviewNotes: [],
      previewEligibility: {
        eligibleByDefault: false,
        effectiveEligible: true,
        requiresOperatorReview: true,
        overriddenByOperator: true,
        reason: "Unknown Website Opportunities require operator review before preview generation.",
        override: {
          eligible: true,
          reason: "Operator confirmed this should receive a preview.",
          actor: "operator",
          overriddenAt: new Date("2026-06-22T17:10:00.000Z"),
        },
      },
      assessedAt: new Date("2026-06-22T17:00:00.000Z"),
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(),
      overridePreviewEligibility: vi.fn(async () => overriddenAssessment),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/preview-eligibility-override")
      .send({
        eligible: true,
        reason: "Operator confirmed this should receive a preview.",
      })
      .expect(200);

    expect(prospectRegistry.overridePreviewEligibility).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      eligible: true,
      reason: "Operator confirmed this should receive a preview.",
      actor: "operator",
    });
    expect(response.body.websiteAssessment.previewEligibility).toMatchObject({
      effectiveEligible: true,
      overriddenByOperator: true,
      override: {
        reason: "Operator confirmed this should receive a preview.",
        actor: "operator",
      },
    });
  });
});

function createAuditTrailStub() {
  return {
    verifyConnection: vi.fn(async () => ({ connected: true })),
    record: vi.fn(async () => undefined),
    listRecent: vi.fn(async () => [])
  };
}

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
