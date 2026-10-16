-- On-demand audience estimates (spec 2026-10-13-audience-estimate-design). Expand-only.
-- An estimate describes a bounded sample of a creator's recent public commenters, never the follower audience, and stores
-- only aggregate counts: no commenter ids, names, texts or per-person classifications.

-- A separate credit action, so audience work has its own price and ledger lines.
alter table platform.credit_action_costs drop constraint credit_action_costs_action_check;
alter table platform.credit_action_costs add constraint credit_action_costs_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));
alter table wp.credit_reservations drop constraint credit_reservations_action_check;
alter table wp.credit_reservations add constraint credit_reservations_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));
alter table wp.credit_ledger drop constraint credit_ledger_action_check;
alter table wp.credit_ledger add constraint credit_ledger_action_check
  check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));
-- Provisional price (the YouTube source costs $0 in provider fees and ~30 of 10,000 daily quota units): the smallest
-- existing paid action. A business setting, editable in this table.
insert into platform.credit_action_costs (action, credits) values ('audience_estimate', 5);

-- One computed estimate per creator, platform and collection; shared by workspaces while it is unexpired.
create table gcp.audience_estimates (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id),
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  method_version text not null check (length(method_version) between 1 and 60),
  outcome text not null check (outcome in ('estimated', 'insufficient')),
  -- Aggregates only (see the contract's audienceEstimateSchema).
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  collected_at timestamptz not null,
  expires_at timestamptz not null,
  quota_units integer not null default 0 check (quota_units >= 0),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  check (expires_at > collected_at)
);
create index audience_estimates_creator_idx on gcp.audience_estimates (creator_id, platform, expires_at desc);

create table wp.audience_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id),
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  requested_by uuid not null references wp.users (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  outcome text check (outcome in ('estimated', 'insufficient')),
  estimate_id uuid references gcp.audience_estimates (id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  reservation_id uuid references wp.credit_reservations (id),
  cost integer not null check (cost >= 0),
  credits_charged integer not null default 0 check (credits_charged >= 0 and credits_charged <= cost),
  error_code text check (error_code is null or error_code ~ '^[A-Z_]{1,40}$'),
  error_message text check (error_message is null or length(error_message) <= 300),
  request_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or outcome is not null)
);
-- Repeated clicks and simultaneous requests share one open job (and one reservation).
create unique index audience_jobs_one_open on wp.audience_jobs (workspace_id, creator_id) where status in ('queued', 'running');
create index audience_jobs_creator_idx on wp.audience_jobs (workspace_id, creator_id, created_at desc);
create trigger audience_jobs_updated_at before update on wp.audience_jobs for each row execute function platform.set_updated_at();
alter table wp.audience_jobs enable row level security;
alter table wp.audience_jobs force row level security;
create policy audience_jobs_tenant on wp.audience_jobs
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

-- The sweeper's cross-workspace view of stuck audience jobs (worker only).
create or replace function platform.stuck_audience_jobs(p_minutes integer)
  returns table (id uuid, workspace_id uuid)
  language sql stable security definer set search_path = pg_catalog as $$
  select j.id, j.workspace_id from wp.audience_jobs j
  where j.status in ('queued', 'running') and j.created_at < now() - make_interval(mins => p_minutes)
  order by j.created_at
  limit 100
$$;
revoke all on function platform.stuck_audience_jobs(integer) from public;
grant execute on function platform.stuck_audience_jobs(integer) to mushin_worker;

grant select on gcp.audience_estimates to mushin_app;
grant select, insert, delete on gcp.audience_estimates to mushin_worker;
grant select, insert on wp.audience_jobs to mushin_app;
grant select, insert, update on wp.audience_jobs to mushin_worker;

-- Erasure also removes the creator's audience estimates and every workspace's audience jobs for it.
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.audience_jobs where creator_id = p_creator_id;
  delete from gcp.audience_estimates where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
  delete from wp.discovery_candidates where creator_id = p_creator_id or canonical_url = any (p_canonical_urls);
  update wp.discovery_jobs
     set input_url = null, handle = 'erased', canonical_url = 'erased:' || id::text
   where kind <> 'live' and (creator_id = p_creator_id or canonical_url = any (p_canonical_urls));
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid, text[]) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid, text[]) to mushin_worker;
