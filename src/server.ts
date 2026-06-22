import "dotenv/config";

import { ZodError } from "zod";

import { PostgresAuditTrailGateway } from "./audit/postgresAuditTrail.js";
import { loadRuntimeConfiguration } from "./config/runtimeConfiguration.js";
import { createPostgresPool } from "./database/postgresPool.js";
import { createReviewDashboardApp } from "./web/app.js";

async function main(): Promise<void> {
  const configuration = loadRuntimeConfiguration(process.env);
  const pool = createPostgresPool(configuration);
  const auditTrail = new PostgresAuditTrailGateway(pool);

  await auditTrail.initialize();

  const app = createReviewDashboardApp({ auditTrail, configuration });
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
