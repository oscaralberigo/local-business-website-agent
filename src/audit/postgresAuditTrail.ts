import type { Pool } from "pg";

import type { AuditEvent, AuditEventInput, AuditTrailGateway, ConnectivityStatus } from "./auditTrail.js";

type QueryablePool = Pick<Pool, "query">;

type AuditEventRow = {
  id: number;
  occurred_at: Date;
  actor: string;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown> | string;
};

export class PostgresAuditTrailGateway implements AuditTrailGateway {
  constructor(private readonly pool: QueryablePool) {}

  async initialize(): Promise<void> {
    const tableExists = await this.pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'audit_events'
        ) AS exists
      `,
    );
    if (!tableExists.rows[0]?.exists) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS audit_events (
          id BIGSERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actor TEXT NOT NULL,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
    }
    await this.pool.query(`
      ALTER TABLE audit_events
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  async verifyConnection(): Promise<ConnectivityStatus> {
    try {
      await this.pool.query("SELECT 1 AS ok");
      return { connected: true };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : "Unknown database error" };
    }
  }

  async record(event: AuditEventInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO audit_events (actor, event_type, summary, metadata)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [event.actor, event.eventType, event.summary, JSON.stringify(event.metadata ?? {})]
    );
  }

  async listRecent(limit = 20): Promise<AuditEvent[]> {
    const result = await this.pool.query<AuditEventRow>(
      `
        SELECT id, occurred_at, actor, event_type, summary, metadata
        FROM audit_events
        ORDER BY occurred_at DESC, id DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      occurredAt: row.occurred_at,
      actor: row.actor,
      eventType: row.event_type,
      summary: row.summary,
      metadata: parseJsonb(row.metadata)
    }));
  }
}

function parseJsonb(value: Record<string, unknown> | string): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}
