-- Export permissions (owner decision 2026-11-03, master directive Part 8 decision 3). The team owner and admins may
-- export every list or every campaign; any other member may export only a list or campaign they created. Both are
-- checked by the API on creation and again on download. Every download is recorded (who and when) next to the export
-- row, which already records who asked for it. Revealed contact values are still never exported.
alter table wp.data_exports add column scope_id uuid;
alter table wp.data_exports add column scope_name text check (scope_name is null or char_length(scope_name) <= 200);

create table wp.data_export_downloads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  export_id uuid not null references wp.data_exports (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  downloaded_at timestamptz not null default now()
);
create index data_export_downloads_export_idx on wp.data_export_downloads (export_id, downloaded_at);
alter table wp.data_export_downloads enable row level security;
alter table wp.data_export_downloads force row level security;
create policy data_export_downloads_tenant on wp.data_export_downloads
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.data_export_downloads to mushin_app;

-- Download records are workspace data: erased with the workspace (erase_workspace regenerated from 0076).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_export_downloads', 'data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_attachments', 'support_tickets', 'support_access_requests', 'contact_reveals',
                           'support_ticket_events', 'product_reviews', 'creator_profile_views', 'search_events', 'audience_views', 'audience_jobs', 'discovery_candidates', 'discovery_results', 'discovery_jobs',
                           'discovery_estimates', 'catalog_search_charges', 'trial_feedback', 'workspace_contacts', 'creator_import_rows',
                           'creator_imports', 'workspace_invitations', 'workspace_members'] loop
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
