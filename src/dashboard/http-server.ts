import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { runDiscovery } from "../discovery/run-discovery.js";
import { startDiscoveryRunSchema } from "../discovery/start-discovery-run-schema.js";
import type { BusinessDiscoverySource, ProspectRegistry } from "../discovery/types.js";
import { renderDashboardHtml } from "./dashboard-html.js";

export type DashboardServerConfig = {
  registry: ProspectRegistry;
  discoverySource: BusinessDiscoverySource;
};

export function createDashboardServer(config: DashboardServerConfig) {
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, config);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error",
      });
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: DashboardServerConfig,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderDashboardHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/discovery-runs") {
    sendJson(response, 200, { discoveryRuns: await config.registry.listDiscoveryRuns() });
    return;
  }

  const detailMatch = url.pathname.match(/^\/api\/discovery-runs\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    sendJson(response, 200, {
      discoveryRun: await config.registry.getDiscoveryRunDetail(detailMatch[1] ?? ""),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/discovery-runs") {
    try {
      const body = await readJsonBody(request);
      const discoveryRun = await runDiscovery({
        request: startDiscoveryRunSchema.parse(body),
        discoverySource: config.discoverySource,
        registry: config.registry,
      });
      sendJson(response, 201, { discoveryRun });
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(response, 400, { error: error.issues.map((issue) => issue.message).join("; ") });
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
