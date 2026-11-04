-- Unread replies on support requests (master completion directive §6.1). Each team member's last look at a request is
-- recorded when they open it; a request shows as unread for them while a MUSHIN support reply is newer than that.
-- Per person, so one teammate reading a reply does not hide it from the others.
create table wp.support_ticket_reads (
  ticket_id uuid not null references wp.support_tickets (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
alter table wp.support_ticket_reads enable row level security;
alter table wp.support_ticket_reads force row level security;
create policy support_ticket_reads_tenant on wp.support_ticket_reads
  using (workspace_id = platform.current_workspace_id() and user_id = platform.current_user_id())
  with check (workspace_id = platform.current_workspace_id() and user_id = platform.current_user_id());
grant select, insert, update on wp.support_ticket_reads to mushin_app;

-- Read markers are workspace data: erased with the workspace (erase_workspace regenerated from 0077).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_export_downloads', 'data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_attachments', 'support_ticket_reads', 'support_tickets', 'support_access_requests', 'contact_reveals',
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
