-- Product reviews and usage events (research-informed plan, Phase 12; owner backlog 2026-10-29).
--   product_reviews        "Leave a review" from the customer app: rating and an optional comment, the workspace and
--                          the person (minimal reference, never shown to staff), no email is sent. Staff Admin and Super
--                          Admin read and mark them through the functions below.
--   creator_profile_views  one row per creator profile opened by a customer; repeated opens by the same person within
--                          30 minutes count once (the API checks before inserting). Staff never see who viewed.
--   search_events          one row per new catalogue search (first page only: paging and sorting are the same search):
--                          result count, whether it was charged, the backend. No query text is stored.
-- All three are workspace data: erased with the workspace (erase_workspace below, regenerated from 0059).

create table wp.product_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 2000),
  page text check (page is null or page ~ '^[a-z0-9_-]{1,40}$'),
  status text not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  status_changed_by uuid references staff.staff_users (id),
  status_changed_at timestamptz,
  created_at timestamptz not null default now()
);
create index product_reviews_created_idx on wp.product_reviews (created_at desc);
create index product_reviews_user_idx on wp.product_reviews (user_id, created_at desc);
create index product_reviews_workspace_idx on wp.product_reviews (workspace_id);
alter table wp.product_reviews enable row level security;
alter table wp.product_reviews force row level security;
create policy product_reviews_tenant on wp.product_reviews
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.product_reviews to mushin_app;

create table wp.creator_profile_views (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  viewed_at timestamptz not null default now()
);
create index creator_profile_views_at_idx on wp.creator_profile_views (viewed_at);
create index creator_profile_views_dedupe_idx on wp.creator_profile_views (user_id, creator_id, viewed_at desc);
-- Foreign keys: erasure deletes by workspace; erasing a creator cascades by creator.
create index creator_profile_views_workspace_idx on wp.creator_profile_views (workspace_id);
create index creator_profile_views_creator_idx on wp.creator_profile_views (creator_id, viewed_at);
alter table wp.creator_profile_views enable row level security;
alter table wp.creator_profile_views force row level security;
create policy creator_profile_views_tenant on wp.creator_profile_views
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.creator_profile_views to mushin_app;

create table wp.search_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  backend text not null check (backend in ('postgres', 'meilisearch')),
  results integer not null check (results >= 0),
  complete boolean not null,
  charged boolean not null,
  has_text boolean not null,
  filter_count smallint not null check (filter_count >= 0),
  created_at timestamptz not null default now()
);
create index search_events_at_idx on wp.search_events (created_at);
create index search_events_workspace_idx on wp.search_events (workspace_id);
create index search_events_user_idx on wp.search_events (user_id);
alter table wp.search_events enable row level security;
alter table wp.search_events force row level security;
create policy search_events_tenant on wp.search_events
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant insert on wp.search_events to mushin_app;

-- Staff: reviews newest first, with the workspace name only (no person, no email).
create function platform.staff_product_reviews(p_status text, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."createdAt" desc), '[]'::jsonb) from (
    select r.id, w.name "workspaceName", r.rating, r.comment, r.page, r.status, r.created_at "createdAt",
      r.status_changed_at "statusChangedAt", (select s.name from staff.staff_users s where s.id = r.status_changed_by) "statusChangedBy"
    from wp.product_reviews r join wp.workspaces w on w.id = r.workspace_id
    where p_status is null or r.status = p_status
    order by r.created_at desc limit least(greatest(p_limit, 1), 500)) t
$$;
create function platform.staff_product_review_status(p_id uuid, p_staff_id uuid, p_status text) returns boolean
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  update wp.product_reviews set status = p_status, status_changed_by = p_staff_id, status_changed_at = now() where id = p_id;
  return found;
end
$$;

-- Staff: creator-profile views over the last p_days days. "views" counts opens (deduplicated per person and creator
-- within 30 minutes at insert); "uniqueViewers" counts distinct people. Least viewed lists eligible creators with the
-- fewest views in the window, never-viewed ones included (0 views), so it says nothing about creators customers cannot see.
create function platform.staff_creator_view_stats(p_days integer, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  with win as (select now() - make_interval(days => greatest(least(p_days, 365), 1)) since),
  v as (select x.* from wp.creator_profile_views x, win where x.viewed_at >= win.since),
  per as (select creator_id, platform, count(*) views, count(distinct user_id) viewers from v group by 1, 2),
  lim as (select least(greatest(p_limit, 1), 100) n)
  select jsonb_build_object(
    'days', greatest(least(p_days, 365), 1),
    'trackedSince', (select min(viewed_at) from wp.creator_profile_views),
    'byPlatform', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'views', views, 'uniqueViewers', viewers, 'creatorsViewed', creators) order by platform)
       from (select platform, count(*) views, count(distinct user_id) viewers, count(distinct creator_id) creators from v group by 1) b), '[]'::jsonb),
    'mostViewed', coalesce((select jsonb_agg(row_to_json(m)::jsonb) from (
       select p.creator_id "creatorId", c.display_name "displayName", p.platform, p.views, p.viewers "uniqueViewers"
       from per p join gcp.creators c on c.id = p.creator_id order by p.views desc, p.viewers desc, c.display_name limit (select n from lim)) m), '[]'::jsonb),
    'leastViewed', coalesce((select jsonb_agg(row_to_json(l)::jsonb) from (
       select d.creator_id "creatorId", c.display_name "displayName", c.primary_platform platform,
         coalesce((select sum(p.views) from per p where p.creator_id = d.creator_id), 0)::int views
       from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id
       where d.eligible order by 4, c.display_name limit (select n from lim)) l), '[]'::jsonb)
  )
$$;

-- Staff: catalogue search usage over the last p_days days, per day and backend. A zero-result search is one that
-- completed with no eligible creator (free since 2026-10-28).
create function platform.staff_search_stats(p_days integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  with win as (select now() - make_interval(days => greatest(least(p_days, 365), 1)) since),
  s as (select e.* from wp.search_events e, win where e.created_at >= win.since)
  select jsonb_build_object(
    'days', greatest(least(p_days, 365), 1),
    'trackedSince', (select min(created_at) from wp.search_events),
    'searches', (select count(*) from s),
    'zeroResult', (select count(*) from s where results = 0),
    'zeroResultRate', (select case when count(*) = 0 then null else round(count(*) filter (where results = 0)::numeric / count(*), 3) end from s),
    'charged', (select count(*) from s where charged),
    'byBackend', coalesce((select jsonb_object_agg(backend, n) from (select backend, count(*) n from s group by 1) b), '{}'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'searches', n, 'zeroResult', z) order by d)
       from (select (created_at at time zone 'Asia/Karachi')::date d, count(*) n, count(*) filter (where results = 0) z from s group by 1) x), '[]'::jsonb)
  )
$$;

do $$
declare f text;
begin
  foreach f in array array['staff_product_reviews(text, integer)', 'staff_product_review_status(uuid, uuid, text)',
                           'staff_creator_view_stats(integer, integer)', 'staff_search_stats(integer)'] loop
    execute format('revoke all on function platform.%s from public', f);
    execute format('grant execute on function platform.%s to mushin_worker', f);
  end loop;
end $$;

-- Workspace deletion erases the new workspace tables too (team.int guard).
create or replace function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['data_exports', 'outreach_emails', 'outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists',
                           'saved_searches', 'support_messages', 'support_tickets', 'support_access_requests', 'contact_reveals',
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
