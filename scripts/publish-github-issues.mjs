import { execFileSync } from "node:child_process";

const repo = "oscaralberigo/local-business-website-agent";
const affectedRepo = "local-business-website-agent";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function ensureLabel(name, color, description) {
  try {
    gh([
      "api",
      `repos/${repo}/labels`,
      "--method",
      "POST",
      "--field",
      `name=${name}`,
      "--field",
      `color=${color}`,
      "--field",
      `description=${description}`,
    ]);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (!output.includes("already_exists") && !output.includes("Validation Failed")) {
      throw error;
    }
  }
}

function issueNumberFromUrl(url) {
  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse issue number from ${url}`);
  }
  return match[1];
}

function createIssue({ title, body, labels }) {
  const args = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
  for (const label of labels) {
    args.push("--label", label);
  }
  const url = gh(args);
  return { url, number: issueNumberFromUrl(url) };
}

function workItemBody({ parentRef, what, acceptance, blockedBy, checks, review }) {
  return `## Parent

- PRD: ${parentRef}

## What to build

${what}

## Affected repos

Suggested:
- ${affectedRepo}

The orchestrator may revise this selection after validation.

## Acceptance criteria

${acceptance.map((item) => `- [ ] ${item}`).join("\n")}

## Blocked by

${blockedBy}

## Suggested checks

${checks.map((item) => `- ${item}`).join("\n")}

## Review expectations

${review}
`;
}

ensureLabel("Sandcastle", "8A2BE2", "Planning and autonomous-agent implementation work.");
ensureLabel("AFK-ready", "0E8A16", "Ready for autonomous implementation without human interaction.");
ensureLabel("HITL", "D93F0B", "Requires human-in-the-loop review, access, or confirmation.");
ensureLabel("approved-PRD", "1D76DB", "Approved product requirements document.");

const prdBody = `## Problem Statement

The operator needs a compliant agentic system that discovers local Prospect Businesses in a chosen Search Location, identifies Website Opportunities, generates adaptive Svelte Preview Websites, finds suitable contact emails, and prepares respectful outreach asking whether the business is interested in paid website work.

## Solution

Build a single-operator TypeScript monorepo with a Review Dashboard, LangGraph worker, Postgres Prospect Registry, Svelte preview generation pipeline, self-hosted Preview Host, Contact Finder Agent, Outreach Drafter Agent, Compliance Gate, Review Policy, Workflow State, and Audit Trail.

The full PRD is committed in the repository documentation: docs/prd/0001-local-business-website-agent.md

## User Stories

See the committed PRD for the full 80-story list covering discovery, research, website assessment, adaptive preview generation, contact finding, outreach, review policy, workflow state, audit trail, deployment, and verification.

## Implementation Decisions

- Use LangGraph, TypeScript, and Postgres for the durable Agent Workflow.
- Use Google Places API for v1 Business Discovery Source.
- Generate Preview Websites as Svelte-based Preview Artifacts.
- Publish previews to the operator's own configured server/domain.
- Use OpenAI Responses API as the primary LLM Provider behind an adapter.
- Use Resend as the Email Sending Provider if its free tier remains sufficient, behind an adapter.
- Keep Compliance Gate checks non-bypassable even when Review Policy disables Human Review.
- Preserve Analytics-Ready Data but do not build an analytics dashboard in v1.

## Testing Decisions

Use unit tests for domain decisions, repository tests for Postgres persistence and dedupe, agent contract tests with mocked OpenAI responses, integration tests with mocked providers, Playwright dashboard tests, generated Svelte artifact build verification, and no real email sends in tests.

## Out of Scope

CSV import, analytics dashboard, multi-user accounts, automated reply handling, automated follow-ups, contact form submission, email guessing, live payments/bookings/CMS/forms, client-facing editor/login, prospect-owned domain deployment, full CRM pipeline, mobile app, raw Google Maps UI scraping, and bypassing access restrictions.

## Further Notes

Canonical planning docs are in CONTEXT.md, docs/adr, docs/prompts, and docs/prd. Work Item Issues should use the project glossary language and respect the ADRs.`;

const prd = createIssue({
  title: "PRD: Local Business Website Agent",
  body: prdBody,
  labels: ["Sandcastle", "approved-PRD"],
});

const parentRef = `${repo}#${prd.number}`;

const items = [
  {
    key: "bootstrap",
    title: "AFK Work Item: Bootstrap Review Dashboard, auth, config readout, and audit baseline",
    labels: ["Sandcastle", "AFK-ready"],
    deps: [],
    what:
      "Create the first runnable vertical slice of the single-operator app: protected Review Dashboard login, .env-backed runtime configuration readout without secret values, base Postgres connectivity, and an initial Audit Trail event path. The slice should prove the dashboard, database, configuration, and audit layers can work together.",
    acceptance: [
      "Operator can log in with simple single-operator authentication configured from environment variables.",
      "Dashboard shows a Settings/Config Readout with effective non-secret configuration and no secret values.",
      "Postgres connection is verified through the app, and a baseline audit event can be written and displayed.",
      "Docker Compose can start the app services needed for this slice.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Verify that secrets are not exposed in the UI or logs, authentication protects dashboard routes, and the audit baseline is useful without becoming raw debug logging.",
  },
  {
    key: "discovery",
    title: "AFK Work Item: Run Google Places Discovery Runs and persist Prospect Businesses",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["bootstrap"],
    what:
      "Implement Discovery Runs from the Review Dashboard using Google Places API with place_search and radius_search modes. Persist Discovery Run metadata, Search Location, Discovery Limit, discovered Prospect Businesses, Prospect Identity, Prospect Status, and Analytics-Ready Data.",
    acceptance: [
      "Operator can start a Discovery Run from the dashboard with location, mode, category/search term, and Discovery Limit.",
      "Mocked Google Places results create Prospect Business records immediately in Postgres.",
      "Discovery Run detail shows query metadata, status, and discovered results.",
      "Provider errors create operator-visible Workflow Failures rather than silent failures.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Pay attention to Google Places source boundaries, location metadata completeness, Discovery Limit behavior, and whether the UI makes discovery progress understandable.",
  },
  {
    key: "dedupe",
    title: "AFK Work Item: Handle rediscovery, Google Place ID dedupe, and Discovery Appearances",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["discovery"],
    what:
      "Complete rediscovery behavior by deduplicating Prospect Businesses by Google Place ID and recording every repeated result as a Discovery Appearance. Rediscovery should update latest source data and appearance history without automatically rerunning the full prospect workflow.",
    acceptance: [
      "Rediscovering the same Google Place ID does not create duplicate Prospect Business records.",
      "Each rediscovery creates a Discovery Appearance linked to the existing Prospect Business and current Discovery Run.",
      "Prospect detail shows first/latest discovered run information and appearance history.",
      "Rediscovery does not regenerate previews or rerun the full workflow unless previous workflow failed or operator requests it.",
    ],
    checks: ["npm run typecheck", "npm run test"],
    review:
      "Verify dedupe constraints are database-backed, analytics-ready appearance data is preserved, and rediscovery cannot accidentally spam later workflow steps.",
  },
  {
    key: "research",
    title: "AFK Work Item: Gather Business Context with source-backed Supported Claims",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["discovery"],
    what:
      "Implement the Business Context Researcher Agent vertical slice with approved Research Tools, expanded research default, source/fact persistence, Forbidden Research Data exclusion, and Supported Claim derivation for later website and outreach generation.",
    acceptance: [
      "Operator can trigger Business Context research for a Prospect Business.",
      "Research stores Business Context sources and facts with source references.",
      "Supported Claims can be derived and displayed with traceable evidence.",
      "Forbidden Research Data is filtered out and recorded as excluded where useful for auditability.",
      "Only the Business Context Researcher Agent has open web/search Research Tool access in this slice.",
    ],
    checks: ["npm run typecheck", "npm run test"],
    review:
      "Focus on evidence traceability, source-term/robots compliance hooks, and preventing unsupported or sensitive claims from becoming generated content inputs.",
  },
  {
    key: "assessment",
    title: "AFK Work Item: Assess Website Opportunities and Preview Eligibility",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["research"],
    what:
      "Implement Website Assessment using deterministic checks and the Website Reviewer Agent. Classify Website Opportunities, persist evidence-backed assessment output, and derive Preview Eligibility with operator override support.",
    acceptance: [
      "Assessment can evaluate current website URL, HTML/text, deterministic checks, and desktop/mobile screenshot inputs.",
      "Website Reviewer Agent returns structured output with Opportunity Category, confidence, evidence, safe claims, and review notes.",
      "Opportunity Category values match the PRD set and drive Preview Eligibility defaults.",
      "modern_sufficient prospects are stored but not preview-eligible by default; unknown prospects require operator review before generation.",
      "Dashboard shows Website Assessment evidence and Preview Eligibility.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Check that existing websites are treated as possible upgrade opportunities, reviewer judgment is evidence-backed, and the operator can understand why a business is or is not preview-eligible.",
  },
  {
    key: "contact",
    title: "AFK Work Item: Find Contact Evidence and mark Contact Unavailable safely",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["research"],
    what:
      "Implement Contact Finder Agent behavior with strict source order, Contact Evidence persistence, contact suitability classification, manual contact approval, and Contact Unavailable state when no suitable email exists.",
    acceptance: [
      "Contact Finder searches official business pages first, then approved official profile/search-result sources.",
      "Candidate emails store source URL, source type, confidence, role-versus-personal classification, outreach approval status, and reason.",
      "No guessed emails are produced in v1.",
      "No suitable contact marks the Prospect Business Contact Unavailable and blocks outreach by default.",
      "Operator can manually approve or add a verified contact path.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Verify no email guessing, no inappropriate personal contacts, clear source evidence, and correct blocking behavior for Contact Unavailable prospects.",
  },
  {
    key: "preview-generation",
    title: "AFK Work Item: Generate adaptive Svelte Preview Websites for eligible prospects",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["assessment"],
    what:
      "Implement adaptive Preview Website generation using Website Designer Agent and Website Builder Agent. The slice should produce editable design/content data, generated Svelte Preview Artifacts, dashboard preview rendering, and source-backed content controls.",
    acceptance: [
      "Preview-eligible Prospect Businesses can generate a Website Designer Agent plan from Business Context and Website Assessment evidence.",
      "Website Builder Agent produces a Generated Svelte Website from the design plan.",
      "Postgres stores preview metadata, design plan, content JSON, source references, slug, build metadata, and status.",
      "Generated Svelte source and built static assets are stored on disk as Preview Artifacts.",
      "Review Dashboard renders the Preview Website and allows Operator Edits to reviewable content/design fields.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run build:previews", "npm run test:e2e"],
    review:
      "Pay attention to adaptive business-specific structure, no invented claims, Svelte build reliability, mobile rendering quality, and the ability to edit generated content before publication.",
  },
  {
    key: "publish",
    title: "AFK Work Item: Publish and unpublish noindex Preview URLs on the self-hosted Preview Host",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["preview-generation"],
    what:
      "Implement the publishing adapter and dashboard flow for turning an approved Preview Website into a Published Preview on the operator's configured Preview Host with an unguessable noindex Preview URL, plus unpublish support.",
    acceptance: [
      "Operator can approve and publish a Preview Website from the Review Dashboard when the Compliance Gate allows it.",
      "Published Preview receives an unguessable Preview URL under the configured preview domain/base URL.",
      "Published Preview is served with noindex behavior.",
      "Preview publication metadata and deployment/build identifiers are persisted.",
      "Operator can unpublish a Published Preview and the URL no longer serves the active preview.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run build:previews", "npm run test:e2e"],
    review:
      "Check noindex behavior, slug unguessability, self-hosting abstraction, unpublish semantics, and that publishing remains behind Preview Approval unless Review Policy allows otherwise.",
  },
  {
    key: "draft-outreach",
    title: "AFK Work Item: Draft, edit, and compliance-check Outreach Email",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["contact", "publish"],
    what:
      "Implement Outreach Drafter Agent and Review Dashboard flow for Draft Outreach. Drafts should use Preview URL, safe claims, Contact Evidence, opportunity category, sender identity, postal address, and opt-out wording, then run through Compliance Gate checks before approval/send readiness.",
    acceptance: [
      "Outreach Drafter Agent produces structured subject, text body, HTML body, claims-used, compliance notes, and review requirement.",
      "Draft Outreach is tailored to Opportunity Category and distinguishes first-website from upgrade pitches.",
      "Dashboard allows Operator Edits to subject/body before approval.",
      "Draft Outreach includes Preview URL, sender identity, postal address, and opt-out wording.",
      "Compliance Gate blocks drafts with unsupported claims, missing footer requirements, missing published preview, unsuitable contact, suppression, or do-not-contact status.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Review email tone, truthful phrasing, supported claims, Google non-affiliation, opt-out wording, and whether compliance failures are clear to the operator.",
  },
  {
    key: "send-outreach",
    title: "AFK Work Item: Send approved Outreach Emails with Resend adapter and suppression checks",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["draft-outreach"],
    what:
      "Implement the Email Sending Provider adapter using Resend, suppression/do-not-contact checks, send status persistence, provider message metadata, safe test adapter behavior, and dashboard send feedback.",
    acceptance: [
      "Approved Draft Outreach can be sent through a Resend adapter when the Compliance Gate passes.",
      "Provider message ID, delivery/send status, suppression status, sent timestamp, and failure metadata are persisted.",
      "Suppressed or do-not-contact prospects cannot receive Outreach Emails.",
      "Send failures create operator-visible Workflow Failures and are retryable when appropriate.",
      "Tests and development mode cannot send real outreach emails accidentally.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Verify no real sends in tests, suppression is non-bypassable, provider details are adapter-contained, and failures are auditable.",
  },
  {
    key: "review-policy",
    title: "AFK Work Item: Add Review Policy toggles without bypassing the Compliance Gate",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["publish", "send-outreach"],
    what:
      "Implement the two operator-facing Review Policy toggles and wire them through preview publication and outreach sending. The toggles may skip Human Review but must never skip the Compliance Gate.",
    acceptance: [
      "Dashboard exposes only require-review-before-preview-publication and require-review-before-outreach-sending toggles.",
      "When preview review is disabled, eligible previews can auto-publish only if all Compliance Gate conditions pass.",
      "When outreach review is disabled, eligible outreach can auto-send only if all Compliance Gate conditions pass.",
      "Compliance failures still pause the workflow and appear in the Review Dashboard.",
      "Audit Trail records whether a human approval was required or skipped by Review Policy.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Pay close attention to the distinction between skipping Human Review and bypassing compliance. There should be no UI or API path that skips hard blocks.",
  },
  {
    key: "workflow-audit",
    title: "AFK Work Item: Persist Workflow State, Workflow Failures, retries, and Audit Trail events",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["discovery", "research", "assessment"],
    what:
      "Harden the Agent Workflow infrastructure by persisting Workflow State, Workflow Steps, retry metadata, operator-visible Workflow Failures, Prompt Versions, agent outputs, Operator Edits, approvals, publication events, send events, and Audit Trail history.",
    acceptance: [
      "Workflow State is persisted in Postgres and can resume after review pauses or retryable failures.",
      "Workflow Failures store failed step, error summary, retryability, timestamps, and operator-visible status.",
      "Operator can retry from a failed workflow step where retry is allowed.",
      "Audit Trail shows agent runs, model/prompt versions, output JSON summaries, source references, operator edits, approvals, publications, and sends.",
      "Prompt Versions are stored with agent outputs.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Ensure this remains an audit trail rather than noisy debug logs. Verify retries do not duplicate side effects such as publishing or sending.",
  },
  {
    key: "reply-conversion",
    title: "AFK Work Item: Add manual Reply Tracking and Work Conversion schema hooks",
    labels: ["Sandcastle", "AFK-ready"],
    deps: ["send-outreach"],
    what:
      "Add v1 manual status/data hooks for Reply Tracking, Follow-Up Outreach metadata, and Work Conversion without building automated reply handling or automated follow-ups.",
    acceptance: [
      "Operator can manually mark a Prospect Business as replied and record reply timestamp, summary, and notes.",
      "Operator can manually record Work Conversion status and estimated value/notes.",
      "Schema includes follow-up metadata hooks without sending automated follow-ups.",
      "Prospect Status can move to replied or work_won through explicit operator action.",
      "Dashboard displays reply and conversion fields on Prospect Detail.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e"],
    review:
      "Verify no inbox automation or follow-up sending sneaks into v1, and that manual tracking data is enough for future analytics.",
  },
  {
    key: "server-deploy",
    title: "HITL Work Item: Validate Docker Compose deployment on the operator's server/domain",
    labels: ["Sandcastle", "HITL"],
    deps: ["publish", "send-outreach", "workflow-audit"],
    what:
      "Validate the Docker Compose deployment on the operator-controlled server and purchased domain, including Review Dashboard access, worker connectivity, Postgres persistence, nginx/static preview serving, noindex Preview URLs, and environment configuration.",
    acceptance: [
      "Operator provides server/domain access or performs the server-side configuration.",
      "Docker Compose deployment starts web, worker, Postgres, and preview-serving services successfully.",
      "Dashboard is reachable only through authenticated access.",
      "A Published Preview is publicly reachable at the configured domain and has noindex behavior.",
      "Environment configuration is documented without exposing secrets.",
    ],
    checks: ["npm run typecheck", "npm run test", "docker compose config"],
    review:
      "HITL required: the operator must confirm server/domain configuration and public preview availability. Reviewer should also check that no secrets are committed or displayed.",
  },
  {
    key: "e2e",
    title: "AFK Work Item: Full mocked end-to-end Prospect Business workflow",
    labels: ["Sandcastle", "AFK-ready"],
    deps: [
      "dedupe",
      "research",
      "assessment",
      "contact",
      "preview-generation",
      "publish",
      "draft-outreach",
      "send-outreach",
      "review-policy",
      "workflow-audit",
      "reply-conversion",
    ],
    what:
      "Add the full mocked end-to-end workflow verification that exercises the complete Prospect Business lifecycle across discovery, rediscovery, research, website assessment, preview generation, publication, contact finding, draft outreach, compliance, sending, audit, workflow failure, and manual reply/conversion hooks.",
    acceptance: [
      "A mocked provider integration test completes a full eligible prospect workflow from Discovery Run through Outreach Email sent status.",
      "A mocked rediscovery scenario updates appearances without rerunning the full workflow.",
      "A mocked Contact Unavailable scenario blocks outreach by default.",
      "A mocked Compliance Gate failure blocks auto-publish or auto-send even when Review Policy disables Human Review.",
      "Playwright covers login, discovery creation, prospect detail, preview review, outreach review, and audit visibility.",
    ],
    checks: ["npm run typecheck", "npm run test", "npm run test:e2e", "npm run build:previews"],
    review:
      "Final PRD review should focus on whether the whole product promise is demoable with mocks, real side effects are disabled in tests, and no out-of-scope features were introduced.",
  },
];

const created = new Map();

for (const item of items) {
  const blockedBy =
    item.deps.length === 0
      ? "None - can start immediately"
      : item.deps.map((key) => `- ${repo}#${created.get(key).number}`).join("\n");
  const issue = createIssue({
    title: item.title,
    body: workItemBody({
      parentRef,
      what: item.what,
      acceptance: item.acceptance,
      blockedBy,
      checks: item.checks,
      review: item.review,
    }),
    labels: item.labels,
  });
  created.set(item.key, issue);
}

console.log(`PRD: ${prd.url}`);
for (const [key, issue] of created) {
  console.log(`${key}: ${issue.url}`);
}
