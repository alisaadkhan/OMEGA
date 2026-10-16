-- Data export (Scale plan, owner decision 2026-10-16): a CSV of the workspace's lists or campaigns, generated on
-- request within a row bound, downloadable by the workspace's owner or admins for 24 hours, then deleted. The row is
-- the audit record (who, what, when, how many rows, downloads). Revealed contact values are never exported.
-- The customer's privacy export (Settings › Privacy, all plans) is a separate data-protection right and is unchanged.

create table wp.data_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  requested_by uuid not null references wp.users (id),
  kind text not null check (kind in ('lists', 'campaigns')),
  row_count integer not null check (row_count >= 0),
  content text,
  byte_size integer not null check (byte_size >= 0),
  downloads integer not null default 0 check (downloads >= 0),
  expires_at timestamptz not null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  check ((content is null) = (purged_at is not null))
);
create index data_exports_workspace_idx on wp.data_exports (workspace_id, created_at desc);
create index data_exports_expiry_idx on wp.data_exports (expires_at) where purged_at is null;
alter table wp.data_exports enable row level security;
alter table wp.data_exports force row level security;
create policy data_exports_tenant on wp.data_exports
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.data_exports to mushin_app;
grant update (downloads, content, purged_at) on wp.data_exports to mushin_app;

-- Expired export files are removed (content dropped, the audit row kept); run by the worker's maintenance tick.
create function platform.purge_expired_exports() returns integer
  language sql security definer set search_path = pg_catalog as $$
  with gone as (
    update wp.data_exports set content = null, purged_at = now() where purged_at is null and expires_at <= now() returning 1
  ) select count(*)::int from gone
$$;
revoke all on function platform.purge_expired_exports() from public;
grant execute on function platform.purge_expired_exports() to mushin_worker;

-- Workspace deletion also erases outreach emails and exports (0039, 0040). Billing records, including refund and
-- chargeback adjustments, and the staff audit log are kept as before (0035).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_tickets', 'support_access_requests', 'contact_reveals',
                           'audience_views', 'audience_jobs', 'discovery_candidates', 'discovery_results', 'discovery_jobs',
                           'discovery_estimates', 'catalog_search_charges', 'workspace_invitations', 'workspace_members'] loop
    execute format('delete from wp.%I where workspace_id = $1', t) using p_workspace;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  delete from platform.idempotency_keys where workspace_id = p_workspace;
  delete from platform.outbox where workspace_id = p_workspace and published_at is null;
  update wp.workspaces set status = 'deleted', deleted_at = now(), name = 'Deleted workspace' where id = p_workspace;
  return counts;
end
$$;
