# Local Business Website Agent

This context describes a lead-generation assistant that discovers local businesses, creates preview websites for suitable prospects, and prepares compliant outreach for human or policy-controlled approval.

## Language

**Prospect Business**:
A local business being evaluated as a possible recipient of a preview website and outreach.
_Avoid_: lead, target, scraped business

**Prospect Identity**:
The internal and external identifiers used to recognize and deduplicate a prospect business.
_Avoid_: ID, key

**Operator**:
The single person using the system to discover prospects, review preview websites, and approve outreach.
_Avoid_: user, admin, account

**Operator Authentication**:
The simple single-operator login required to access the review dashboard.
_Avoid_: user management, team auth

**Business Discovery Source**:
An approved provider or dataset used to identify prospect businesses.
_Avoid_: scraper, Google Maps scrape

**Prospect Registry**:
The persistent record of prospect businesses discovered by the system.
_Avoid_: CSV list, scrape dump

**Prospect Status**:
The current lifecycle state of a prospect business in the workflow.
_Avoid_: pipeline stage, lead status

**Discovery Run**:
A configured search session that finds prospect businesses for a location, category, and search scope.
_Avoid_: scan, scrape job

**Discovery Appearance**:
The record that a prospect business appeared in a specific discovery run.
_Avoid_: duplicate lead, repeated result

**Discovery Limit**:
The maximum number of Google Places results a discovery run should process.
_Avoid_: per-agent limit, quota setting

**Search Location**:
The geographic area used to start a discovery run.
_Avoid_: map area, target zone

**Discovery Mode**:
The way a discovery run interprets the operator's requested search location.
_Avoid_: search type, map mode

**Analytics-Ready Data**:
Structured discovery, location, website assessment, contact, preview, and outreach records preserved for future analysis.
_Avoid_: analytics dashboard, reports

**Website Presence**:
The system's determination of whether a prospect business already has a reachable, relevant business website.
_Avoid_: has site, no site

**Website Opportunity**:
The reason a prospect business may benefit from a preview website, whether it lacks a website or has one that could be improved.
_Avoid_: skip reason, website status

**Opportunity Category**:
A normalized classification of the prospect business's website opportunity.
_Avoid_: tag, bucket, score

**Website Assessment**:
The evidence-backed evaluation of a prospect business's current website presence and quality.
_Avoid_: audit, roast, critique

**Website Reviewer Agent**:
The agent responsible for judging a prospect business's current website using HTML, screenshots, deterministic checks, and review criteria.
_Avoid_: website scorer, design critic

**Business Context**:
Publicly available facts about a prospect business used to generate a relevant preview website and outreach.
_Avoid_: scraped profile, dossier

**Supported Claim**:
A factual statement that can be traced to stored business context evidence and is allowed by the source's terms.
_Avoid_: marketing guess, invented copy

**Business Context Researcher Agent**:
The agent responsible for gathering public business context from approved research tools and sources.
_Avoid_: scraper, OSINT bot

**Research Tool**:
An approved capability used by the business context researcher to gather or verify public business facts.
_Avoid_: scrape anything, crawler

**Research Mode**:
The configured breadth of business context gathering for a prospect business.
_Avoid_: crawl setting, scrape depth

**Forbidden Research Data**:
Information that the system must not collect, store, use for website generation, or include in outreach.
_Avoid_: sensitive enrichment, personal intel

**Contact Finder Agent**:
The agent responsible for finding and classifying public business contact emails for compliant outreach.
_Avoid_: email scraper, email guesser

**Contact Evidence**:
The source-backed record explaining where a contact email was found and why it is suitable or unsuitable for outreach.
_Avoid_: email hit, scraped email

**Contact Unavailable**:
The state where no suitable outreach email has been found for a prospect business.
_Avoid_: failed email scrape, no lead

**Preview Website**:
A professionally generated website draft created for a prospect business before any paid engagement exists, with structure and features adapted to the business type.
_Avoid_: final website, client site

**Preview URL**:
An unguessable public URL on the operator's domain where a prospect business can view its preview website.
_Avoid_: client domain, staging link

**Published Preview**:
A preview website that is available at a preview URL.
_Avoid_: live client site, production site

**Preview Host**:
The operator-controlled server and domain used to serve published preview websites.
_Avoid_: Cloudflare Pages, client hosting

**Deployment Stack**:
The server runtime arrangement used to run the dashboard, worker, database, and preview host.
_Avoid_: infrastructure, hosting setup

