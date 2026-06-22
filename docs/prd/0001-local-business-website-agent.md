# PRD: Local Business Website Agent

## Problem Statement

The operator wants a compliant agentic system that can discover local prospect businesses in a chosen location, understand whether each business has a website opportunity, generate a professional preview website, find a suitable contact email, and prepare respectful outreach asking whether the business is interested in paid website work.

The current process would otherwise be manual, scattered, and hard to audit: the operator would need to search Google Maps/Places manually, inspect websites one by one, collect business context, design a tailored website concept, host it somewhere, find contact details, write outreach, and track whether the business replied or became work. The operator also wants analytics-ready discovery and website data for future analysis by location, without building an analytics dashboard in v1.

The system must avoid becoming a raw scraper or unsupervised bulk-email machine. It must use approved discovery sources, preserve evidence for generated claims, expose human review where configured, and enforce a compliance gate that cannot be bypassed by convenience toggles.

## Solution

Build a single-operator TypeScript monorepo containing a Review Dashboard, LangGraph worker, Postgres prospect registry, Svelte preview generation pipeline, and self-hosted preview publishing flow.

The operator starts a Discovery Run for a Search Location using Google Places API. Discovered Prospect Businesses are saved immediately to Postgres, deduplicated by Google Place ID, and linked to each Discovery Run through Discovery Appearances. The Agent Workflow researches each Prospect Business, assesses its Website Opportunity, finds contact evidence, generates an adaptive Svelte Preview Website when eligible, renders it in the Review Dashboard, publishes it to an unguessable noindex Preview URL after Preview Approval or policy-controlled auto-publish, drafts an Outreach Email, and sends it through Resend only when the Compliance Gate allows it.

The Review Dashboard lets the operator inspect Prospect Businesses, Business Context, Website Assessments, Contact Evidence, Preview Websites, Draft Outreach, Workflow Failures, Operator Edits, and Audit Trail events. Human Review is controlled by two Review Policy toggles: require review before preview publication, and require review before outreach sending. These toggles can skip human approval, but they cannot bypass the Compliance Gate.

The system stores Analytics-Ready Data and schema hooks for Reply Tracking, Follow-Up Outreach, and Work Conversion, but v1 does not include analytics dashboards, automated replies, or automated follow-ups.

## User Stories

