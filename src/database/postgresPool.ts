import pg from "pg";

import type { RuntimeConfiguration } from "../config/runtimeConfiguration.js";

export function createPostgresPool(configuration: RuntimeConfiguration): pg.Pool {
  return new pg.Pool({
    connectionString: configuration.databaseUrl,
    ssl: configuration.databaseSsl ? { rejectUnauthorized: false } : undefined
  });
}
