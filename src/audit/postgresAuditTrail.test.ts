import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { PostgresAuditTrailGateway } from "./postgresAuditTrail.js";

describe("Postgres audit trail", () => {
  it("adds metadata storage when initializing an existing audit_events table", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const auditTrail = new PostgresAuditTrailGateway(pool);

    await pool.query(`
      CREATE TABLE audit_events (
        id BIGSERIAL PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL
      )
    `);

    await auditTrail.initialize();
    await auditTrail.record({
      actor: "operator",
      eventType: "audit.baseline_recorded",
      summary: "Baseline audit trail event recorded from Review Dashboard.",
    });

    await expect(auditTrail.listRecent()).resolves.toMatchObject([
      {
        actor: "operator",
        eventType: "audit.baseline_recorded",
        metadata: {},
      },
    ]);

    await pool.end();
  });

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
        summary: "Baseline audit trail event recorded from Review Dashboard.",
        metadata: { source: "test" },
      }
    ]);

    await pool.end();
  });
});
