# Local Business Website Agent

Single-operator TypeScript/Postgres app for an agentic workflow that discovers local prospect businesses, generates reviewable Svelte preview websites, and prepares compliant outreach.

Start with:

- [Context glossary](./CONTEXT.md)
- [PRD](./docs/prd/0001-local-business-website-agent.md)
- [Architecture decisions](./docs/adr/)
- [Agent prompt skeletons](./docs/prompts/)

## Bootstrap Review Dashboard

The first runnable slice provides:

- simple `.env`-configured Operator Authentication
- a protected Review Dashboard at `/dashboard`
- a Settings / Config Readout that shows effective non-secret runtime configuration
- a Postgres health check through `/healthz`
- an Audit Trail table with a baseline event write path
- Google Places Discovery Runs in `place_search` or `radius_search` mode
- persisted Discovery Run metadata, Search Location, Discovery Limit, Prospect Businesses, Discovery Appearances, and operator-visible Workflow Failures

### Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

For local development outside Docker, make sure `DATABASE_URL` points at a running Postgres instance.

Run the Prospect Registry migration before starting discovery:

```bash
npm run db:migrate
```

### Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Then open `http://localhost:3000/login` and sign in with the configured `OPERATOR_USERNAME` and `OPERATOR_PASSWORD`.

### Checks

```bash
npm run typecheck
npm run test
```
