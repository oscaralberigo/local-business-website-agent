import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { PostgresAuditTrailGateway } from "./postgresAuditTrail.js";

describe("Postgres audit trail", () => {
  it("verifies connectivity, writes an audit event, and reads recent audit events", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const auditTrail = new PostgresAuditTrailGateway(pool);

    await auditTrail.initialize();

    await expect(auditTrail.verifyConnection()).resolves.toEqual({ connected: true });

    await auditTrail.record({
      actor: "operator",
      eventType: "audit.baseline_recorded",
      summary: "Baseline audit trail event recorded from Review Dashboard.",
      metadata: { source: "test" }
    });

    await expect(auditTrail.listRecent()).resolves.toMatchObject([
      {
        actor: "operator",
        eventType: "audit.baseline_recorded",
        summary: "Baseline audit trail event recorded from Review Dashboard."
      }
    ]);

    await pool.end();
  });
});
