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
  prospect_status text not null default 'discovered',
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
  failed_step text not null,
  error_summary text not null,
  retryable boolean not null default true,
  operator_visible_status text not null default 'visible',
  provider text not null,
  created_at timestamptz not null default now()
);
