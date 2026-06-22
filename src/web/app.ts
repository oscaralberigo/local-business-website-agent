import express, { type Request, type Response } from "express";

import type { AuditTrailGateway } from "../audit/auditTrail.js";
import { buildOperatorSessionCookie, readOperatorSession, verifyOperatorCredentials } from "../auth/operatorSession.js";
import { buildConfigReadout, type RuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { renderDashboardPage, renderLoginPage } from "./rendering.js";

export type ReviewDashboardDependencies = {
  auditTrail: AuditTrailGateway;
  configuration: RuntimeConfiguration;
};

export function createReviewDashboardApp({ auditTrail, configuration }: ReviewDashboardDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (request, response) => {
    response.redirect(isAuthenticated(request, configuration) ? "/dashboard" : "/login");
  });

  app.get("/healthz", async (_request, response) => {
    const database = await auditTrail.verifyConnection();
    response.status(database.connected ? 200 : 503).json({ ok: database.connected, database });
  });

  app.get("/login", (request, response) => {
    if (isAuthenticated(request, configuration)) {
      response.redirect("/dashboard");
      return;
    }

    response.status(200).send(renderLoginPage());
  });

  app.post("/login", async (request, response) => {
    const username = stringFromBody(request.body.username);
    const password = stringFromBody(request.body.password);

    if (!verifyOperatorCredentials(configuration, username, password)) {
      response.status(401).send(renderLoginPage("Invalid operator credentials."));
      return;
    }

    await auditTrail.record({
      actor: configuration.operatorUsername,
      eventType: "operator.authenticated",
      summary: "Operator authenticated to the Review Dashboard."
    });

    response.setHeader("Set-Cookie", buildOperatorSessionCookie(configuration));
    response.redirect("/dashboard");
  });

  app.get("/dashboard", requireOperator(configuration), async (_request, response) => {
    const [database, auditEvents] = await Promise.all([auditTrail.verifyConnection(), auditTrail.listRecent(20)]);
    response
      .status(200)
      .send(renderDashboardPage({ auditEvents, configReadout: buildConfigReadout(configuration), database }));
  });

  app.post("/audit-trail/baseline", requireOperator(configuration), async (_request, response) => {
    await auditTrail.record({
      actor: configuration.operatorUsername,
      eventType: "audit.baseline_recorded",
      summary: "Baseline audit trail event recorded from Review Dashboard."
    });

    response.redirect("/dashboard");
  });

  return app;
}

function requireOperator(configuration: RuntimeConfiguration) {
  return (request: Request, response: Response, next: () => void) => {
    if (!isAuthenticated(request, configuration)) {
      response.redirect("/login");
      return;
    }

    next();
  };
}

function isAuthenticated(request: Request, configuration: RuntimeConfiguration): boolean {
  return readOperatorSession(request.headers.cookie, configuration) !== null;
}

function stringFromBody(value: unknown): string {
  return typeof value === "string" ? value : "";
}