**Runtime Configuration**:
Environment-based settings that configure providers, credentials, review policy defaults, sending limits, and preview hosting.
_Avoid_: admin settings, config database

**Preview Approval**:
The operator decision that a generated preview website is ready to publish.
_Avoid_: publish flag, website review complete

**Adaptive Generation**:
The process of choosing a preview website's layout, sections, navigation, and calls to action based on the prospect business context.
_Avoid_: dynamic site, template

**Live Functionality**:
Interactive production behavior such as payments, bookings, CMS editing, custom forms, or live third-party integrations.
_Avoid_: dynamic site, integration

**Website Designer Agent**:
The agent responsible for choosing the structure, content strategy, and feature set of a preview website from the business context and website opportunity.
_Avoid_: template picker, page generator

**Website Builder Agent**:
The agent responsible for turning an approved website design plan into a Svelte-based preview website.
_Avoid_: HTML generator, page coder

**Generated Svelte Website**:
A preview website implemented with Svelte components and generated from structured business context and design plans.
_Avoid_: raw HTML output, React preview

**Preview Artifact**:
The generated Svelte source files and built static assets for a preview website.
_Avoid_: blob, HTML string

**Preview Eligibility**:
The decision that a prospect business should or should not receive a generated preview website by default.
_Avoid_: generation flag, should build

**Human Review**:
A configurable approval step where a person checks a preview website and/or outreach before it is sent or published.
_Avoid_: manual QA, approval toggle

**Review Dashboard**:
The operator-facing workspace for inspecting prospect businesses, preview websites, and drafted outreach before approval.
_Avoid_: admin panel, moderation queue

**Operator Edit**:
A deliberate change made by the operator to reviewable business notes, classifications, generated website content, contact approval, outreach copy, or prospect status.
_Avoid_: database edit, raw state change

**Audit Trail**:
The chronological record of agent outputs, tool evidence, operator edits, approvals, publications, and outreach actions.
_Avoid_: logs, debug output

**Prompt Version**:
The named version of an agent prompt used to produce a stored agent output.
_Avoid_: prompt text hash, model config

**Outreach Email**:
A compliant commercial email that invites a prospect business to view its preview website and discuss paid work.
_Avoid_: cold spam, campaign blast

**Email Sending Provider**:
The external service used to send approved outreach emails and return delivery metadata.
_Avoid_: mailer, SMTP thing

**Draft Outreach**:
An outreach email prepared by the system but not yet sent.
_Avoid_: queued email, campaign email

**Outreach Drafter Agent**:
The agent responsible for writing compliant draft outreach using the preview URL, safe claims, contact evidence, and opportunity category.
_Avoid_: copywriter bot, spam generator

**Reply Tracking**:
The record of prospect responses to outreach and follow-up communication.
_Avoid_: inbox scrape, email thread dump

**Follow-Up Outreach**:
A later outreach email sent after the initial outreach when policy and prospect state allow it.
_Avoid_: drip campaign, sequence blast

**Work Conversion**:
The outcome where a prospect business becomes paid or serious potential work for the operator.
_Avoid_: sale, closed lead

**Compliance Gate**:
A workflow checkpoint that prevents disallowed discovery, website generation, publication, or outreach behavior.
_Avoid_: safety check, guardrail

**Review Policy**:
The operator-configurable setting that decides whether preview publication and outreach sending require human review.
_Avoid_: toggle set, approval config

**Agent Workflow**:
The durable, stateful process that coordinates discovery, assessment, context gathering, preview generation, review, publishing, and outreach.
_Avoid_: chat loop, automation script

**Workflow State**:
The persisted progress, retries, errors, pauses, and resumptions for discovery runs and per-prospect agent workflows.
_Avoid_: job queue, task log

**Workflow Failure**:
An operator-visible failed workflow step with an error summary and retry path.
_Avoid_: exception, crash

**LLM Provider**:
The model provider used by agents for reasoning, structured output, website review, website design, website generation, and outreach drafting.
_Avoid_: AI backend, model

## Relationships

