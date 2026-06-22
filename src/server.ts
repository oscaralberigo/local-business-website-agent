import "dotenv/config";

import { ZodError } from "zod";

import { PostgresAuditTrailGateway } from "./audit/postgresAuditTrail.js";
import { createBusinessContextResearcher } from "./business-context/business-context-researcher.js";
import { createGooglePlacesBusinessContextTool } from "./business-context/google-places-business-context-tool.js";
import { loadRuntimeConfiguration } from "./config/runtimeConfiguration.js";
import { createPostgresPool } from "./database/postgresPool.js";
import { GooglePlacesDiscoverySource } from "./google-places/google-places-discovery-source.js";
import { createTemplateOutreachDrafterAgent } from "./outreach/outreach-drafter-agent.js";
import { PostgresProspectRegistry } from "./persistence/postgres-prospect-registry.js";
import { FileSystemPreviewArtifactStore } from "./preview-generation/file-system-preview-artifact-store.js";
import { createWebsiteBuilderAgent } from "./preview-generation/website-builder-agent.js";
import { createWebsiteDesignerAgent } from "./preview-generation/website-designer-agent.js";
import { FileSystemPreviewHost } from "./preview-publication/file-system-preview-host.js";
import { createReviewDashboardApp } from "./web/app.js";
import { createWebsiteReviewerAgent } from "./website-assessment/website-reviewer-agent.js";

async function main(): Promise<void> {
  const configuration = loadRuntimeConfiguration(process.env);
  const pool = createPostgresPool(configuration);
  const auditTrail = new PostgresAuditTrailGateway(pool);
  const prospectRegistry = new PostgresProspectRegistry(pool);
  const discoverySource = configuration.googlePlacesApiKey
    ? new GooglePlacesDiscoverySource({ apiKey: configuration.googlePlacesApiKey })
    : undefined;
  const businessContextResearcher = createBusinessContextResearcher({
    researchTools: [createGooglePlacesBusinessContextTool()],
  });
  const previewArtifactStore = new FileSystemPreviewArtifactStore({
    rootDirectory: configuration.previewArtifactRoot,
  });
  const previewHost = new FileSystemPreviewHost({
    rootDirectory: configuration.previewArtifactRoot,
  });
  const websiteBuilderAgent = createWebsiteBuilderAgent();
  const websiteDesignerAgent = createWebsiteDesignerAgent();
  const websiteReviewerAgent = createWebsiteReviewerAgent();
  const outreachDrafterAgent = createTemplateOutreachDrafterAgent();

  await auditTrail.initialize();

  const app = createReviewDashboardApp({
    auditTrail,
    configuration,
    discoverySource,
    businessContextResearcher,
    prospectRegistry,
    previewArtifactStore,
    previewHost,
    outreachDrafterAgent,
    websiteBuilderAgent,
    websiteDesignerAgent,
    websiteReviewerAgent,
  });
  const server = app.listen(configuration.port, () => {
    console.log(`Review Dashboard listening on port ${configuration.port}`);
  });

  const shutdown = async () => {
    server.close();
    await pool.end();
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    console.error("Runtime configuration is invalid:");
    for (const issue of error.issues) {
      console.error(`- ${issue.path.join(".")}: ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unknown startup failure");
  }

  process.exitCode = 1;
});