1. As an operator, I want to log into a protected Review Dashboard, so that only I can run discovery, publish previews, and send outreach.
2. As an operator, I want to configure provider credentials and runtime behavior through `.env`, so that secrets are not editable through the dashboard.
3. As an operator, I want to start a Discovery Run by entering a Search Location and business category/search term, so that I can find relevant local Prospect Businesses.
4. As an operator, I want Discovery Runs to support place search, so that I can search locations such as towns, neighbourhoods, or city centres.
5. As an operator, I want Discovery Runs to support radius search, so that I can search around a coordinate or selected place.
6. As an operator, I want to set a Discovery Limit for Google Places results, so that I can control how many businesses are processed in a run.
7. As an operator, I want every Discovery Run to store its query, location, mode, source, and result metadata, so that the data can support future location-based analytics.
8. As an operator, I want each discovered Prospect Business saved immediately to the Prospect Registry, so that discovery results are not temporary.
9. As an operator, I want Prospect Businesses deduplicated by Google Place ID, so that rediscovered businesses do not create duplicate records.
10. As an operator, I want rediscovered businesses recorded as additional Discovery Appearances, so that repeated appearances across locations/categories remain analytics-ready.
11. As an operator, I want rediscovery to update source data without automatically rerunning the whole workflow, so that the system does not repeatedly rebuild previews for the same business.
12. As an operator, I want to see Prospect Status for each business, so that I can understand where each business is in the workflow.
13. As an operator, I want Prospect Status values for discovery, research, assessment, preview, contact, outreach, reply, work, archive, and failure states, so that the dashboard can show workflow progress clearly.
14. As an operator, I want the Business Context Researcher Agent to use expanded research by default, so that generated previews are based on richer public context.
15. As an operator, I want the Business Context Researcher Agent to use Google Places, the business website, search results, and compliant page extraction, so that it can collect useful public facts.
16. As an operator, I want Business Context to store source references, so that generated claims can be traced back to evidence.
17. As an operator, I want Forbidden Research Data excluded from Business Context, so that the system does not use private, sensitive, login-gated, paywalled, or inappropriate personal data.
18. As an operator, I want only the Business Context Researcher Agent and Contact Finder Agent to access open web/search tools directly, so that source gathering stays controlled.
19. As an operator, I want other agents to receive curated evidence and inputs, so that generated websites and outreach do not depend on untracked browsing.
20. As an operator, I want Supported Claims enforced for website and outreach copy, so that the system does not invent awards, reviews, prices, credentials, or years in business.
21. As an operator, I want each current website assessed with deterministic checks and a Website Reviewer Agent, so that both technical evidence and design judgment inform the Website Opportunity.
22. As an operator, I want the Website Reviewer Agent to evaluate HTML and desktop/mobile screenshots, so that it can judge what the current website experience is like.
23. As an operator, I want the Website Reviewer Agent to use editable review criteria, so that the product can improve its understanding of good local-business websites over time.
24. As an operator, I want each Prospect Business classified into an Opportunity Category, so that the system can distinguish first-website, upgrade, technical-fix, social-only, sufficient, and unknown opportunities.
25. As an operator, I want existing websites to remain eligible for assessment, so that businesses with weak or outdated websites can still receive upgrade-oriented previews.
26. As an operator, I want `modern_sufficient` businesses stored but not preview-eligible by default, so that the system does not waste effort on businesses unlikely to need work.
27. As an operator, I want `unknown` opportunities to require operator review before preview generation, so that uncertainty does not lead to awkward outreach.
28. As an operator, I want preview eligibility derived from opportunity category but overrideable by me, so that I can pursue strategically interesting businesses manually.
29. As an operator, I want the Website Designer Agent to choose adaptive website structure based on business type and context, so that previews are not generic one-page templates.
30. As an operator, I want the Website Designer Agent to choose appropriate navigation, sections, CTAs, and features, so that a restaurant, salon, trade business, or shop can each receive a fitting preview.
31. As an operator, I want v1 previews to use adaptive generation without custom live functionality, so that previews can look tailored without requiring payments, bookings, CMS, or forms.
32. As an operator, I want previews to link to existing public booking, menu, ordering, or social URLs when available, so that useful live paths can still be represented.
33. As an operator, I want the Website Builder Agent to generate Svelte-based preview websites, so that preview artifacts match the chosen implementation target.
34. As an operator, I want generated preview metadata, design plans, content JSON, source references, slug, and build metadata stored in Postgres, so that previews are inspectable and auditable.
35. As an operator, I want generated Svelte source and built static assets stored on disk, so that previews can be rebuilt, edited, served, and unpublished cleanly.
36. As an operator, I want Preview Websites rendered in the Review Dashboard before publication, so that I can inspect them before a business sees them when review is required.
37. As an operator, I want to edit preview content and design plans before approval, so that I can correct or improve generated work.
38. As an operator, I want approved previews published to unguessable Preview URLs on my own domain, so that prospects can view their website concept without logging in.
39. As an operator, I want published previews to be noindex, so that generated preview websites do not appear in search results.
40. As an operator, I want to unpublish a Published Preview, so that I can remove access if needed.
41. As an operator, I want previews served from my own configured server and domain, so that I control the preview hosting surface.
42. As an operator, I want Docker Compose deployment with web, worker, Postgres, and nginx/static preview serving, so that I can run the product on my own server.
43. As an operator, I want the Contact Finder Agent to find public business contact emails in a strict source order, so that outreach goes to appropriate contact channels.
44. As an operator, I want Contact Evidence to store source URL, confidence, role-versus-personal classification, and outreach approval status, so that contact decisions are reviewable.
45. As an operator, I want v1 to avoid guessed emails, so that the system does not send to speculative addresses.
46. As an operator, I want prospects marked Contact Unavailable when no suitable email is found, so that no outreach is sent by default.
47. As an operator, I want to manually add or approve contact paths, so that I can proceed when I have verified a contact myself.
48. As an operator, I want v1 to avoid automated contact form submission, so that the product does not become a form-spamming agent.
49. As an operator, I want the Outreach Drafter Agent to write short, respectful, truthful Draft Outreach, so that businesses receive a professional message.
50. As an operator, I want Draft Outreach tailored to Opportunity Category, so that a first-website pitch differs from an upgrade pitch.
51. As an operator, I want Draft Outreach to include the Preview URL, sender identity, postal address, and opt-out wording, so that outreach is clear and compliant.
52. As an operator, I want Draft Outreach to avoid implying the prospect requested the preview or that the system is affiliated with Google, so that the email is honest.
53. As an operator, I want to edit Draft Outreach before approval, so that I can control the final message.
54. As an operator, I want approved Outreach Emails sent through Resend if its free tier remains sufficient, so that v1 can send real outreach without unnecessary platform complexity.
55. As an operator, I want the email provider behind an adapter, so that a later provider can replace Resend if needed.
56. As an operator, I want provider message IDs, delivery status, suppression status, and sent timestamps stored, so that future reply and conversion tracking can work.
57. As an operator, I want schema hooks for Reply Tracking and Work Conversion, so that I can later measure replies and won work.
58. As an operator, I want manual reply and conversion fields in v1, so that I can track outcomes before inbox automation exists.
59. As an operator, I want v1 to avoid automated reply handling, so that the first release focuses on the core workflow.
60. As an operator, I want v1 to avoid automated follow-up outreach, so that deliverability and tone risks stay controlled.
61. As an operator, I want the Review Policy to expose only two toggles, so that the product stays simple.
62. As an operator, I want one toggle for review before preview publication, so that I can choose whether previews publish automatically.
63. As an operator, I want one toggle for review before outreach sending, so that I can choose whether approved workflow outputs send automatically.
64. As an operator, I want Review Policy toggles to skip Human Review but not the Compliance Gate, so that automation cannot bypass hard safety and compliance rules.
65. As an operator, I want auto-publishing blocked when forbidden data, unsupported claims, failed generation, or missing noindex preview URL exists, so that risky previews are not exposed.
66. As an operator, I want auto-sending blocked when contact, preview, footer, supported-claim, suppression, or do-not-contact requirements fail, so that risky outreach is not sent.
67. As an operator, I want Workflow Failures stored and displayed, so that I can understand and retry failed work.
68. As an operator, I want limited automatic retry for transient errors, so that temporary provider/network issues do not always require manual action.
69. As an operator, I want retry controls from the failed workflow step, so that I do not need to rerun everything after a recoverable failure.
70. As an operator, I want an Audit Trail of agent outputs, prompt versions, tool evidence, operator edits, approvals, publications, and sends, so that important decisions are explainable later.
71. As an operator, I want Prompt Versions stored with agent outputs, so that I know which prompt produced each decision.
72. As an operator, I want prompts managed as file-based prompt versions, so that I can iterate without needing a prompt CMS.
73. As an operator, I want OpenAI Responses API used as the primary LLM provider behind an adapter, so that agents can use structured outputs, tool workflows, and multimodal review while retaining future provider flexibility.
74. As an operator, I want LangGraph used for the durable Agent Workflow, so that discovery, research, review pauses, publishing, and outreach are explicit states rather than one chat loop.
75. As an operator, I want Postgres to own Prospect Registry, Workflow State, generated metadata, and compliance records, so that the system has a durable source of truth.
76. As an operator, I want the Review Dashboard to include Discovery Runs, Prospects, Prospect Detail, Preview Review, Outreach Review, Settings/Config Readout, and Audit Trail screens, so that I can operate the full workflow from one place.
77. As an operator, I want Settings/Config Readout to show effective non-secret configuration, so that I can debug setup without exposing secret values.
78. As an operator, I want Operator Edits limited to reviewable artifacts, so that raw workflow state, provider logs, and compliance requirements remain trustworthy.
79. As an operator, I want Analytics-Ready Data preserved without building an analytics dashboard, so that future location-based analysis can be added later.
80. As an operator, I want tests to avoid sending real emails, so that verification cannot accidentally contact businesses.