- The **Operator** runs discovery, reviews work, and approves or rejects outreach.
- **Operator Authentication** protects the **Review Dashboard**.
- The **Operator** starts a **Discovery Run** for a **Search Location**.
- A **Business Discovery Source** produces candidate **Prospect Businesses**.
- A **Discovery Run** records the **Business Discovery Source**, **Search Location**, query, category, and discovered results.
- A **Discovery Run** uses one **Discovery Mode**.
- A **Discovery Run** has one **Discovery Limit**.
- A **Discovery Appearance** links one **Prospect Business** to one **Discovery Run**.
- **Analytics-Ready Data** is produced by **Discovery Runs**, **Website Assessments**, contact finding, preview generation, and outreach decisions.
- Each **Prospect Business** has one **Prospect Identity**.
- The **Prospect Registry** stores **Prospect Businesses** as they are discovered.
- Each **Prospect Business** has one current **Prospect Status**.
- A **Prospect Business** has one **Website Presence** assessment.
- A **Prospect Business** may have one or more **Website Opportunities**.
- A **Website Opportunity** has exactly one **Opportunity Category**.
- A **Website Assessment** supports the selected **Opportunity Category**.
- A **Website Reviewer Agent** produces the judgment portion of a **Website Assessment**.
- **Preview Eligibility** is derived from the **Opportunity Category** and may be overridden by the **Operator**.
- A **Prospect Business** may have **Business Context** gathered from approved public sources.
- A **Business Context Researcher Agent** gathers **Business Context** using **Research Tools**.
- A **Research Mode** controls how broadly the **Business Context Researcher Agent** searches for context.
- **Forbidden Research Data** is excluded from **Business Context**.
- **Supported Claims** are derived from **Business Context**.
- A **Contact Finder Agent** produces **Contact Evidence** for possible outreach recipients.
- **Contact Unavailable** prevents automated outreach unless the **Operator** manually adds or approves a contact path.
- A **Preview Website** is generated from **Business Context** for exactly one **Prospect Business**.
- **Adaptive Generation** determines the structure of a **Preview Website**.
- A **Website Designer Agent** designs one **Preview Website** for one **Prospect Business**.
- A **Website Builder Agent** produces one **Generated Svelte Website** for one approved design plan.
- A **Generated Svelte Website** implements a **Preview Website**.
- A **Preview Artifact** stores the generated source and built assets for a **Generated Svelte Website**.
- A **Published Preview** exposes one **Preview Website** at one **Preview URL**.
- A **Preview Host** serves **Published Previews**.
- A **Deployment Stack** runs the **Review Dashboard**, **Agent Workflow**, **Prospect Registry**, and **Preview Host**.
- **Runtime Configuration** configures providers, credentials, defaults, and deployment behavior.
- A **Preview URL** belongs to the operator's domain, not the prospect business's domain.
- **Preview Approval** is required before a **Preview Website** becomes a **Published Preview** unless disabled by policy.
- **Draft Outreach** references one **Preview Website**.
- An **Outreach Drafter Agent** produces **Draft Outreach**.
- An **Outreach Email** is produced when **Draft Outreach** is approved for sending.
- An **Email Sending Provider** sends approved **Outreach Emails**.
- **Reply Tracking** belongs to outreach and can produce **Work Conversion** records.
- A **Compliance Gate** may require **Human Review** before publishing a **Preview Website** or sending an **Outreach Email**.
- A **Review Policy** controls whether **Preview Approval** and outreach approval are required.
- A **Review Dashboard** presents **Prospect Businesses**, **Preview Websites**, and **Draft Outreach** for **Human Review**.
- An **Operator Edit** may change reviewable artifacts but not raw agent state, provider logs, or compliance requirements.
- An **Audit Trail** records agent and operator decisions that affect prospect state, previews, publication, and outreach.
- A **Prompt Version** is stored with each agent output in the **Audit Trail**.
- An **Agent Workflow** coordinates the major steps from discovery through outreach.
- **Workflow State** persists the progress of each **Agent Workflow**.
- A **Workflow Failure** is stored in **Workflow State** and shown in the **Review Dashboard**.
- An **LLM Provider** powers agent judgment and generation inside the **Agent Workflow**.

## Example Dialogue

> **Dev:** "Can the agent scrape Google Maps and email every business without a website?"
> **Domain expert:** "No. A **Business Discovery Source** must be approved, and the **Compliance Gate** decides whether **Human Review** is required before a **Preview Website** is published or an **Outreach Email** is sent."

## Flagged Ambiguities

