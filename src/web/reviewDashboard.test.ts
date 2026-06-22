import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { loadRuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { createReviewDashboardApp } from "./app.js";

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
});

function createAuditTrailStub() {
  return {
    verifyConnection: vi.fn(async () => ({ connected: true })),
    record: vi.fn(async () => undefined),
    listRecent: vi.fn(async () => [])
  };
}