## Implementation Decisions

- Build a TypeScript monorepo with separate modules for the Review Dashboard, worker, database/repositories, agents/prompts, preview rendering/building, provider adapters, configuration, and shared domain logic.
- Use LangGraph for the durable Agent Workflow. The workflow should model explicit states, review pauses, retries, failures, resumptions, publication, and outreach decisions.
- Use Postgres for the Prospect Registry, Discovery Runs, Discovery Appearances, Business Context, Website Assessments, Contact Evidence, Preview Website metadata, Published Preview metadata, Draft Outreach, Outreach Email metadata, Workflow State, Audit Trail, Operator Edits, suppression entries, Reply Tracking hooks, and Work Conversion hooks.
- Use Google Places API as the v1 Business Discovery Source. Do not implement CSV import.
- Model Prospect Identity with an internal UUID and a unique Google Place ID for Google-discovered businesses.
- Deduplicate rediscovered businesses by Google Place ID. Store each rediscovery as a Discovery Appearance linked to the original Prospect Business and Discovery Run.
- Support `place_search` and `radius_search` Discovery Modes.
- Expose a single operator-facing Discovery Limit for maximum Google Places results per Discovery Run. Use internal provider timeouts, retry caps, and error handling rather than exposing per-agent limits.
- Preserve Search Location metadata including normalized label, latitude/longitude centre, and radius or viewport where available.
- Maintain Prospect Status values: `discovered`, `researching`, `research_complete`, `assessing_website`, `assessment_complete`, `not_preview_eligible`, `generating_preview`, `preview_ready_for_review`, `preview_published`, `finding_contact`, `contact_unavailable`, `drafting_outreach`, `outreach_ready_for_review`, `outreach_sent`, `replied`, `work_won`, `archived`, and `failed`.
- Create deep, independently testable domain modules for opportunity classification, preview eligibility, contact suitability, compliance gate decisions, supported claim validation, discovery deduplication, and workflow transition decisions.
- Keep open web/search tools limited to the Business Context Researcher Agent and Contact Finder Agent. Other agents receive curated, source-backed inputs.
- The Business Context Researcher Agent may use Google Places, the prospect business website, search engine results, and compliant web page extraction as Research Tools.
- Research defaults to expanded research, but all Research Tools remain subject to source terms, robots directives where applicable, and the Compliance Gate.
- Exclude Forbidden Research Data from Business Context. This includes personal contact details not clearly published for business use, staff personal profiles, home addresses not published as business locations, sensitive inferences, login-gated content, paywalled content, and content obtained by bypassing access restrictions.
- Store Business Context sources and facts separately enough that generated claims can be traced back to evidence.
- Enforce Supported Claims for generated preview websites and outreach. Do not allow fake testimonials, invented reviews, unsupported awards, unsupported credentials, unsupported prices, unsupported years in business, or unsupported factual claims.
- Implement Website Assessment with deterministic checks plus Website Reviewer Agent judgment from HTML and desktop/mobile screenshots.
- Classify Website Opportunities into `no_website`, `website_unreachable`, `social_only`, `outdated_or_low_quality`, `modern_sufficient`, and `unknown`.
- Treat existing websites as possible upgrade opportunities rather than automatic disqualifiers.
- Make `no_website`, `website_unreachable`, `social_only`, and `outdated_or_low_quality` preview-eligible by default.
- Store `modern_sufficient` businesses without generating previews by default.
- Require operator review for `unknown` opportunities before preview generation.
- Implement Website Designer Agent as the owner of adaptive generation. It should choose structure, sections, navigation, CTAs, and features from Business Context and Website Assessment evidence.
- Implement Website Builder Agent as the owner of Generated Svelte Websites. It should turn an approved design plan into Svelte preview artifacts.
- Store preview design plans, generated content JSON, source references, slug, build metadata, and status in Postgres.
- Store generated Svelte source files and built static assets on disk as Preview Artifacts.
- Publish previews to the operator's own configured server and domain through a deployment adapter.
- Serve Published Previews under unguessable Preview URLs with search indexing disabled.
- Use Docker Compose for the deployment stack, including web, worker, Postgres, and nginx/static preview-serving services.
- Use `.env` environment variables for secrets and runtime configuration. Do not make secrets editable through the Review Dashboard.
- Implement simple single-operator authentication for the Review Dashboard, configured from `.env`.
- Implement Review Dashboard screens for login, Discovery Runs, Prospects, Prospect Detail, Preview Review, Outreach Review, Settings/Config Readout, and Audit Trail.
- Allow Operator Edits to business notes, opportunity category overrides, preview website content, design plans, draft outreach, contact approval, prospect status, and notes.
- Do not expose raw agent workflow state, provider logs, compliance footer bypasses, or provider message log editing as Operator Edits.
- Implement Contact Finder Agent with a strict source order: business website contact areas first, Google Places/contact fields when available, official linked social/profile pages, then search results pointing to official business-controlled pages.
- Store Contact Evidence including email address, source URL, source type, confidence, role-versus-personal classification, outreach approval status, and reason.
- Do not guess emails in v1.
- Mark prospects Contact Unavailable when no suitable contact email is found. Do not send outreach by default in that state.
- Implement Outreach Drafter Agent to produce short, respectful, truthful, non-pushy Draft Outreach tailored to Opportunity Category.
- Require Draft Outreach to include sender identity, postal address, opt-out wording, and Preview URL.
- Prohibit Draft Outreach from implying the prospect requested the preview, harshly criticizing the current website, over-personalizing from sensitive data, or implying affiliation with Google.
- Use Resend as the v1 Email Sending Provider if its free tier remains sufficient. Keep email sending behind a provider adapter.
- Store email provider message IDs, delivery status, suppression status, sent timestamps, and failure metadata.
- Implement suppression/do-not-contact checks before any send.
- Include schema hooks for Reply Tracking, Follow-Up Outreach, and Work Conversion, but do not implement automated replies or automated follow-ups in v1.
- Expose exactly two Review Policy toggles: require review before preview publication, and require review before outreach sending.
- Ensure Review Policy toggles can skip Human Review but cannot bypass the Compliance Gate.
- Require the Compliance Gate to block auto-publishing unless generation succeeded, no forbidden data was used, no unsupported claims were detected, and the Preview URL will be noindex.
- Require the Compliance Gate to block auto-sending unless a suitable contact is approved, the preview is published, the compliance footer is configured, all claims are supported, and the prospect is not suppressed or marked do-not-contact.
- Store Workflow State and background job state in Postgres rather than introducing Redis or a separate queue service in v1.
- Store Workflow Failures with error summaries, failed step identifiers, retryability, and operator-visible status.
- Allow limited automatic retry for transient provider/network failures, then require operator-triggered retry.
- Keep a lightweight Audit Trail of agent runs, model and prompt versions, output JSON, source references, operator edits, approvals, publications, and outreach sends.
- Use file-based prompts with explicit Prompt Versions. Meaningful prompt changes should bump the version stored with outputs.
- Use OpenAI Responses API as the primary LLM Provider behind an adapter.
- Keep generated website live functionality out of v1. Mock or link to public booking/order/menu/social URLs when available, but do not build payments, bookings, CMS, or custom forms.

