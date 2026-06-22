import express, { type Request, type Response } from "express";
import { ZodError } from "zod";

import type { AuditTrailGateway } from "../audit/auditTrail.js";
import { buildOperatorSessionCookie, readOperatorSession, verifyOperatorCredentials } from "../auth/operatorSession.js";
import { buildConfigReadout, type RuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import { startDiscoveryRunSchema } from "../discovery/start-discovery-run-schema.js";
import type { BusinessDiscoverySource, ProspectRegistry } from "../discovery/types.js";
import { renderDashboardPage, renderLoginPage } from "./rendering.js";

export type ReviewDashboardDependencies = {
  auditTrail: AuditTrailGateway;
  configuration: RuntimeConfiguration;
  discoverySource?: BusinessDiscoverySource;
  prospectRegistry?: ProspectRegistry;
};

export function createReviewDashboardApp({
  auditTrail,
  configuration,
  discoverySource,
  prospectRegistry,
}: ReviewDashboardDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
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

  app.get("/api/discovery-runs", requireOperator(configuration), async (_request, response) => {
    if (!prospectRegistry) {
      response.status(503).json({ error: "Prospect registry is not configured." });
      return;
    }

    response.status(200).json({ discoveryRuns: await prospectRegistry.listDiscoveryRuns() });
  });

  app.get("/api/discovery-runs/:id", requireOperator(configuration), async (request, response) => {
    if (!prospectRegistry) {
      response.status(503).json({ error: "Prospect registry is not configured." });
      return;
    }

    response.status(200).json({
      discoveryRun: await prospectRegistry.getDiscoveryRunDetail(request.params.id),
    });
  });

  app.post("/api/discovery-runs", requireOperator(configuration), async (request, response) => {
    if (!prospectRegistry || !discoverySource) {
      response.status(503).json({ error: "Google Places discovery is not configured." });
      return;
    }

    try {
      const discoveryRun = await runDiscovery({
        request: startDiscoveryRunSchema.parse(request.body),
        discoverySource,
        registry: prospectRegistry,
      });

      response.status(201).json({ discoveryRun });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: error.issues.map((issue) => issue.message).join("; "),
        });
        return;
      }

      throw error;
    }
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
