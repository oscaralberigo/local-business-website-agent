# Local Business Website Agent

TypeScript application for an agentic workflow that discovers local Prospect Businesses, generates reviewable Svelte preview websites, and prepares compliant outreach.

Start with:

- [Context glossary](./CONTEXT.md)
- [PRD](./docs/prd/0001-local-business-website-agent.md)
- [Architecture decisions](./docs/adr/)
- [Agent prompt skeletons](./docs/prompts/)

## Discovery Runs

The Review Dashboard can start Google Places Discovery Runs in `place_search` or `radius_search` mode. Runs persist query metadata, Search Location, Discovery Limit, Prospect Businesses, Discovery Appearances, and operator-visible Workflow Failures.

```sh
npm install
npm run typecheck
npm run test
```

To use Postgres, set `DATABASE_URL` and run:

```sh
npm run db:migrate
```

To start the dashboard:

```sh
GOOGLE_PLACES_API_KEY=... npm run dev
```

If `DATABASE_URL` is not set, the dashboard uses in-memory persistence for local smoke testing.