## Testing Decisions

- Tests should focus on externally observable behavior and domain decisions, not implementation details inside prompts, UI components, or workflow internals.
- Unit test deep domain modules for Opportunity Category decisions, Preview Eligibility, Contact Suitability, Supported Claim validation, Compliance Gate behavior, discovery deduplication, and workflow transition rules.
- Repository tests should verify Postgres persistence, Google Place ID uniqueness, Discovery Appearance creation, source/fact storage, preview metadata storage, audit event recording, and workflow failure persistence.
- Agent contract tests should use mocked OpenAI responses and validate structured output schemas for Website Reviewer Agent, Website Designer Agent, Contact Finder Agent, and Outreach Drafter Agent.
- Provider adapter tests should mock Google Places, OpenAI, Resend, web extraction, screenshot capture, and preview deployment behavior.
- Integration tests should cover one Discovery Run with mocked Google Places results and verify prospects, run metadata, and appearances are persisted correctly.
- Integration tests should cover one full Prospect Business workflow with mocked external providers from discovery through Draft Outreach and review-gated send.
- Integration tests should cover rediscovery of an existing Google Place ID and verify the existing Prospect Business is updated without automatically rerunning the full workflow.
- Integration tests should cover Contact Unavailable behavior and verify no Outreach Email is sent by default.
- Integration tests should cover Review Policy toggles and verify they skip Human Review but not the Compliance Gate.
- Integration tests should cover Workflow Failure persistence and retry from the failed step.
- Playwright tests should cover dashboard login, Discovery Run creation, prospect list filtering/navigation, Prospect Detail review, Preview Review approval/publish/unpublish, Outreach Review edit/approve/send flow, Settings/Config Readout, and Audit Trail visibility.
- Build verification should ensure Generated Svelte Website artifacts can be created, built, served under a preview slug, and marked noindex.
- Email tests must never send real outreach emails. Resend calls should be mocked or pointed at a safe test adapter.
- Tests should use fixed fixtures for representative business types such as restaurant, salon, trades business, shop, social-only business, no-website business, and modern-sufficient business.

