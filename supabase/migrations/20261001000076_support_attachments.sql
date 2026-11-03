-- Support ticket attachments (owner decision 2026-11-03, master directive Part 8 decision 2). Customers and staff attach
-- JPG/JPEG/PNG/WebP/PDF files of at most 5 MB. A row starts "pending"; the API downloads the uploaded object, checks
-- its real signature (magic bytes, never the extension or browser type) and runs the malware-scan hook, then marks it
-- "clean" (downloadable) or "rejected" (object deleted). Files live in the private bucket support-attachments and are
-- only handed out as short-lived signed download URLs. Kept while the ticket is open and 90 days after it is resolved
-- or closed, then purged by the worker unless a legal hold is set.
create table wp.support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references wp.support_tickets (id) on delete cascade,
  workspace_id uuid not null,
  uploaded_by_user_id uuid,
  uploaded_by_staff_id uuid,
  file_name text not null check (char_length(file_name) between 1 and 160),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer check (size_bytes is null or size_bytes between 1 and 5242880),
  storage_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'clean', 'rejected')),
  scan_detail text check (scan_detail is null or char_length(scan_detail) <= 300),
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  check ((uploaded_by_user_id is null) <> (uploaded_by_staff_id is null))
);
create index support_attachments_ticket_idx on wp.support_attachments (ticket_id, created_at);

alter table wp.support_attachments enable row level security;
create policy support_attachments_tenant on wp.support_attachments for all using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.support_attachments to mushin_app;
grant select, insert, update, delete on wp.support_attachments to mushin_worker;

-- The worker's retention job lists expired attachments across workspaces; rows are then deleted per workspace.
create function platform.support_attachments_expired(p_days integer, p_limit integer) returns table (id uuid, workspace_id uuid, storage_key text)
  language sql stable security definer set search_path = pg_catalog as $$
  select a.id, a.workspace_id, a.storage_key from wp.support_attachments a join wp.support_tickets t on t.id = a.ticket_id
  where not a.legal_hold and t.status in ('resolved', 'closed') and coalesce(t.resolved_at, t.updated_at) < now() - make_interval(days => p_days)
  order by a.created_at limit p_limit
$$;
revoke all on function platform.support_attachments_expired(integer, integer) from public;
grant execute on function platform.support_attachments_expired(integer, integer) to mushin_worker;

-- Files of deleted attachment rows (retention purge, ticket or team erase, account deletion: the rows go by cascade)
-- are queued here so the worker removes the stored object too; nothing is left orphaned in the bucket.
create table platform.storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  storage_key text not null,
  queued_at timestamptz not null default now()
);
alter table platform.storage_deletions enable row level security;
create function platform.queue_attachment_file_deletion() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into platform.storage_deletions (bucket, storage_key) values ('support-attachments', old.storage_key);
  return old;
end $$;
revoke all on function platform.queue_attachment_file_deletion() from public;
create trigger support_attachments_queue_file after delete on wp.support_attachments for each row execute function platform.queue_attachment_file_deletion();

create function platform.storage_deletions_pending(p_limit integer) returns table (id bigint, bucket text, storage_key text)
  language sql stable security definer set search_path = pg_catalog as $$
  select d.id, d.bucket, d.storage_key from platform.storage_deletions d order by d.id limit p_limit
$$;
create function platform.storage_deletions_done(p_ids bigint[]) returns integer
  language sql security definer set search_path = pg_catalog as $$
  with d as (delete from platform.storage_deletions where id = any (p_ids) returning 1) select count(*)::integer from d
$$;
revoke all on function platform.storage_deletions_pending(integer) from public;
revoke all on function platform.storage_deletions_done(bigint[]) from public;
grant execute on function platform.storage_deletions_pending(integer) to mushin_worker;
grant execute on function platform.storage_deletions_done(bigint[]) to mushin_worker;

-- Attachments are workspace data: erased with the workspace, before their tickets (erase_workspace regenerated from 0065).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
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
