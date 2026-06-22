import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { BusinessContextResearcher } from "../business-context/types.js";
import type { ContactFinderAgent } from "../contact-finder/types.js";
import { loadRuntimeConfiguration } from "../config/runtimeConfiguration.js";
import type { OutreachDrafterAgent } from "../outreach/types.js";
import type {
  PreviewArtifactStore,
  PreviewWebsite,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "../preview-generation/types.js";
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

  it("generates an eligible Prospect Business Preview Website with Svelte artifacts and reviewable fields", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/detail-cafe",
      name: "Detail Cafe",
      formattedAddress: "1 Detail St, Beacon, NY",
      categories: ["cafe"],
      prospectStatus: "assessment_complete" as const,
      sourceData: { placeId: "places/detail-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
      businessContext: {
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
      },
      websiteAssessment: {
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
      },
    };
    const designPlan = {
      siteType: "multi_section" as const,
      primaryGoal: "menu_view" as const,
      targetCustomer: "People in Beacon looking for coffee and a clear menu before visiting.",
      pitchAngle: "modern_upgrade" as const,
      sections: [
        {
          id: "hero",
          title: "House-roasted coffee in Beacon",
          purpose: "Lead with the supported cafe specialty and location.",
          requiredEvidence: ["Detail Cafe serves house-roasted coffee."],
          contentGuidance: "Use the supported claim as the hero message.",
        },
      ],
      navigation: {
        style: "prominent_cta" as const,
        items: ["Home", "Menu", "Visit"],
      },
      features: [
        {
          name: "Menu CTA",
          purpose: "Send visitors to the public menu.",
          evidence: "https://detail.example/menu",
        },
      ],
      avoid: ["Do not invent prices, hours, reviews, or awards."],
      operatorReviewNotes: ["Confirm the menu link still works before publication."],
    };
    const generatedWebsite = {
      contentJson: {
        hero: {
          headline: "House-roasted coffee in Beacon",
          body: "Detail Cafe serves house-roasted coffee.",
        },
      },
      sourceFiles: [
        {
          relativePath: "src/App.svelte",
          contents: "<script>export let content;</script><main>{content.hero.headline}</main>",
        },
      ],
      staticAssets: [
        {
          relativePath: "dist/index.html",
          contents: "<!doctype html><meta name=\"robots\" content=\"noindex\"><div id=\"app\"></div>",
        },
      ],
      buildMetadata: {
        builder: "svelte" as const,
        command: "npm run build:previews",
        status: "built" as const,
      },
    };
    const savedPreviewWebsite = {
      id: "preview-1",
      prospectBusinessId: "prospect-1",
      slug: "detail-cafe-prospect-1",
      status: "ready_for_review" as const,
      designPlan,
      contentJson: generatedWebsite.contentJson,
      sourceReferences: [
        {
          sourceId: "source-1",
          factId: "fact-1",
          statement: "Detail Cafe serves house-roasted coffee.",
        },
      ],
      buildMetadata: generatedWebsite.buildMetadata,
      artifact: {
        sourceRoot: "previews/detail-cafe-prospect-1/source",
        staticRoot: "previews/detail-cafe-prospect-1/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
          value: "House-roasted coffee in Beacon",
        },
        {
          path: "contentJson.hero.body",
          label: "Hero body",
          value: "Detail Cafe serves house-roasted coffee.",
        },
        {
          path: "designPlan.sections.0.title",
          label: "Design plan sections title",
          value: "House-roasted coffee in Beacon",
        },
      ],
      createdAt: new Date("2026-06-22T19:00:00.000Z"),
      updatedAt: new Date("2026-06-22T19:00:00.000Z"),
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      savePreviewWebsite: vi.fn(async () => savedPreviewWebsite),
    };
    const websiteDesignerAgent: WebsiteDesignerAgent = {
      design: vi.fn(async () => designPlan),
    };
    const websiteBuilderAgent: WebsiteBuilderAgent = {
      build: vi.fn(async () => generatedWebsite),
    };
    const previewArtifactStore: PreviewArtifactStore = {
      writeArtifacts: vi.fn(async () => savedPreviewWebsite.artifact),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      websiteDesignerAgent,
      websiteBuilderAgent,
      previewArtifactStore,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/preview-website-generation")
      .send({})
      .expect(201);

    expect(websiteDesignerAgent.design).toHaveBeenCalledWith({
      prospectBusiness,
      businessContext: prospectBusiness.businessContext,
      websiteAssessment: prospectBusiness.websiteAssessment,
    });
    expect(websiteBuilderAgent.build).toHaveBeenCalledWith({
      prospectBusiness,
      designPlan,
      supportedClaims: prospectBusiness.businessContext.supportedClaims,
    });
    expect(previewArtifactStore.writeArtifacts).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      slug: "detail-cafe-prospect-1",
      generatedWebsite,
    });
    expect(prospectRegistry.savePreviewWebsite).toHaveBeenCalledWith(expect.objectContaining({
      prospectBusinessId: "prospect-1",
      slug: "detail-cafe-prospect-1",
      status: "ready_for_review",
      designPlan,
      contentJson: generatedWebsite.contentJson,
      sourceReferences: savedPreviewWebsite.sourceReferences,
      buildMetadata: generatedWebsite.buildMetadata,
      artifact: savedPreviewWebsite.artifact,
      operatorEditableFields: expect.arrayContaining(savedPreviewWebsite.operatorEditableFields),
    }));
    expect(response.body.previewWebsite).toMatchObject({
      id: "preview-1",
      slug: "detail-cafe-prospect-1",
      status: "ready_for_review",
      designPlan: {
        primaryGoal: "menu_view",
        navigation: {
          items: ["Home", "Menu", "Visit"],
        },
      },
      contentJson: {
        hero: {
          headline: "House-roasted coffee in Beacon",
        },
      },
      artifact: {
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
        },
        {
          path: "contentJson.hero.body",
          label: "Hero body",
        },
        {
          path: "designPlan.sections.0.title",
          label: "Design plan sections title",
        },
      ],
    });
  });

  it("renders Preview Website review controls and lets the operator edit reviewable fields", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const previewWebsite = {
      id: "preview-1",
      prospectBusinessId: "prospect-1",
      slug: "detail-cafe-prospect-1",
      status: "ready_for_review" as const,
      designPlan: {
        siteType: "multi_section" as const,
        primaryGoal: "menu_view" as const,
        targetCustomer: "People in Beacon looking for coffee before visiting.",
        pitchAngle: "modern_upgrade" as const,
        sections: [
          {
            id: "hero",
            title: "House-roasted coffee in Beacon",
            purpose: "Lead with the supported cafe specialty and location.",
            requiredEvidence: ["Detail Cafe serves house-roasted coffee."],
            contentGuidance: "Use the supported claim as the hero message.",
          },
        ],
        navigation: {
          style: "prominent_cta" as const,
          items: ["Home", "Menu", "Visit"],
        },
        features: [],
        avoid: ["Do not invent prices, hours, reviews, or awards."],
        operatorReviewNotes: ["Confirm the menu link still works before publication."],
      },
      contentJson: {
        hero: {
          headline: "House-roasted coffee in Beacon",
          body: "Detail Cafe serves house-roasted coffee.",
        },
      },
      sourceReferences: [
        {
          sourceId: "source-1",
          factId: "fact-1",
          statement: "Detail Cafe serves house-roasted coffee.",
        },
      ],
      buildMetadata: {
        builder: "svelte" as const,
        command: "npm run build:previews",
        status: "built" as const,
      },
      artifact: {
        sourceRoot: "detail-cafe-prospect-1/source",
        staticRoot: "detail-cafe-prospect-1/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
          value: "House-roasted coffee in Beacon",
        },
        {
          path: "designPlan.sections.0.title",
          label: "Hero section title",
          value: "House-roasted coffee in Beacon",
        },
      ],
      createdAt: new Date("2026-06-22T19:00:00.000Z"),
      updatedAt: new Date("2026-06-22T19:00:00.000Z"),
    };
    const editedPreviewWebsite = {
      ...previewWebsite,
      contentJson: {
        hero: {
          headline: "Coffee and pastries in Beacon",
          body: "Detail Cafe serves house-roasted coffee.",
        },
      },
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
          value: "Coffee and pastries in Beacon",
        },
        previewWebsite.operatorEditableFields[1]!,
      ],
    };
    const prospectBusiness = {
      id: "prospect-1",
      googlePlaceId: "places/detail-cafe",
      name: "Detail Cafe",
      categories: ["cafe"],
      prospectStatus: "preview_ready_for_review" as const,
      sourceData: { placeId: "places/detail-cafe" },
      firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
      lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
      firstDiscoveredRun: discoveryRunStub("run-1"),
      latestDiscoveredRun: discoveryRunStub("run-1"),
      appearanceHistory: [],
      previewWebsite,
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      updatePreviewWebsiteOperatorEdits: vi.fn(async () => editedPreviewWebsite),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const dashboard = await operator.get("/dashboard").expect(200);
    expect(dashboard.text).toContain("Preview Website");
    expect(dashboard.text).toContain("preview-frame");
    expect(dashboard.text).toContain(
      'src="/preview-artifacts/${clientEscapeHtml(preview.slug)}/${clientEscapeHtml(String(preview.artifact.indexFile || "dist/index.html"))}">',
    );
    expect(dashboard.text).not.toContain('replace(/^dist\\\\//, "")');
    expect(dashboard.text).toContain("operator-edit-form");
    expect(dashboard.text).toContain("preview-publication-form");
    expect(dashboard.text).toContain("Preview Approval reason");
    expect(dashboard.text).toContain("Publish Preview");

    const detailResponse = await operator.get("/api/prospect-businesses/prospect-1").expect(200);
    expect(detailResponse.body.prospectBusiness.previewWebsite).toMatchObject({
      slug: "detail-cafe-prospect-1",
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
        },
        {
          path: "designPlan.sections.0.title",
          label: "Hero section title",
        },
      ],
    });

    const editResponse = await operator
      .patch("/api/prospect-businesses/prospect-1/preview-website/operator-edits")
      .send({
        edits: [
          {
            path: "contentJson.hero.headline",
            value: "Coffee and pastries in Beacon",
          },
        ],
      })
      .expect(200);

    expect(prospectRegistry.updatePreviewWebsiteOperatorEdits).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      actor: "operator",
      edits: [
        {
          path: "contentJson.hero.headline",
          value: "Coffee and pastries in Beacon",
        },
      ],
    });
    expect(editResponse.body.previewWebsite.contentJson).toMatchObject({
      hero: {
        headline: "Coffee and pastries in Beacon",
      },
    });
  });

  it("lets the operator approve and publish a compliant Preview Website to an unguessable noindex Preview URL", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const previewWebsite = previewWebsiteReadyForReview();
    const prospectBusiness = {
      ...prospectBusinessWithPreview(previewWebsite),
      businessContext: {
        prospectBusinessId: "prospect-1",
        researchMode: "expanded" as const,
        sources: [],
        facts: [],
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
      },
      websiteAssessment: {
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
        confidence: 0.82,
        summary: "The current website is hard to scan on mobile.",
        evidence: [],
        recommendedPitchAngle: "modern_upgrade" as const,
        safeClaims: [],
        reviewNotes: [],
        previewEligibility: {
          eligibleByDefault: true,
          effectiveEligible: true,
          requiresOperatorReview: false,
          overriddenByOperator: false,
          reason: "This Opportunity Category is preview-eligible by default.",
        },
        assessedAt: new Date("2026-06-22T18:00:00.000Z"),
      },
    };
    const publication = {
      previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
      previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
      deploymentId: "preview-deployment-1",
      buildId: "npm-run-build-previews",
      noindex: true,
      publishedAt: new Date("2026-06-22T20:00:00.000Z"),
      approvedBy: "operator",
      approvalReason: "Preview copy and supported claims are ready.",
    };
    const publishedPreviewWebsite = {
      ...previewWebsite,
      status: "published" as const,
      publication,
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      publishPreviewWebsite: vi.fn(async () => publishedPreviewWebsite),
    };
    const previewHost = {
      publish: vi.fn(async () => publication),
      unpublish: vi.fn(),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry, previewHost });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/preview-website/publication")
      .send({ approvalReason: "Preview copy and supported claims are ready." })
      .expect(200);

    expect(previewHost.publish).toHaveBeenCalledWith({
      previewWebsite,
      previewBaseUrl: "https://previews.example.com",
    });
    expect(prospectRegistry.publishPreviewWebsite).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      actor: "operator",
      approvalReason: "Preview copy and supported claims are ready.",
      publication,
    });
    expect(response.body.previewWebsite).toMatchObject({
      status: "published",
      publication: {
        previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
        previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
        deploymentId: "preview-deployment-1",
        buildId: "npm-run-build-previews",
        noindex: true,
        approvedBy: "operator",
        approvalReason: "Preview copy and supported claims are ready.",
      },
    });
    expect(response.body.previewWebsite.publication.previewUrl).toMatch(
      /^https:\/\/previews\.example\.com\/published-previews\/[a-f0-9]{24}\/$/,
    );
  });

  it("lets the operator unpublish a Published Preview so its Preview URL is no longer active", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const publication = {
      previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
      previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
      deploymentId: "preview-deployment-1",
      buildId: "npm-run-build-previews",
      noindex: true,
      publishedAt: new Date("2026-06-22T20:00:00.000Z"),
      approvedBy: "operator",
      approvalReason: "Preview copy and supported claims are ready.",
    };
    const previewWebsite = {
      ...previewWebsiteReadyForReview(),
      status: "published" as const,
      publication,
    };
    const unpublishedPreviewWebsite = {
      ...previewWebsite,
      status: "ready_for_review" as const,
      publication: {
        ...publication,
        unpublishedAt: new Date("2026-06-22T20:30:00.000Z"),
        unpublishedBy: "operator",
      },
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusinessWithPreview(previewWebsite)),
      unpublishPreviewWebsite: vi.fn(async () => unpublishedPreviewWebsite),
    };
    const previewHost = {
      publish: vi.fn(),
      unpublish: vi.fn(async () => undefined),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry, previewHost });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .delete("/api/prospect-businesses/prospect-1/preview-website/publication")
      .expect(200);

    expect(previewHost.unpublish).toHaveBeenCalledWith({ previewUrlPath: publication.previewUrlPath });
    expect(prospectRegistry.unpublishPreviewWebsite).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      actor: "operator",
    });
    expect(response.body.previewWebsite).toMatchObject({
      status: "ready_for_review",
      publication: {
        previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
        unpublishedBy: "operator",
      },
    });
  });

  it("lets the operator draft and edit Outreach before approval", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const draftOutreach = {
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Detail Cafe",
      bodyText:
        "Hi Detail Cafe team,\n\nI put together a modern upgrade concept: https://previews.example.com/published-previews/abc123/\n\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Detail Cafe team,</p><p>I put together a modern upgrade concept: https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [
        {
          claim: "The current website could make contact details easier to find.",
          source: "website_assessment.safe_claims",
        },
      ],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
    };
    const savedDraftOutreach = {
      id: "draft-1",
      ...draftOutreach,
      createdAt: new Date("2026-06-22T20:00:00.000Z"),
      updatedAt: new Date("2026-06-22T20:00:00.000Z"),
    };
    const editedDraftOutreach = {
      ...savedDraftOutreach,
      subject: "A website idea for Detail Cafe",
      bodyText: `${savedDraftOutreach.bodyText}\n\nOperator-added note.`,
      updatedAt: new Date("2026-06-22T20:05:00.000Z"),
    };
    const prospectBusiness = {
      ...prospectBusinessWithPreview({
        ...previewWebsiteReadyForReview(),
        status: "published" as const,
        publication: {
          previewUrl: "https://previews.example.com/published-previews/abc123/",
          previewUrlPath: "/published-previews/abc123/",
          deploymentId: "abc123",
          buildId: "npm-run-build-previews",
          noindex: true,
          publishedAt: new Date("2026-06-22T19:00:00.000Z"),
          approvedBy: "operator",
          approvalReason: "Approved for publication.",
        },
      }),
      prospectStatus: "drafting_outreach" as const,
      contactEvidence: [
        {
          id: "contact-1",
          prospectBusinessId: "prospect-1",
          emailAddress: "hello@detail.example",
          sourceUrl: "https://detail.example/contact",
          sourceType: "business_website" as const,
          confidence: 0.95,
          roleClassification: "role" as const,
          outreachApprovalStatus: "approved" as const,
          reason: "Published on the official contact page.",
          foundAt: new Date("2026-06-22T18:30:00.000Z"),
          approvedAt: new Date("2026-06-22T18:35:00.000Z"),
          approvedBy: "operator",
          approvalReason: "Operator verified this is the correct inbox.",
        },
      ],
      websiteAssessment: {
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
        evidence: [],
        recommendedPitchAngle: "modern_upgrade" as const,
        safeClaims: ["The current website could make contact details easier to find."],
        reviewNotes: [],
        previewEligibility: {
          eligibleByDefault: true,
          effectiveEligible: true,
          requiresOperatorReview: false,
          overriddenByOperator: false,
          reason: "This Opportunity Category is preview-eligible by default.",
        },
        assessedAt: new Date("2026-06-22T16:50:00.000Z"),
      },
      draftOutreach: savedDraftOutreach,
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveDraftOutreach: vi.fn(async () => savedDraftOutreach),
      updateDraftOutreachOperatorEdits: vi.fn(async () => editedDraftOutreach),
    };
    const outreachDrafterAgent: OutreachDrafterAgent = {
      draft: vi.fn(async () => draftOutreach),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      outreachDrafterAgent,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const draftResponse = await operator
      .post("/api/prospect-businesses/prospect-1/draft-outreach")
      .send({
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
      })
      .expect(201);

    expect(outreachDrafterAgent.draft).toHaveBeenCalledWith({
      prospectBusiness,
      senderIdentity: "Logan Sinclair",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
    });
    expect(prospectRegistry.saveDraftOutreach).toHaveBeenCalledWith(expect.objectContaining({
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Detail Cafe",
      requiresOperatorReview: true,
    }));
    expect(draftResponse.body.draftOutreach).toMatchObject({
      id: "draft-1",
      subject: "Website preview for Detail Cafe",
      complianceNotes: ["Operator review is required before sending."],
    });

    const editResponse = await operator
      .patch("/api/prospect-businesses/prospect-1/draft-outreach/operator-edits")
      .send({
        subject: "A website idea for Detail Cafe",
        bodyText: editedDraftOutreach.bodyText,
      })
      .expect(200);

    expect(prospectRegistry.updateDraftOutreachOperatorEdits).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      actor: "operator",
      edits: {
        subject: "A website idea for Detail Cafe",
        bodyText: editedDraftOutreach.bodyText,
      },
    });
    expect(editResponse.body.draftOutreach).toMatchObject({
      subject: "A website idea for Detail Cafe",
      bodyText: expect.stringContaining("Operator-added note."),
    });

    const dashboard = await operator.get("/dashboard").expect(200);
    expect(dashboard.text).toContain("Draft Outreach");
    expect(dashboard.text).toContain("Save Outreach Edits");
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