## Out of Scope

- CSV import.
- Analytics dashboard.
- Multi-user accounts, teams, roles, or billing.
- Automated reply handling.
- Automated follow-up emails.
- Automated contact form submission.
- Email guessing.
- Live payments, bookings, CMS editing, custom forms, or live third-party integrations in generated websites.
- Client-facing editor or client login.
- Deployment to prospect-owned domains.
- Full CRM pipeline beyond status, Reply Tracking hooks, Work Conversion hooks, and manual notes.
- Mobile app.
- Broad autonomous scraping of Google Maps UI.
- Bypassing source terms, robots directives where applicable, login gates, paywalls, or access restrictions.

## Further Notes

- The project glossary defines the canonical language and should be followed throughout implementation. Terms such as Prospect Business, Discovery Run, Website Opportunity, Website Assessment, Preview Website, Published Preview, Draft Outreach, Compliance Gate, Review Policy, Audit Trail, and Workflow State should be preferred over generic lead-generation vocabulary.
- Existing ADRs require LangGraph, TypeScript, and Postgres for the v1 workflow; Svelte for Generated Svelte Websites; and self-hosted Published Previews on the operator's server/domain.
- Prompt skeletons already exist for Website Reviewer Agent, Website Designer Agent, Contact Finder Agent, and Outreach Drafter Agent. Implementation should turn these into versioned prompt files and store Prompt Versions with outputs.
- The first build should preserve module boundaries that make the domain decisions testable in isolation. The highest-value deep modules are the compliance gate, opportunity classifier, preview eligibility policy, contact suitability policy, supported claim validator, and discovery deduper.
- The product should remain review-first by default, even though Review Policy can later allow auto-publication and auto-send when the Compliance Gate passes.
