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

-- Reported profiles (owner, 25 Nov: "too many reports -> hide it from customers immediately and send it to review").
-- Once 3 different subscribed accounts have an open report on a creator, the creator is hidden (the same status staff "Hide" uses)
-- with an "auto" reason, and stays in the Reported profiles queue. Dismissing every report brings it back (API side).
-- When staff last reviewed this creator's reports (unhide or dismiss): only reports filed after it count again, so a
-- staff decision is never undone by the same old reports.
alter table gcp.creators add column if not exists reports_reviewed_at timestamptz;

create or replace function platform.auto_hide_reported_creator() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if new.status <> 'pending' or new.verdict <> 'invalid' then return new; end if;
  select count(distinct r.workspace_id) into n from wp.creator_profile_reviews r
    join gcp.creators c on c.id = r.creator_id
    where r.creator_id = new.creator_id and r.status = 'pending' and r.verdict = 'invalid'
      and r.created_at > coalesce(c.reports_reviewed_at, '-infinity'::timestamptz)
      -- Only accounts on an active or approved-trial plan count: free sign-ups are cheap to make in bulk, so they can
      -- report (staff still see it) but cannot take a creator down (security review, 25 Nov).
      and exists (select 1 from wp.subscriptions s where s.workspace_id = r.workspace_id and s.status in ('active', 'trialing'));
  if n >= 3 then
    update gcp.creators set status = 'hidden', hidden_by_staff_id = null, hidden_at = now(), updated_at = now(),
      hidden_reason = 'Hidden automatically: reports from ' || n || ' accounts; waiting for staff review'
      where id = new.creator_id and status = 'active';
  end if;
  return new;
end $$;
revoke all on function platform.auto_hide_reported_creator() from public;
drop trigger if exists creator_profile_reviews_auto_hide on wp.creator_profile_reviews;
create trigger creator_profile_reviews_auto_hide after insert or update of status, verdict on wp.creator_profile_reviews
  for each row execute function platform.auto_hide_reported_creator();

-- Dismissing the last open report on an auto-hidden creator brings it back (staff-hidden creators are left alone).
create or replace function platform.staff_restore_auto_hidden(p_creator uuid) returns boolean
  language sql volatile security definer set search_path = pg_catalog as $$
  with back as (
    update gcp.creators c set status = 'active', hidden_reason = null, hidden_at = null, reports_reviewed_at = now(), updated_at = now()
    where c.id = p_creator and c.status = 'hidden' and c.hidden_by_staff_id is null and c.hidden_reason like 'Hidden automatically:%'
      and not exists (select 1 from wp.creator_profile_reviews r where r.creator_id = c.id and r.status = 'pending' and r.verdict = 'invalid')
    returning c.id)
  select exists (select 1 from back)
$$;
revoke all on function platform.staff_restore_auto_hidden(uuid) from public;
grant execute on function platform.staff_restore_auto_hidden(uuid) to mushin_worker;

-- Staff notifications (owner, 25 Nov: "notify us, and email us, on a new user, subscription, trial form, ticket, profile
-- report (even one) and creators that need review"). The database makes them where each event happens, so no code path
-- can forget one. "audience" says who sees it: 'admin' = Admin and CEO, 'all' = Support too (tickets).
create table if not exists staff.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_user', 'subscription', 'trial_request', 'ticket', 'profile_report', 'creator_review')),
  audience text not null default 'admin' check (audience in ('admin', 'all')),
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 1000),
  link text check (link is null or link ~ '^#[a-z]+(\?[A-Za-z0-9=&%._@-]*)?$'),
  source_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists staff_notifications_created_idx on staff.notifications (created_at desc);
