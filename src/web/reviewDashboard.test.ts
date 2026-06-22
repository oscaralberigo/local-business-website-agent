import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { loadRuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { createReviewDashboardApp } from "./app.js";

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
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:3000",
      PREVIEW_BASE_URL: "https://previews.example.com",
      OPERATOR_USERNAME: "operator",
      OPERATOR_PASSWORD: secretValues.operatorPassword,
      OPERATOR_SESSION_SECRET: secretValues.sessionSecret,
      DATABASE_URL: secretValues.databaseUrl,
      GOOGLE_PLACES_API_KEY: secretValues.googlePlacesKey,
      OPENAI_API_KEY: secretValues.openAiKey,
      RESEND_API_KEY: secretValues.resendKey,
      REVIEW_REQUIRE_PREVIEW_PUBLICATION: "true",
      REVIEW_REQUIRE_OUTREACH_SENDING: "true",
      DISCOVERY_LIMIT: "25"
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
});
