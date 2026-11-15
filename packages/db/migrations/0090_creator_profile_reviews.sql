-- Creator profile reviews (owner directive 2026-11-15, "authentication flows" §3): on any creator card or profile, in
-- database search or Live Discovery, a customer can confirm a creator ("valid") or flag a problem ("invalid", with a
-- reason). Flags wait in the staff Catalogue review until staff resolve (fix or exclude the creator) or dismiss them.
-- Confirmations are recorded already resolved (nothing to do), so staff see how many people confirmed a creator.
--
-- Customers use the table through the tenant policy (their own workspace, written as themselves). Staff never read
-- tenant tables directly: the security-definer functions below, executable by the API's system role only (as 0026).
create table wp.creator_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  submitted_by uuid not null references wp.users (id),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  platform text check (platform is null or platform in ('instagram', 'tiktok', 'youtube')),
  source_mode text not null check (source_mode in ('db_search', 'live_discovery')),
  verdict text not null check (verdict in ('valid', 'invalid')),
  reason text check (reason is null or reason in ('not_individual_creator', 'wrong_location', 'wrong_niche', 'broken_profile', 'other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolved_by_staff_id uuid references staff.staff_users (id),
  resolved_at timestamptz,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A flag names what is wrong; a confirmation does not.
  constraint creator_profile_reviews_reason check ((verdict = 'invalid') = (reason is not null)),
  constraint creator_profile_reviews_resolution check ((status = 'pending') = (resolved_at is null))
);
-- One open flag per person and creator: a second submission updates it.
create unique index creator_profile_reviews_open_idx on wp.creator_profile_reviews (workspace_id, submitted_by, creator_id) where status = 'pending';
create index creator_profile_reviews_queue_idx on wp.creator_profile_reviews (status, created_at desc);
create index creator_profile_reviews_creator_idx on wp.creator_profile_reviews (creator_id);
create index creator_profile_reviews_submitter_idx on wp.creator_profile_reviews (submitted_by);

alter table wp.creator_profile_reviews enable row level security;
alter table wp.creator_profile_reviews force row level security;
create policy creator_profile_reviews_tenant on wp.creator_profile_reviews
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id() and submitted_by = platform.current_user_id());
grant select, insert on wp.creator_profile_reviews to mushin_app;
grant update (platform, source_mode, verdict, reason, note, status, resolved_at, updated_at) on wp.creator_profile_reviews to mushin_app;

-- ── Staff (security definer; execute granted to the API's system role only) ──────────────────────────────────────

-- The review queue: one page of reviews in a status, with the creator they concern and how many open flags and
-- confirmations that creator has in total. No submitter identity is exposed.
create function platform.staff_creator_reviews(p_status text, p_limit integer, p_offset integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(row_to_json(t) order by t."createdAt" desc) from (
      select r.id, r.creator_id "creatorId", c.display_name "displayName", c.primary_platform "primaryPlatform",
        p.handle, p.canonical_url "url", c.account_type "accountType", c.account_type_source "accountTypeSource", c.status "creatorStatus",
        r.verdict, r.reason, r.note, r.platform, r.source_mode "sourceMode", r.status, r.created_at "createdAt",
        r.resolved_at "resolvedAt", r.resolution,
        (select count(*)::int from wp.creator_profile_reviews x where x.creator_id = r.creator_id and x.verdict = 'invalid' and x.status = 'pending') "openFlags",
        (select count(*)::int from wp.creator_profile_reviews x where x.creator_id = r.creator_id and x.verdict = 'valid') "confirmations"
      from wp.creator_profile_reviews r
      join gcp.creators c on c.id = r.creator_id
      left join lateral (select pp.handle, pp.canonical_url from gcp.creator_profiles pp where pp.creator_id = c.id
        order by (pp.platform = c.primary_platform) desc, pp.followers desc nulls last limit 1) p on true
      where r.verdict = 'invalid' and r.status = p_status
      order by r.created_at desc
      limit greatest(1, least(p_limit, 200)) offset greatest(p_offset, 0)
    ) t), '[]'::jsonb),
    'total', (select count(*)::int from wp.creator_profile_reviews where verdict = 'invalid' and status = p_status),
    'counts', jsonb_build_object(
      'pending', (select count(*)::int from wp.creator_profile_reviews where verdict = 'invalid' and status = 'pending'),
      'resolved', (select count(*)::int from wp.creator_profile_reviews where verdict = 'invalid' and status = 'resolved'),
      'dismissed', (select count(*)::int from wp.creator_profile_reviews where verdict = 'invalid' and status = 'dismissed'))
  )
$$;

-- Closes one open flag (resolved or dismissed), with who and why; returns its creator, or null when it was not open.
create function platform.staff_close_creator_review(p_id uuid, p_staff_id uuid, p_status text, p_resolution text) returns uuid
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_creator uuid;
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'invalid review status %', p_status using errcode = '22023';
  end if;
  update wp.creator_profile_reviews
     set status = p_status, resolved_by_staff_id = p_staff_id, resolved_at = now(), resolution = left(p_resolution, 500), updated_at = now()
   where id = p_id and status = 'pending' and verdict = 'invalid'
  returning creator_id into v_creator;
  return v_creator;
end
$$;

revoke all on function platform.staff_creator_reviews(text, integer, integer) from public;
revoke all on function platform.staff_close_creator_review(uuid, uuid, text, text) from public;
grant execute on function platform.staff_creator_reviews(text, integer, integer) to mushin_worker;
grant execute on function platform.staff_close_creator_review(uuid, uuid, text, text) to mushin_worker;

-- Reviews are workspace data: erased with the workspace (erase_workspace regenerated from 0080).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_export_downloads', 'data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_attachments', 'support_ticket_reads', 'support_tickets', 'support_access_requests', 'contact_reveals',
                           'support_ticket_events', 'product_reviews', 'creator_profile_reviews', 'creator_profile_views', 'search_events', 'audience_views', 'audience_jobs', 'discovery_candidates', 'discovery_results', 'discovery_jobs',
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