- "Google Maps scanning" was resolved to mean discovery through approved sources, not raw scraping of Google Maps content.
- v1 uses the Google Places API as its **Business Discovery Source** and does not include CSV import.
- v1 **Prospect Identity** uses an internal UUID plus a unique Google Place ID for Google-discovered businesses.
- Discovered **Prospect Businesses** are saved to the **Prospect Registry** immediately rather than handled as temporary search results.
- v1 **Prospect Status** values are `discovered`, `researching`, `research_complete`, `assessing_website`, `assessment_complete`, `not_preview_eligible`, `generating_preview`, `preview_ready_for_review`, `preview_published`, `finding_contact`, `contact_unavailable`, `drafting_outreach`, `outreach_ready_for_review`, `outreach_sent`, `replied`, `work_won`, `archived`, and `failed`.
- Rediscovered businesses are deduplicated by Google Place ID and recorded as additional **Discovery Appearances** rather than duplicate **Prospect Businesses**.
- Rediscovery updates source data and appearance history but does not automatically rerun the full prospect workflow unless the prior workflow failed or the operator requests it.
- The **Business Context Researcher Agent** may use Google Places, the prospect business's website, search engine results, and compliant web page extraction as **Research Tools**.
- Only the **Business Context Researcher Agent** and **Contact Finder Agent** may call open web/search **Research Tools** directly.
- Other agents receive curated inputs and source-backed evidence from the research and contact-finding steps.
- v1 defaults to expanded research, meaning the **Business Context Researcher Agent** may search beyond the prospect business's own website when gathering public context.
- **Research Tools** remain subject to source terms, robots directives where applicable, and the **Compliance Gate**.
- **Business Context** must store source references so generated websites and outreach can be traced back to evidence.
- Generated preview websites and outreach may use only **Supported Claims** for factual statements.
- **Draft Outreach** should be short, respectful, truthful, non-pushy, and tailored to the **Opportunity Category**.
- **Draft Outreach** must not pretend the prospect requested the preview, harshly criticize the current website, over-personalize from sensitive data, or imply affiliation with Google.
- Fake testimonials, invented reviews, unsupported awards, unsupported credentials, unsupported prices, and unsupported years in business are forbidden.
- **Forbidden Research Data** includes personal contact details not clearly published for business use, staff personal profiles, home addresses not published as business locations, sensitive inferences, login-gated content, paywalled content, and content obtained by bypassing access restrictions.
- The **Contact Finder Agent** searches official business pages first, then official profiles and search results that point to official pages.
- The **Contact Finder Agent** must store source URL, confidence, role-versus-personal classification, and outreach approval status for every candidate email.
- v1 does not guess contact emails unless the operator adds that capability later.
- If no suitable email is found, the **Prospect Business** is marked **Contact Unavailable** and no outreach is sent by default.
- v1 does not submit contact forms automatically.
- **Discovery Runs** preserve location and query metadata so future analytics can compare website opportunities by location.
- v1 **Discovery Modes** are `place_search` and `radius_search`.
- A **Search Location** stores a normalized label, latitude/longitude center, and radius or viewport when available.
- v1 exposes a single operator-facing **Discovery Limit** for maximum Google Places results per discovery run.
- v1 uses internal timeouts, retry caps, and provider error handling rather than operator-facing per-agent limits.
- v1 stores **Analytics-Ready Data** but does not include an analytics dashboard.
- Existing websites do not disqualify a **Prospect Business**; they may create an upgrade-oriented **Website Opportunity**.
- v1 **Opportunity Categories** are `no_website`, `website_unreachable`, `social_only`, `outdated_or_low_quality`, `modern_sufficient`, and `unknown`.
- A **Website Assessment** combines deterministic checks with a **Website Reviewer Agent** judgment from HTML and screenshots.
- The **Website Reviewer Agent** uses editable review criteria rather than hard-coded taste rules.
- **Prospect Businesses** with `no_website`, `website_unreachable`, `social_only`, or `outdated_or_low_quality` are preview-eligible by default.
- **Prospect Businesses** with `modern_sufficient` are stored but not preview-eligible by default.
- **Prospect Businesses** with `unknown` require operator review before preview generation.
- **Preview Websites** are adaptive to the prospect business type and need, rather than fixed static one-page templates.
- v1 **Preview Websites** use **Adaptive Generation** but do not build custom **Live Functionality** by default.
- v1 may link to existing public booking, ordering, menu, or social URLs when available.
- **Preview Websites** are generated as Svelte-based websites rather than React or raw HTML outputs.
- v1 stores preview metadata, design plans, content JSON, source references, slug, and build metadata in Postgres while storing **Preview Artifacts** on disk.
- Approved previews are published to unguessable **Preview URLs** on the operator's domain with search indexing disabled.
- v1 publishes previews to the operator's own configured server and domain through a deployment adapter.
- v1 uses Docker Compose with web, worker, Postgres, and nginx/static preview-serving services on the operator's server.
- v1 uses `.env` environment variables for secrets and runtime configuration; secrets are not edited through the dashboard.
- A **Published Preview** can be unpublished by the **Operator**.
- v1 renders each **Preview Website** in the **Review Dashboard** before publication.
- Default workflow: generate **Preview Website**, receive **Preview Approval**, publish **Published Preview**, draft outreach, then approve or send according to the **Compliance Gate**.
- v1 exposes only two review toggles: require review before preview publication, and require review before outreach sending.
- **Review Policy** can skip **Human Review** but cannot bypass the **Compliance Gate**.
- Auto-publishing is allowed only when the generated preview has no forbidden data, no unsupported claims, successful generation, and a noindex **Preview URL**.
- Auto-sending is allowed only when a suitable contact is approved, the preview is published, the compliance footer is configured, claims are supported, and the prospect is not suppressed or marked do-not-contact.
- The **Website Designer Agent** decides which sections and features fit the business, using editable design criteria.
- **Draft Outreach** should distinguish between a first-website pitch and an upgrade pitch.
- v1 uses Resend as the **Email Sending Provider** if its free tier remains sufficient, while keeping the provider behind an adapter.
- v1 stores sending provider message IDs, delivery status, suppression status, and sent timestamps for future reply and conversion tracking.
- Future workflow should support **Reply Tracking**, operator follow-up, automated replies where allowed, and **Work Conversion** measurement.
- v1 stores status and schema hooks for **Reply Tracking** and **Work Conversion**, but does not include automated reply handling.
- v1 stores status and schema hooks for **Follow-Up Outreach**, but does not send automated follow-ups.
- "Human review" is configurable, but still a first-class workflow step controlled by the **Compliance Gate**.
- The first usable slice is a review-first workflow that produces a **Preview Website** and **Draft Outreach**, with actual sending deferred until the core workflow is proven.
- v1 is single-operator only; team roles, multi-user accounts, and customer-facing accounts are out of scope.
- v1 requires simple single-operator authentication for the **Review Dashboard**, configured from `.env`.
- v1 non-goals: CSV import, analytics dashboard, multi-user accounts, automated reply handling, automated follow-ups, contact form submission, email guessing, live payments/bookings/CMS/forms in generated websites, client-facing editor/login, deployment to prospect-owned domains, full CRM pipeline, and mobile app.
- v1 allows **Operator Edits** to business notes, opportunity category overrides, preview website content, design plans, draft outreach, contact approval, prospect status, and notes.
- v1 does not expose raw agent workflow state, source evidence mutation beyond invalidation, compliance footer bypasses, or provider message log editing as **Operator Edits**.
- v1 keeps a lightweight **Audit Trail** of agent runs, model/prompt versions, output JSON, source references, operator edits, approvals, publications, and outreach sends.
- v1 uses file-based prompts with explicit **Prompt Versions**; meaningful prompt changes should bump the version.
- v1 uses a durable **Agent Workflow** rather than a single prompt-driven chat loop.
- v1 stores workflow and background job state in Postgres rather than adding Redis or a separate queue service.
- v1 stores failed workflow steps as retryable **Workflow Failures** after limited automatic retry for transient errors.
- v1 uses OpenAI's Responses API as the primary **LLM Provider**, behind an adapter so the implementation can change providers later.
- v1 is planned as a TypeScript monorepo with separate web dashboard, worker, database, agent, preview-rendering, and config modules.

## Data Model Outline

- `prospect_businesses`
- `discovery_runs`
- `discovery_appearances`
- `business_context_sources`
- `business_context_facts`
- `website_assessments`
- `contact_candidates`
- `preview_websites`
- `preview_publications`
- `draft_outreach`
- `outreach_emails`
- `workflow_runs`
- `workflow_steps`
- `audit_events`
- `operator_edits`
- `suppression_entries`
- `reply_tracking`
- `work_conversions`

## V1 Dashboard Screens

- Login
- Discovery Runs
- Prospects
- Prospect Detail
- Preview Review
- Outreach Review
- Settings/Config Readout
- Audit Trail

## V1 Verification Expectations

- Unit tests for opportunity category, preview eligibility, compliance gate, and contact suitability decisions.
- Repository tests for Postgres persistence and Google Place ID deduplication.
- Agent contract tests with mocked OpenAI responses using structured output schemas.
- Integration test for one discovery run with mocked Google Places.
- Integration test for one full prospect workflow with mocked external providers.
- Playwright tests for dashboard login, discovery run creation, prospect detail, preview review, and outreach review.
- Build verification for generated Svelte preview artifacts.
- Tests must not send real outreach emails.
