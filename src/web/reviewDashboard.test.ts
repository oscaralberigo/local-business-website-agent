import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { BusinessContextResearcher } from "../business-context/types.js";
import type { ContactFinderAgent } from "../contact-finder/types.js";
import { loadRuntimeConfiguration } from "../config/runtimeConfiguration.js";
import type { EmailSendingProvider, OutreachDrafterAgent } from "../outreach/types.js";
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
      metadata: Record<string, unknown>;
    }> = [];

    const auditTrail = {
      verifyConnection: vi.fn(async () => ({ connected: true })),
      record: vi.fn(async (event: { actor: string; eventType: string; summary: string }) => {
        events.unshift({
          id: events.length + 1,
          occurredAt: new Date("2026-06-22T14:30:00.000Z"),
          ...event,
          metadata: {},
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

  it("exposes exactly the two operator-facing Review Policy toggles and lets the operator update them", async () => {
    const configuration = loadRuntimeConfiguration({
      ...baseConfiguration,
      REVIEW_REQUIRE_PREVIEW_PUBLICATION: "false",
      REVIEW_REQUIRE_OUTREACH_SENDING: "true",
    });
    const auditTrail = createAuditTrailStub();
    const app = createReviewDashboardApp({ auditTrail, configuration });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const dashboard = await operator.get("/dashboard").expect(200);

    expect(dashboard.text.match(/type="checkbox"/g)).toHaveLength(2);
    expect(dashboard.text).toContain('name="require-review-before-preview-publication"');
    expect(dashboard.text).toContain('name="require-review-before-outreach-sending"');
    expect(dashboard.text).toMatch(/name="require-review-before-outreach-sending"[^>]*checked/);
    expect(dashboard.text).not.toMatch(/name="require-review-before-preview-publication"[^>]*checked/);

    const response = await operator
      .patch("/api/review-policy")
      .send({
        requireReviewBeforePreviewPublication: true,
        requireReviewBeforeOutreachSending: false,
      })
      .expect(200);

    expect(response.body.reviewPolicy).toEqual({
      requireReviewBeforePreviewPublication: true,
      requireReviewBeforeOutreachSending: false,
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "review_policy.updated",
      metadata: {
        requireReviewBeforePreviewPublication: true,
        requireReviewBeforeOutreachSending: false,
      },
    }));
  });

  it("lets the operator retry a retryable Workflow Failure from the failed step", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const workflowState = {
      id: "workflow-state-1",
      workflowKey: "discovery-run:run-1",
      discoveryRunId: "run-1",
      currentStep: "google_places_discovery",
      status: "retrying" as const,
      attemptCount: 1,
      maxAttempts: 3,
      lastFailureId: "failure-1",
      stateData: {
        retryRequestedBy: "operator",
      },
      promptVersions: {},
      agentOutputSummaries: [],
      sourceReferences: [],
      resumedAt: new Date("2026-06-22T22:30:00.000Z"),
      createdAt: new Date("2026-06-22T22:00:00.000Z"),
      updatedAt: new Date("2026-06-22T22:30:00.000Z"),
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      getProspectBusinessDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      retryWorkflowFailure: vi.fn(async () => workflowState),
    };
    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/workflow-failures/failure-1/retry")
      .expect(200);

    expect(prospectRegistry.retryWorkflowFailure).toHaveBeenCalledWith({
      workflowFailureId: "failure-1",
      actor: "operator",
    });
    expect(response.body.workflowState).toMatchObject({
      workflowKey: "discovery-run:run-1",
      currentStep: "google_places_discovery",
      status: "retrying",
      attemptCount: 1,
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "workflow.retry_requested",
      summary: "Operator requested retry for Workflow Failure failure-1.",
      metadata: {
        workflowFailureId: "failure-1",
        workflowKey: "discovery-run:run-1",
        currentStep: "google_places_discovery",
        attemptCount: 1,
      },
    }));
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

  it("lets the operator manually record Reply Tracking without inbox automation", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const replyTracking = {
      prospectBusinessId: "prospect-1",
      repliedAt: new Date("2026-06-22T22:15:00.000Z"),
      summary: "The owner replied and asked for pricing.",
      notes: "Follow up manually with a small-cafe package estimate.",
      recordedBy: "operator",
      recordedAt: new Date("2026-06-22T22:16:00.000Z"),
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(),
      recordManualReply: vi.fn(async () => ({
        id: "prospect-1",
        googlePlaceId: "places/detail-cafe",
        name: "Detail Cafe",
        categories: ["cafe"],
        prospectStatus: "replied" as const,
        sourceData: { placeId: "places/detail-cafe" },
        firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
        lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
        firstDiscoveredRun: discoveryRunStub("run-1"),
        latestDiscoveredRun: discoveryRunStub("run-1"),
        appearanceHistory: [],
        replyTracking,
      })),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/reply-tracking")
      .send({
        repliedAt: "2026-06-22T22:15:00.000Z",
        summary: "The owner replied and asked for pricing.",
        notes: "Follow up manually with a small-cafe package estimate.",
      })
      .expect(200);

    expect(prospectRegistry.recordManualReply).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      repliedAt: new Date("2026-06-22T22:15:00.000Z"),
      summary: "The owner replied and asked for pricing.",
      notes: "Follow up manually with a small-cafe package estimate.",
      actor: "operator",
    });
    expect(response.body.prospectBusiness).toMatchObject({
      id: "prospect-1",
      prospectStatus: "replied",
      replyTracking: {
        summary: "The owner replied and asked for pricing.",
        notes: "Follow up manually with a small-cafe package estimate.",
        recordedBy: "operator",
      },
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "reply_tracking.recorded",
      summary: "Operator recorded Reply Tracking for Prospect Business prospect-1.",
      metadata: {
        prospectBusinessId: "prospect-1",
        prospectStatus: "replied",
      },
    }));
  });

  it("lets the operator manually record Work Conversion and move status to work_won", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const workConversion = {
      prospectBusinessId: "prospect-1",
      conversionStatus: "work_won" as const,
      estimatedValueCents: 250000,
      notes: "Owner approved a starter website package.",
      recordedBy: "operator",
      recordedAt: new Date("2026-06-22T22:45:00.000Z"),
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(),
      recordManualWorkConversion: vi.fn(async () => ({
        id: "prospect-1",
        googlePlaceId: "places/detail-cafe",
        name: "Detail Cafe",
        categories: ["cafe"],
        prospectStatus: "work_won" as const,
        sourceData: { placeId: "places/detail-cafe" },
        firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
        lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
        firstDiscoveredRun: discoveryRunStub("run-1"),
        latestDiscoveredRun: discoveryRunStub("run-1"),
        appearanceHistory: [],
        workConversion,
      })),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const response = await operator
      .post("/api/prospect-businesses/prospect-1/work-conversion")
      .send({
        conversionStatus: "work_won",
        estimatedValueCents: 250000,
        notes: "Owner approved a starter website package.",
      })
      .expect(200);

    expect(prospectRegistry.recordManualWorkConversion).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      conversionStatus: "work_won",
      estimatedValueCents: 250000,
      notes: "Owner approved a starter website package.",
      actor: "operator",
    });
    expect(response.body.prospectBusiness).toMatchObject({
      prospectStatus: "work_won",
      workConversion: {
        conversionStatus: "work_won",
        estimatedValueCents: 250000,
        notes: "Owner approved a starter website package.",
        recordedBy: "operator",
      },
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "work_conversion.recorded",
      summary: "Operator recorded Work Conversion for Prospect Business prospect-1.",
      metadata: {
        prospectBusinessId: "prospect-1",
        prospectStatus: "work_won",
        conversionStatus: "work_won",
      },
    }));
  });

  it("renders Prospect Detail controls for manual Reply Tracking and Work Conversion", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const app = createReviewDashboardApp({ auditTrail, configuration });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const dashboard = await operator.get("/dashboard").expect(200);

    expect(dashboard.text).toContain("Reply Tracking");
    expect(dashboard.text).toContain("data-reply-tracking-form");
    expect(dashboard.text).toContain("Reply timestamp");
    expect(dashboard.text).toContain("Reply summary");
    expect(dashboard.text).toContain("Work Conversion");
    expect(dashboard.text).toContain("data-work-conversion-form");
    expect(dashboard.text).toContain("Conversion status");
    expect(dashboard.text).toContain("Estimated value (cents)");
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

  it("auto-publishes a compliant Preview Website when Review Policy skips preview Human Review", async () => {
    const configuration = loadRuntimeConfiguration({
      ...baseConfiguration,
      REVIEW_REQUIRE_PREVIEW_PUBLICATION: "false",
    });
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
    const hostPublication = {
      previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
      previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
      deploymentId: "preview-deployment-1",
      buildId: "npm-run-build-previews",
      noindex: true,
      publishedAt: new Date("2026-06-22T20:00:00.000Z"),
      approvedBy: "",
      approvalReason: "",
    };
    const policyApprovalReason = "Review Policy skipped preview Human Review.";
    const publishedPreviewWebsite = {
      ...previewWebsite,
      status: "published" as const,
      publication: {
        ...hostPublication,
        approvedBy: "operator",
        approvalReason: policyApprovalReason,
      },
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
      publish: vi.fn(async () => hostPublication),
      unpublish: vi.fn(),
    };

    const app = createReviewDashboardApp({ auditTrail, configuration, prospectRegistry, previewHost });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    await operator
      .post("/api/prospect-businesses/prospect-1/preview-website/publication")
      .send({})
      .expect(200);

    expect(previewHost.publish).toHaveBeenCalledWith({
      previewWebsite,
      previewBaseUrl: "https://previews.example.com",
    });
    expect(prospectRegistry.publishPreviewWebsite).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      actor: "operator",
      approvalReason: policyApprovalReason,
      publication: {
        ...hostPublication,
        approvedBy: "operator",
        approvalReason: policyApprovalReason,
      },
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "preview.published",
      summary: expect.stringContaining("Human Review skipped by Review Policy"),
      metadata: expect.objectContaining({
        humanApprovalRequired: false,
        humanApprovalSkippedByReviewPolicy: true,
      }),
    }));
  });

  it("blocks auto-publishing when Review Policy skips preview Human Review but the Compliance Gate fails", async () => {
    const configuration = loadRuntimeConfiguration({
      ...baseConfiguration,
      REVIEW_REQUIRE_PREVIEW_PUBLICATION: "false",
    });
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
        supportedClaims: [],
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
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      publishPreviewWebsite: vi.fn(),
    };
    const previewHost = {
      publish: vi.fn(),
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
      .send({})
      .expect(409);

    expect(response.body.error).toContain("Preview Website source references must all map to Supported Claims.");
    expect(previewHost.publish).not.toHaveBeenCalled();
    expect(prospectRegistry.publishPreviewWebsite).not.toHaveBeenCalled();
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "preview.publication_blocked",
      summary: expect.stringContaining("Compliance Gate blocked Preview Website publication"),
      metadata: expect.objectContaining({
        humanApprovalRequired: false,
        humanApprovalSkippedByReviewPolicy: true,
        reasons: ["Preview Website source references must all map to Supported Claims."],
      }),
    }));
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

  it("lets the operator send approved Outreach and shows dashboard send feedback", async () => {
    const configuration = loadRuntimeConfiguration(baseConfiguration);
    const auditTrail = createAuditTrailStub();
    const sentAt = new Date("2026-06-22T21:00:00.000Z");
    const draftOutreach = {
      id: "draft-1",
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Detail Cafe",
      bodyText:
        "Hi Detail Cafe team,\nhttps://previews.example.com/published-previews/abc123/\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Detail Cafe team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [
        {
          claim: "The current website could make contact details easier to find.",
          source: "website_assessment.safe_claims",
        },
      ],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
      createdAt: new Date("2026-06-22T20:00:00.000Z"),
      updatedAt: new Date("2026-06-22T20:00:00.000Z"),
    };
    const outreachEmail = {
      id: "outreach-email-1",
      prospectBusinessId: "prospect-1",
      draftOutreachId: "draft-1",
      recipientEmailAddress: "hello@detail.example",
      provider: "safe_test",
      providerMessageId: "safe-test-123",
      sendStatus: "sent" as const,
      suppressionStatus: "clear" as const,
      sentAt,
      createdAt: sentAt,
      updatedAt: sentAt,
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
      prospectStatus: "outreach_ready_for_review" as const,
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
      draftOutreach,
      outreachEmails: [outreachEmail],
      workflowFailures: [],
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => [{
        ...discoveryRunStub("run-1"),
        appearances: [],
        discoveredProspects: [prospectBusiness],
        workflowFailures: [],
      }]),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveOutreachEmail: vi.fn(async () => outreachEmail),
      getOutreachSuppressionStatus: vi.fn(async () => ({ status: "clear" as const })),
      recordOutreachWorkflowFailure: vi.fn(async () => undefined),
    };
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "safe_test",
        providerMessageId: "safe-test-123",
        sentAt,
      })),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      emailProvider,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    const sendResponse = await operator
      .post("/api/prospect-businesses/prospect-1/outreach-email/send")
      .send({
        fromEmail: "Logan Sinclair <logan@example.com>",
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
        approvalReason: "Operator approved this Draft Outreach for sending.",
      })
      .expect(200);

    expect(emailProvider.send).toHaveBeenCalledWith({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@detail.example",
      subject: "Website preview for Detail Cafe",
      text: draftOutreach.bodyText,
      html: draftOutreach.bodyHtml,
    });
    expect(prospectRegistry.saveOutreachEmail).toHaveBeenCalledWith(expect.objectContaining({
      prospectBusinessId: "prospect-1",
      draftOutreachId: "draft-1",
      provider: "safe_test",
      providerMessageId: "safe-test-123",
      sendStatus: "sent",
      suppressionStatus: "clear",
    }));
    expect(sendResponse.body.outreachEmail).toMatchObject({
      id: "outreach-email-1",
      providerMessageId: "safe-test-123",
      sendStatus: "sent",
    });

    const dashboard = await operator.get("/dashboard").expect(200);
    expect(dashboard.text).toContain("Send Outreach");
    const detail = await operator.get("/api/prospect-businesses/prospect-1").expect(200);
    expect(detail.body.prospectBusiness.outreachEmails).toEqual([
      expect.objectContaining({
        providerMessageId: "safe-test-123",
        sendStatus: "sent",
      }),
    ]);
  });

  it("auto-sends compliant Outreach when Review Policy skips outreach Human Review", async () => {
    const configuration = loadRuntimeConfiguration({
      ...baseConfiguration,
      REVIEW_REQUIRE_OUTREACH_SENDING: "false",
    });
    const auditTrail = createAuditTrailStub();
    const sentAt = new Date("2026-06-22T21:00:00.000Z");
    const prospectBusiness = prospectBusinessReadyForOutreachReview();
    const outreachEmail = {
      id: "outreach-email-1",
      prospectBusinessId: "prospect-1",
      draftOutreachId: "draft-1",
      recipientEmailAddress: "hello@detail.example",
      provider: "safe_test",
      providerMessageId: "safe-test-123",
      sendStatus: "sent" as const,
      suppressionStatus: "clear" as const,
      sentAt,
      createdAt: sentAt,
      updatedAt: sentAt,
    };
    const prospectRegistry = {
      createDiscoveryRun: vi.fn(),
      recordDiscoveredProspect: vi.fn(),
      completeDiscoveryRun: vi.fn(),
      failDiscoveryRun: vi.fn(),
      getDiscoveryRunDetail: vi.fn(),
      listDiscoveryRuns: vi.fn(async () => []),
      getProspectBusinessDetail: vi.fn(async () => prospectBusiness),
      saveOutreachEmail: vi.fn(async () => outreachEmail),
      getOutreachSuppressionStatus: vi.fn(async () => ({ status: "clear" as const })),
      recordOutreachWorkflowFailure: vi.fn(async () => undefined),
    };
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "safe_test",
        providerMessageId: "safe-test-123",
        sentAt,
      })),
    };

    const app = createReviewDashboardApp({
      auditTrail,
      configuration,
      prospectRegistry,
      emailProvider,
    });
    const operator = request.agent(app);

    await operator
      .post("/login")
      .type("form")
      .send({ username: "operator", password: baseConfiguration.OPERATOR_PASSWORD })
      .expect(302);

    await operator
      .post("/api/prospect-businesses/prospect-1/outreach-email/send")
      .send({
        fromEmail: "Logan Sinclair <logan@example.com>",
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
      })
      .expect(200);

    expect(emailProvider.send).toHaveBeenCalledWith({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@detail.example",
      subject: "Website preview for Detail Cafe",
      text: prospectBusiness.draftOutreach?.bodyText,
      html: prospectBusiness.draftOutreach?.bodyHtml,
    });
    expect(auditTrail.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "outreach.sent",
      summary: expect.stringContaining("Human Review skipped by Review Policy"),
      metadata: expect.objectContaining({
        humanApprovalRequired: false,
        humanApprovalSkippedByReviewPolicy: true,
      }),
    }));
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

function prospectBusinessReadyForOutreachReview() {
  return {
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
    prospectStatus: "outreach_ready_for_review" as const,
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
    draftOutreach: {
      id: "draft-1",
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Detail Cafe",
      bodyText:
        "Hi Detail Cafe team,\nhttps://previews.example.com/published-previews/abc123/\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Detail Cafe team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [
        {
          claim: "The current website could make contact details easier to find.",
          source: "website_assessment.safe_claims",
        },
      ],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
      createdAt: new Date("2026-06-22T20:00:00.000Z"),
      updatedAt: new Date("2026-06-22T20:00:00.000Z"),
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
    workflowFailures: [],
  };
}
