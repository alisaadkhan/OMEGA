-- Workspace deletion (0035/0040) also erases trial feedback (0050): it is the workspace's own content, not a billing
-- record that is kept on purpose. Same function, same grants; only the table list grows.
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_tickets', 'support_access_requests', 'contact_reveals',
                           'audience_views', 'audience_jobs', 'discovery_candidates', 'discovery_results', 'discovery_jobs',
                           'discovery_estimates', 'catalog_search_charges', 'trial_feedback', 'workspace_invitations', 'workspace_members'] loop
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