function previewWebsiteReadyForReview() {
  return {
    id: "preview-1",
    prospectBusinessId: "prospect-1",
    slug: "detail-cafe-prospect-1",
    status: "ready_for_review" as const,
    designPlan: {
      siteType: "multi_section" as const,
      primaryGoal: "menu_view" as const,
      targetCustomer: "People in Beacon looking for coffee before visiting.",
      pitchAngle: "modern_upgrade" as const,
      sections: [
        {
          id: "hero",
          title: "House-roasted coffee in Beacon",
          purpose: "Lead with the supported cafe specialty and location.",
          requiredEvidence: ["Detail Cafe serves house-roasted coffee."],
          contentGuidance: "Use the supported claim as the hero message.",
        },
      ],
      navigation: {
        style: "prominent_cta" as const,
        items: ["Home", "Menu", "Visit"],
      },
      features: [],
      avoid: ["Do not invent prices, hours, reviews, or awards."],
      operatorReviewNotes: ["Confirm the menu link still works before publication."],
    },
    contentJson: {
      hero: {
        headline: "House-roasted coffee in Beacon",
        body: "Detail Cafe serves house-roasted coffee.",
      },
    },
    sourceReferences: [
      {
        sourceId: "source-1",
        factId: "fact-1",
        statement: "Detail Cafe serves house-roasted coffee.",
      },
    ],
    buildMetadata: {
      builder: "svelte" as const,
      command: "npm run build:previews",
      status: "built" as const,
    },
    artifact: {
      sourceRoot: "detail-cafe-prospect-1/source",
      staticRoot: "detail-cafe-prospect-1/dist",
      entryFile: "src/App.svelte",
      indexFile: "dist/index.html",
    },
    operatorEditableFields: [
      {
        path: "contentJson.hero.headline",
        label: "Hero headline",
        value: "House-roasted coffee in Beacon",
      },
    ],
    createdAt: new Date("2026-06-22T19:00:00.000Z"),
    updatedAt: new Date("2026-06-22T19:00:00.000Z"),
  };
}

function prospectBusinessWithPreview(previewWebsite: PreviewWebsite) {
  return {
    id: "prospect-1",
    googlePlaceId: "places/detail-cafe",
    name: "Detail Cafe",
    categories: ["cafe"],
    prospectStatus: "preview_ready_for_review" as const,
    sourceData: { placeId: "places/detail-cafe" },
    firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
    firstDiscoveredRun: discoveryRunStub("run-1"),
    latestDiscoveredRun: discoveryRunStub("run-1"),
    appearanceHistory: [],
    previewWebsite,
  };
}
