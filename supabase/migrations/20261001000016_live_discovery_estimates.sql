create table wp.discovery_estimates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  requested_by uuid not null references wp.users (id),
  search jsonb not null,
  max_new integer not null check (max_new in (5, 10, 20)),
  search_hash text not null check (search_hash ~ '^[0-9a-f]{64}$'),
  prices jsonb not null,
  max_credits integer not null check (max_credits > 0),
  price_version text not null check (length(price_version) between 1 and 80),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  job_id uuid references wp.discovery_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index discovery_estimates_workspace_idx on wp.discovery_estimates (workspace_id, created_at desc);
create index discovery_estimates_expiry_idx on wp.discovery_estimates (expires_at) where consumed_at is null;
alter table wp.discovery_estimates enable row level security;
alter table wp.discovery_estimates force row level security;
create policy discovery_estimates_tenant on wp.discovery_estimates
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());
grant select, insert, update on wp.discovery_estimates to mushin_app;
