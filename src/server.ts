import pg from "pg";
import { createDashboardServer } from "./dashboard/http-server.js";
import { GooglePlacesDiscoverySource } from "./google-places/google-places-discovery-source.js";
import { InMemoryProspectRegistry } from "./persistence/in-memory-prospect-registry.js";
import { PostgresProspectRegistry } from "./persistence/postgres-prospect-registry.js";

const port = Number(process.env.PORT ?? 3000);
const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY;

if (!googlePlacesApiKey) {
  throw new Error("GOOGLE_PLACES_API_KEY is required to start Discovery Runs");
}

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

const server = createDashboardServer({
  registry: pool ? new PostgresProspectRegistry(pool) : new InMemoryProspectRegistry(),
  discoverySource: new GooglePlacesDiscoverySource({ apiKey: googlePlacesApiKey }),
});

server.listen(port, () => {
  process.stdout.write(`Review Dashboard listening on http://localhost:${port}\n`);
});

process.on("SIGTERM", async () => {
  server.close();
  await pool?.end();
});
