create table if not exists discovery_runs (
  id uuid primary key,
  source text not null,
  mode text not null check (mode in ('place_search', 'radius_search')),
  search_term text not null,
  search_location jsonb not null,
  discovery_limit integer not null check (discovery_limit > 0),
  status text not null check (status in ('running', 'completed', 'failed')),
  query_metadata jsonb not null default '{}'::jsonb,
  result_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prospect_businesses (
  id uuid primary key,
  google_place_id text not null unique,
  name text not null,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  website_url text,
  phone_number text,
  categories text[] not null default '{}',
  prospect_status text not null default 'discovered' check (
    prospect_status in (
      'discovered',
      'researching',
      'research_complete',
      'assessing_website',
      'assessment_complete',
      'not_preview_eligible',
      'generating_preview',
      'preview_ready_for_review',
      'preview_published',
      'finding_contact',
      'contact_unavailable',
      'drafting_outreach',
      'outreach_ready_for_review',
      'outreach_sent',
      'replied',
      'work_won',
      'archived',
      'failed'
    )
  ),
  source_data jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discovery_appearances (
  discovery_run_id uuid not null references discovery_runs(id) on delete cascade,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  rank integer not null,
  provider_payload jsonb not null,
  appeared_at timestamptz not null default now(),
  primary key (discovery_run_id, prospect_business_id)
);

create table if not exists workflow_failures (
  id uuid primary key,
  discovery_run_id uuid references discovery_runs(id) on delete cascade,
  prospect_business_id uuid references prospect_businesses(id) on delete cascade,
  failed_step text not null,
  error_summary text not null,
  retryable boolean not null default true,
  operator_visible_status text not null default 'visible',
  provider text not null,
  created_at timestamptz not null default now()
);

alter table workflow_failures
  add column if not exists prospect_business_id uuid references prospect_businesses(id) on delete cascade;

alter table workflow_failures
  add column if not exists created_at timestamptz not null default now();

create table if not exists workflow_states (
  id uuid primary key,
  workflow_key text not null unique,
  discovery_run_id uuid references discovery_runs(id) on delete cascade,
  prospect_business_id uuid references prospect_businesses(id) on delete cascade,
  current_step text not null,
  status text not null check (
    status in ('running', 'paused_for_review', 'failed', 'retrying', 'completed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  last_failure_id uuid references workflow_failures(id) on delete set null,
  state_data jsonb not null default '{}'::jsonb,
  prompt_versions jsonb not null default '{}'::jsonb,
  agent_output_summaries jsonb not null default '[]'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  paused_at timestamptz,
  resumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_states_by_discovery_run
  on workflow_states (discovery_run_id);

create index if not exists workflow_states_by_prospect
  on workflow_states (prospect_business_id);

create table if not exists business_context_sources (
  id text primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  research_mode text not null check (research_mode in ('expanded')),
  source_type text not null check (
    source_type in ('google_places', 'business_website', 'search_results', 'compliant_page_extraction')
  ),
  title text,
  url text,
  retrieved_at timestamptz not null default now(),
  terms_compliance jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists business_context_facts (
  id text primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  source_id text not null references business_context_sources(id) on delete cascade,
  label text not null,
  value text not null,
  source_quote text,
  allowed_for_generation boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists excluded_research_data (
  id text primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  source_id text references business_context_sources(id) on delete set null,
  label text not null,
  value_summary text not null,
  reason text not null check (
    reason in (
      'personal_contact',
      'staff_personal_profile',
      'home_address',
      'sensitive_inference',
      'login_gated',
      'paywalled',
      'access_restricted',
      'source_terms_disallowed'
    )
  ),
  excluded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists supported_claims (
  id text primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  statement text not null,
  evidence jsonb not null,
  allowed_for_generation boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists website_assessments (
  id uuid primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  current_website_url text,
  html_text text,
  deterministic_checks jsonb not null,
  desktop_screenshot jsonb,
  mobile_screenshot jsonb,
  opportunity_category text not null check (
    opportunity_category in (
      'no_website',
      'website_unreachable',
      'social_only',
      'outdated_or_low_quality',
      'modern_sufficient',
      'unknown'
    )
  ),
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  summary text not null,
  evidence jsonb not null,
  recommended_pitch_angle text not null check (
    recommended_pitch_angle in (
      'first_website',
      'modern_upgrade',
      'technical_fix',
      'social_to_owned_site',
      'no_outreach',
      'uncertain'
    )
  ),
  safe_claims jsonb not null,
  review_notes jsonb not null,
  preview_eligibility jsonb not null,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists website_assessments_latest_per_prospect
  on website_assessments (prospect_business_id);

create table if not exists contact_evidence (
  id uuid primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  email_address text not null,
  source_url text not null,
  source_type text not null check (
    source_type in ('business_website', 'google_places', 'official_profile', 'official_search_result')
  ),
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  role_classification text not null check (role_classification in ('role', 'personal', 'unknown')),
  outreach_approval_status text not null check (
    outreach_approval_status in ('pending_operator_approval', 'approved', 'blocked')
  ),
  reason text not null,
  found_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  approval_reason text,
  created_at timestamptz not null default now()
);

create index if not exists contact_evidence_by_prospect
  on contact_evidence (prospect_business_id, found_at asc);

create table if not exists preview_websites (
  id uuid primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  slug text not null unique,
  status text not null check (status in ('ready_for_review', 'published', 'failed')),
  design_plan jsonb not null,
  content_json jsonb not null,
  source_references jsonb not null,
  build_metadata jsonb not null,
  artifact jsonb not null,
  operator_editable_fields jsonb not null,
  publication jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists preview_websites_latest_per_prospect
  on preview_websites (prospect_business_id);

alter table preview_websites
  add column if not exists publication jsonb;

create table if not exists draft_outreach (
  id uuid primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  subject text not null,
  body_text text not null,
  body_html text not null,
  claims_used jsonb not null,
  compliance_notes jsonb not null,
  requires_operator_review boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists draft_outreach_latest_per_prospect
  on draft_outreach (prospect_business_id);

create table if not exists outreach_emails (
  id uuid primary key,
  prospect_business_id uuid not null references prospect_businesses(id) on delete cascade,
  draft_outreach_id uuid references draft_outreach(id) on delete set null,
  recipient_email_address text not null,
  provider text not null,
  provider_message_id text,
  send_status text not null check (send_status in ('sent', 'failed')),
  suppression_status text not null check (suppression_status in ('clear', 'suppressed', 'do_not_contact')),
  sent_at timestamptz,
  failure_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outreach_emails_by_prospect
  on outreach_emails (prospect_business_id, created_at asc);

create table if not exists outreach_suppressions (
  id uuid primary key,
  prospect_business_id uuid references prospect_businesses(id) on delete cascade,
  email_address text not null,
  suppression_status text not null check (suppression_status in ('suppressed', 'do_not_contact')),
  reason text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists outreach_suppressions_latest_per_email
  on outreach_suppressions (email_address);

create index if not exists outreach_suppressions_by_prospect
  on outreach_suppressions (prospect_business_id, created_at asc);
