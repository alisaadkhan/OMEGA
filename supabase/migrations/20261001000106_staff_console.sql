-- Staff console (owner, 25 Nov). Admins see every customer's full email and can find an account by part of an email
-- ("give credits by email, less complex"); Support keeps the masked list (platform.staff_workspaces). The API calls this
-- only for Admin and Super Admin staff.
create or replace function platform.staff_workspaces_full(p_query text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select w.id, w.name, w.created_at "createdAt", o.email "ownerEmail",
      (select count(*) from wp.workspace_members m where m.workspace_id = w.id) members,
      (select s.status from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1) "subscriptionStatus",
      (select count(*) from wp.discovery_jobs j where j.workspace_id = w.id and j.created_at > now() - interval '30 days') "jobs30d",
      (select count(*) from wp.support_tickets k where k.workspace_id = w.id and k.status in ('open', 'waiting_on_customer')) "openTickets"
    from wp.workspaces w join wp.users o on o.id = w.owner_user_id
    where p_query = '' or w.name ilike '%' || p_query || '%' or w.id::text = p_query
      or o.email ilike '%' || p_query || '%'
      or exists (select 1 from wp.workspace_members m join wp.users u on u.id = m.user_id where m.workspace_id = w.id and (u.email ilike '%' || p_query || '%' or u.id::text = p_query))
    order by w.created_at desc limit 100) t
$$;
revoke all on function platform.staff_workspaces_full(text) from public;
grant execute on function platform.staff_workspaces_full(text) to mushin_worker;

-- Stats page (owner, 25 Nov: "which creators were searched, opened, added to campaigns and lists and reached out to the
-- most; which niche, platform and follower tier were searched most"). Search filters are recorded from now on (null =
-- "any"); no search text is stored.
alter table wp.search_events
  add column if not exists niches text[],
  add column if not exists platform text,
  add column if not exists min_followers integer,
  add column if not exists max_followers integer;

create or replace function platform.staff_creator_stats(p_days integer, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  with since as (select now() - make_interval(days => greatest(least(p_days, 365), 1)) t),
  lim as (select least(greatest(p_limit, 1), 50) n),
  top(kind, creator_id, n) as (
    select 'opened', v.creator_id, count(*) from wp.creator_profile_views v, since where v.viewed_at >= since.t group by 2
    union all select 'listed', m.creator_id, count(*) from wp.list_members m, since where m.added_at >= since.t group by 2
    union all select 'campaigned', c.creator_id, count(*) from wp.campaign_creators c, since where c.added_at >= since.t group by 2
    union all select 'reached', x.creator_id, count(*) from (
      select e.creator_id from wp.outreach_events e, since where e.occurred_at >= since.t
      union all select o.creator_id from wp.outreach_emails o, since where o.created_at >= since.t) x group by 2
  ),
  ranked as (
    select t.kind, t.creator_id, t.n, row_number() over (partition by t.kind order by t.n desc, t.creator_id) r from top t
  ),
  creators as (
    select r.kind, jsonb_agg(jsonb_build_object('creatorId', c.id, 'name', c.display_name, 'handle', c.primary_handle, 'platform', c.primary_platform,
      'niche', c.niche_main, 'count', r.n) order by r.n desc) list
    from ranked r join gcp.creators c on c.id = r.creator_id, lim where r.r <= lim.n group by r.kind
  ),
  searches as (select s.* from wp.search_events s, since where s.created_at >= since.t)
  select jsonb_build_object(
    'days', greatest(least(p_days, 365), 1),
    'totals', jsonb_build_object(
      'searches', (select count(*) from searches),
      'opened', (select coalesce(sum(n), 0) from top where kind = 'opened'),
      'listed', (select coalesce(sum(n), 0) from top where kind = 'listed'),
      'campaigned', (select coalesce(sum(n), 0) from top where kind = 'campaigned'),
      'reached', (select coalesce(sum(n), 0) from top where kind = 'reached')),
    'mostOpened', coalesce((select list from creators where kind = 'opened'), '[]'::jsonb),
    'mostListed', coalesce((select list from creators where kind = 'listed'), '[]'::jsonb),
    'mostCampaigned', coalesce((select list from creators where kind = 'campaigned'), '[]'::jsonb),
    'mostReached', coalesce((select list from creators where kind = 'reached'), '[]'::jsonb),
    'byNiche', coalesce((select jsonb_agg(jsonb_build_object('label', x.niche, 'count', x.n) order by x.n desc) from (
      select coalesce(u.niche, 'Any niche') niche, count(*) n from searches s left join lateral unnest(s.niches) u(niche) on true group by 1) x), '[]'::jsonb),
    'byPlatform', coalesce((select jsonb_agg(jsonb_build_object('label', x.p, 'count', x.n) order by x.n desc) from (
      select coalesce(s.platform, 'any') p, count(*) n from searches s group by 1) x), '[]'::jsonb),
    'byTier', coalesce((select jsonb_agg(jsonb_build_object('label', x.tier, 'count', x.n) order by x.n desc) from (
      select case when s.min_followers is null and s.max_followers is null then 'Any size'
        when coalesce(s.min_followers, 0) >= 1000000 then '1M+'
        when coalesce(s.min_followers, 0) >= 100000 then '100k–1M'
        when coalesce(s.max_followers, 2147483647) <= 100000 then '10k–100k'
        else 'Mixed range' end tier, count(*) n from searches s group by 1) x), '[]'::jsonb)
  )
$$;
revoke all on function platform.staff_creator_stats(integer, integer) from public;
grant execute on function platform.staff_creator_stats(integer, integer) to mushin_worker;
