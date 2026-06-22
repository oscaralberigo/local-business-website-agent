export type AuditEventInput = {
  actor: string;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AuditEvent = {
  id: number;
  occurredAt: Date;
  actor: string;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
};

export type ConnectivityStatus = {
  connected: boolean;
  error?: string;
};

export type AuditTrailGateway = {
  verifyConnection(): Promise<ConnectivityStatus>;
  record(event: AuditEventInput): Promise<void>;
  listRecent(limit?: number): Promise<AuditEvent[]>;
};
