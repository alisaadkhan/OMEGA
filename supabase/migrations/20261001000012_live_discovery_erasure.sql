-- Sub-project 4B: live discovery runs (Brain 2) and creator erasure (spec §3).

-- Live runs reuse the job table: no single profile, a search and its size instead.
alter table wp.discovery_jobs drop constraint discovery_jobs_kind_check;
alter table wp.discovery_jobs add constraint discovery_jobs_kind_check check (kind in ('add_by_url', 'refresh', 'live'));
alter table wp.discovery_jobs drop constraint discovery_jobs_step_check;
alter table wp.discovery_jobs add constraint discovery_jobs_step_check
  check (step in ('searching', 'filtering', 'fetching', 'archiving', 'cleaning', 'assessing', 'saving'));
alter table wp.discovery_jobs alter column platform drop not null;
alter table wp.discovery_jobs alter column handle drop not null;
alter table wp.discovery_jobs alter column canonical_url drop not null;
alter table wp.discovery_jobs
  add column search jsonb,
  add column max_new integer check (max_new in (5, 10, 20)),
  add column search_hash text check (search_hash is null or search_hash ~ '^[0-9a-f]{64}$'),
  -- Prices the user confirmed, kept so a price change mid-run never changes what this run charges.
  add column prices jsonb,
  add column found_count integer not null default 0 check (found_count >= 0),
  add column new_count integer not null default 0 check (new_count >= 0),
  add column known_count integer not null default 0 check (known_count >= 0);
alter table wp.discovery_jobs add constraint discovery_jobs_shape check (
  (kind = 'live' and search is not null and max_new is not null and search_hash is not null and prices is not null)
  or (kind <> 'live' and platform is not null and handle is not null and canonical_url is not null)
);
create unique index discovery_jobs_one_open_live on wp.discovery_jobs (workspace_id, search_hash)
  where kind = 'live' and status in ('queued', 'running');

create table wp.discovery_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  job_id uuid not null references wp.discovery_jobs (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id),
  seq integer not null check (seq > 0),
  rank integer not null default 0 check (rank >= 0),
  fit_score smallint not null default 0 check (fit_score between 0 and 100),
  fit_label text not null default 'Needs review' check (fit_label in ('Best match', 'Strong match', 'Possible match', 'Needs review')),
  is_new boolean not null,
  credits integer not null default 0 check (credits >= 0),
  reason text check (reason is null or length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (job_id, creator_id),
  unique (job_id, seq)
);
create index discovery_results_creator_idx on wp.discovery_results (creator_id);
alter table wp.discovery_results enable row level security;
alter table wp.discovery_results force row level security;
create policy discovery_results_tenant on wp.discovery_results
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

-- Google results, shared by every workspace for 7 days (SRS §3.4).
create table platform.serper_cache (
  query_hash text primary key check (query_hash ~ '^[0-9a-f]{64}$'),
  query text not null check (length(query) <= 400),
  results jsonb not null,
  fetched_at timestamptz not null default now()
);
create index serper_cache_fetched_idx on platform.serper_cache (fetched_at);

-- Removal requests from creators (SRS §6.3). The requester's email is encrypted and kept only to confirm.
create table gcp.removal_requests (
  id uuid primary key default gen_random_uuid(),
  urls text[] not null check (cardinality(urls) between 1 and 3),
  creator_id uuid references gcp.creators (id),
  requester_email_encrypted text,
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'received' check (status in ('received', 'processed', 'rejected')),
  staff_note text check (staff_note is null or length(staff_note) <= 300),
  handled_by_staff_id uuid references staff.staff_users (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index removal_requests_status_idx on gcp.removal_requests (status, created_at);
create index removal_requests_creator_idx on gcp.removal_requests (creator_id);

-- Do not re-add: only hashes of canonical profile URLs, never the URL, name or handle.
create table gcp.creator_suppressions (
  url_hash text primary key check (url_hash ~ '^[0-9a-f]{64}$'),
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  removal_request_id uuid references gcp.removal_requests (id),
  created_at timestamptz not null default now()
);

-- Erasure reaches every workspace's rows for one creator; RLS hides them from the worker otherwise.
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid)
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid) to mushin_worker;

-- Grants.
grant select on wp.discovery_results to mushin_app;
grant select, insert, update on wp.discovery_results to mushin_worker;
grant select, insert, update, delete on platform.serper_cache to mushin_worker;
grant select, insert, update on gcp.removal_requests to mushin_worker;
grant select on gcp.creator_suppressions to mushin_app;
grant select, insert on gcp.creator_suppressions to mushin_worker;
-- "Remove revealed contacts" (spec D10): a workspace deletes its own reveal; RLS keeps it to that workspace.
grant delete on wp.contact_reveals to mushin_app;
-- Erasure clears the creator's own rows (the worker already owns gcp writes).
grant delete on gcp.creator_contacts, gcp.creator_links, gcp.creator_profiles, gcp.enrichment_snapshots, gcp.profile_metric_snapshots to mushin_worker;
grant delete on platform.raw_payloads to mushin_worker;
