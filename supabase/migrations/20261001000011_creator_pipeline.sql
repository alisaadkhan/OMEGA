-- Sub-project 4A: creator data pipeline (spec 2026-10-09). Expand-only.

-- TikTok adds/refreshes have their own price (spec D4): replace the three action CHECK constraints.
alter table platform.credit_action_costs drop constraint credit_action_costs_action_check;
alter table platform.credit_action_costs add constraint credit_action_costs_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok'));
alter table wp.credit_reservations drop constraint credit_reservations_action_check;
alter table wp.credit_reservations add constraint credit_reservations_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok'));
alter table wp.credit_ledger drop constraint credit_ledger_action_check;
alter table wp.credit_ledger add constraint credit_ledger_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok'));
insert into platform.credit_action_costs (action, credits) values ('refresh_tiktok', 30);

-- Creator columns written by the pipeline.
alter table gcp.creators
  add column minor_reason text check (minor_reason is null or length(minor_reason) <= 300),
  add column minor_flagged_at timestamptz,
  add column assessment_status text check (assessment_status in ('assessed', 'pending', 'insufficient_data')),
  add column avatar_key text check (avatar_key is null or length(avatar_key) <= 300);

-- Metric history: the growth signal needs earlier values (spec §3.2). Append-only.
create table gcp.profile_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references gcp.creator_profiles (id) on delete cascade,
  followers integer not null check (followers >= 0),
  following integer check (following >= 0),
  posts integer check (posts >= 0),
  engagement_rate double precision check (engagement_rate between 0 and 100),
  avg_likes integer check (avg_likes >= 0),
  avg_comments integer check (avg_comments >= 0),
  avg_views integer check (avg_views >= 0),
  raw_payload_id uuid,
  captured_at timestamptz not null default now()
);
create index profile_metric_snapshots_profile_idx on gcp.profile_metric_snapshots (profile_id, captured_at desc);

-- Accounts the creator links from their own profile (spec D6). Recorded, never merged.
create table gcp.creator_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube', 'website')),
  url text not null check (length(url) <= 300),
  source text not null check (source in ('bio', 'profile_link')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (creator_id, url)
);

-- Index of archived raw responses (files live in Supabase Storage, bucket raw-payloads).
create table platform.raw_payloads (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apify', 'youtube')),
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  canonical_url text not null,
  creator_id uuid references gcp.creators (id) on delete set null,
  job_id uuid,
  storage_key text not null unique,
  bytes integer not null check (bytes >= 0),
  sha256 text not null,
  fetched_at timestamptz not null default now(),
  delete_after timestamptz not null
);
create index raw_payloads_job_idx on platform.raw_payloads (job_id);
create index raw_payloads_creator_idx on platform.raw_payloads (creator_id, fetched_at desc);
create index raw_payloads_purge_idx on platform.raw_payloads (delete_after);

create table platform.enrichment_settings (
  id boolean primary key default true check (id),
  raw_retention_days integer not null check (raw_retention_days between 1 and 3650),
  refresh_min_age_hours integer not null check (refresh_min_age_hours between 0 and 720),
  reuse_window_minutes integer not null check (reuse_window_minutes between 0 and 1440),
  recent_posts integer not null check (recent_posts between 3 and 50),
  tiktok_recent_videos integer not null check (tiktok_recent_videos between 3 and 50),
  min_posts_for_score integer not null check (min_posts_for_score between 1 and 50),
  growth_min_days integer not null check (growth_min_days between 1 and 365),
  score_band integer not null check (score_band between 0 and 25),
  stuck_job_minutes integer not null check (stuck_job_minutes between 5 and 1440),
  engagement_benchmarks jsonb not null,
  model_version text not null,
  updated_at timestamptz not null default now()
);
insert into platform.enrichment_settings
  (raw_retention_days, refresh_min_age_hours, reuse_window_minutes, recent_posts, tiktok_recent_videos, min_posts_for_score,
   growth_min_days, score_band, stuck_job_minutes, engagement_benchmarks, model_version)
values (365, 24, 10, 12, 6, 3, 14, 5, 30,
  '{"instagram": {"per": "followers", "viewsLow": 0.2, "tiers": [[0, 3, 8], [10000, 1.5, 5], [100000, 1, 3.5], [1000000, 0.7, 2.5]]},
    "tiktok":    {"per": "views",     "viewsLow": 0.1, "tiers": [[0, 4, 12], [10000, 4, 12], [100000, 3, 10], [1000000, 3, 9]]},
    "youtube":   {"per": "views",     "viewsLow": 0.03, "tiers": [[0, 2, 6], [10000, 2, 6], [100000, 1.5, 5], [1000000, 1, 4]]}}'::jsonb,
  'assessment-v1');
create trigger enrichment_settings_updated_at before update on platform.enrichment_settings for each row execute function platform.set_updated_at();

-- Jobs (umbrella spec §5.5). 4B adds kind 'live'.
create table wp.discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  kind text not null check (kind in ('add_by_url', 'refresh')),
  requested_by uuid not null references wp.users (id),
  input_url text check (input_url is null or length(input_url) <= 500),
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null check (length(handle) between 1 and 101),
  canonical_url text not null check (length(canonical_url) <= 500),
  creator_id uuid references gcp.creators (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  step text check (step in ('fetching', 'archiving', 'cleaning', 'assessing', 'saving')),
  attempts integer not null default 0 check (attempts >= 0),
  reservation_id uuid references wp.credit_reservations (id),
  -- The reserved price; recorded as credits_charged when the job commits.
  cost integer not null check (cost >= 0),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  outcome text check (outcome in ('created', 'refreshed', 'reused')),
  error_code text,
  error_message text check (error_message is null or length(error_message) <= 300),
  request_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index discovery_jobs_one_open on wp.discovery_jobs (workspace_id, canonical_url) where status in ('queued', 'running');
create index discovery_jobs_recent_idx on wp.discovery_jobs (workspace_id, created_at desc);
create trigger discovery_jobs_updated_at before update on wp.discovery_jobs for each row execute function platform.set_updated_at();

alter table wp.discovery_jobs enable row level security;
alter table wp.discovery_jobs force row level security;
create policy discovery_jobs_tenant on wp.discovery_jobs
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

-- The sweeper's cross-workspace view of stuck jobs (worker only; RLS hides other workspaces otherwise).
create or replace function platform.stuck_discovery_jobs(p_minutes integer)
  returns table (id uuid, workspace_id uuid, reservation_id uuid)
  language sql stable security definer set search_path = pg_catalog as $$
  select j.id, j.workspace_id, j.reservation_id from wp.discovery_jobs j
  where j.status in ('queued', 'running') and j.created_at < now() - make_interval(mins => p_minutes)
  order by j.created_at
  limit 100
$$;
revoke all on function platform.stuck_discovery_jobs(integer) from public;
grant execute on function platform.stuck_discovery_jobs(integer) to mushin_worker;

-- Grants.
grant select, insert on wp.discovery_jobs to mushin_app;
grant select, insert, update on wp.discovery_jobs to mushin_worker;
grant select on gcp.creator_links, platform.enrichment_settings to mushin_app;
grant select, insert, update on gcp.creator_links to mushin_worker;
grant select, insert on gcp.profile_metric_snapshots to mushin_worker;
grant select, insert, update, delete on platform.raw_payloads to mushin_worker;
grant select on platform.enrichment_settings to mushin_worker;
grant select on platform.provider_calls to mushin_worker;