create table if not exists staff.notification_reads (
  staff_id uuid not null references staff.staff_users (id) on delete cascade,
  notification_id uuid not null references staff.notifications (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (staff_id, notification_id)
);
create table if not exists staff.notification_emails (
  notification_id uuid not null references staff.notifications (id) on delete cascade,
  staff_id uuid not null references staff.staff_users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (notification_id, staff_id)
);
create index if not exists staff_notification_emails_pending_idx on staff.notification_emails (status) where status in ('pending', 'sending');
alter table staff.staff_users add column if not exists notify_email boolean not null default true;
grant select, insert, update on staff.notifications, staff.notification_reads, staff.notification_emails to mushin_worker;

create or replace function platform.staff_notify(p_kind text, p_audience text, p_title text, p_body text, p_link text, p_key text) returns void
  language plpgsql security definer set search_path = pg_catalog as $$
declare n uuid;
begin
  insert into staff.notifications (kind, audience, title, body, link, source_key)
    values (p_kind, p_audience, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_link, p_key)
    on conflict (source_key) do nothing returning id into n;
  if n is null then return; end if;
  insert into staff.notification_emails (notification_id, staff_id)
    select n, s.id from staff.staff_users s
    where s.status = 'active' and s.notify_email and (p_audience = 'all' or s.role in ('admin', 'super_admin'));
end $$;
revoke all on function platform.staff_notify(text, text, text, text, text, text) from public;

create or replace function platform.staff_notify_event() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare who text; cname text;
begin
  if tg_table_name = 'users' then
    perform platform.staff_notify('new_user', 'admin', 'New user signed up', new.email, '#users', 'user:' || new.id);
  elsif tg_table_name = 'subscriptions' then
    if new.status in ('active', 'trialing') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      select w.name into who from wp.workspaces w where w.id = new.workspace_id;
      perform platform.staff_notify('subscription', 'admin',
        case when new.status = 'trialing' then 'Trial started' else 'New subscription' end,
        coalesce(who, 'An account') || coalesce(' · ' || new.plan_id::text, ''), '#subscriptions',
        'sub:' || new.workspace_id || ':' || new.status || ':' || extract(epoch from now())::bigint);
    end if;
  elsif tg_table_name = 'trial_requests' then
    perform platform.staff_notify('trial_request', 'admin', 'New trial request', new.business_name || ' · ' || new.contact_name, '#trials', 'trial:' || new.id);
  elsif tg_table_name = 'support_tickets' then
    perform platform.staff_notify('ticket', 'all', 'New ticket', new.subject, '#tickets', 'ticket:' || new.id);
  elsif tg_table_name = 'creator_profile_reviews' then
    if new.verdict = 'invalid' and new.status = 'pending' then
      select c.display_name into cname from gcp.creators c where c.id = new.creator_id;
      perform platform.staff_notify('profile_report', 'admin', 'Profile reported', coalesce(cname, 'A creator') || coalesce(' · ' || replace(new.reason, '_', ' '), ''), '#reports',
        'report:' || new.id || ':' || extract(epoch from new.updated_at)::bigint);
    end if;
  elsif tg_table_name = 'creators' then
    if new.status = 'hidden' and old.status is distinct from 'hidden' and new.hidden_reason like 'Hidden automatically:%' then
      perform platform.staff_notify('creator_review', 'admin', 'Creator hidden after reports: needs review', new.display_name || ' · ' || new.hidden_reason, '#reports',
        'autohide:' || new.id || ':' || extract(epoch from now())::bigint);
    end if;
  end if;
  return new;
end $$;
revoke all on function platform.staff_notify_event() from public;

drop trigger if exists staff_notify_new_user on wp.users;
create trigger staff_notify_new_user after insert on wp.users for each row execute function platform.staff_notify_event();
drop trigger if exists staff_notify_subscription on wp.subscriptions;
create trigger staff_notify_subscription after insert or update of status on wp.subscriptions for each row execute function platform.staff_notify_event();
drop trigger if exists staff_notify_trial_request on platform.trial_requests;
create trigger staff_notify_trial_request after insert on platform.trial_requests for each row execute function platform.staff_notify_event();
drop trigger if exists staff_notify_ticket on wp.support_tickets;
create trigger staff_notify_ticket after insert on wp.support_tickets for each row execute function platform.staff_notify_event();
drop trigger if exists staff_notify_report on wp.creator_profile_reviews;
create trigger staff_notify_report after insert or update of status, verdict, reason on wp.creator_profile_reviews for each row execute function platform.staff_notify_event();
drop trigger if exists staff_notify_creator_review on gcp.creators;
create trigger staff_notify_creator_review after update of status on gcp.creators for each row execute function platform.staff_notify_event();

-- Email delivery for staff notifications: claim a batch (stuck "sending" rows retry after 10 minutes), then mark each.
create or replace function platform.staff_notification_emails_claim(p_limit integer)
  returns table (notification_id uuid, staff_id uuid, email text, name text, title text, body text, link text)
  language sql volatile security definer set search_path = pg_catalog as $$
  -- Checked again at send time: a staff member disabled, demoted or who turned email off since is never emailed.
  with dropped as (
    update staff.notification_emails e set status = 'failed'
    from staff.notifications n, staff.staff_users s
    where n.id = e.notification_id and s.id = e.staff_id and e.status in ('pending', 'sending')
      and not (s.status = 'active' and s.notify_email and (n.audience = 'all' or s.role in ('admin', 'super_admin')))
    returning e.notification_id),
  picked as (
    select e.notification_id, e.staff_id from staff.notification_emails e join staff.notifications n on n.id = e.notification_id
      join staff.staff_users s on s.id = e.staff_id
    where (e.status = 'pending' or (e.status = 'sending' and e.claimed_at < now() - interval '10 minutes')) and e.attempts < 5
      and s.status = 'active' and s.notify_email and (n.audience = 'all' or s.role in ('admin', 'super_admin'))
      and n.created_at > now() - interval '7 days'
    order by n.created_at limit least(greatest(p_limit, 1), 100) for update of e skip locked),
  claimed as (
    update staff.notification_emails e set status = 'sending', claimed_at = now(), attempts = e.attempts + 1
    from picked p where e.notification_id = p.notification_id and e.staff_id = p.staff_id returning e.notification_id, e.staff_id)
  select c.notification_id, c.staff_id, s.email, s.name, n.title, n.body, n.link
  from claimed c join staff.staff_users s on s.id = c.staff_id join staff.notifications n on n.id = c.notification_id
$$;
create or replace function platform.staff_notification_email_done(p_notification uuid, p_staff uuid, p_ok boolean, p_retry boolean) returns void
  language sql volatile security definer set search_path = pg_catalog as $$
  update staff.notification_emails set status = case when p_ok then 'sent' when p_retry then 'pending' else 'failed' end,
    sent_at = case when p_ok then now() end
  where notification_id = p_notification and staff_id = p_staff
$$;
revoke all on function platform.staff_notification_emails_claim(integer) from public;
revoke all on function platform.staff_notification_email_done(uuid, uuid, boolean, boolean) from public;
grant execute on function platform.staff_notification_emails_claim(integer) to mushin_worker;
grant execute on function platform.staff_notification_email_done(uuid, uuid, boolean, boolean) to mushin_worker;
