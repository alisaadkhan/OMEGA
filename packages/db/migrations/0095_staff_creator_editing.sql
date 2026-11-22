-- Staff creator editing (owner, 22 Nov: "Creator Checks is where all our creators show and we can edit every detail;
-- highlight reported profiles"). Staff can hide a creator from customers without erasing them and see how many customer reports are open on each creator.

-- Hidden by staff: kept, but out of every customer view (eligibility treats any status other than active as hidden).
alter table gcp.creators drop constraint creators_status_check;
alter table gcp.creators add constraint creators_status_check check (status in ('active', 'merged', 'removal_requested', 'erased', 'hidden'));
alter table gcp.creators add column if not exists hidden_by_staff_id uuid references staff.staff_users (id);
alter table gcp.creators add column if not exists hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 500);
alter table gcp.creators add column if not exists hidden_at timestamptz;

-- Open customer reports per creator (reports live in each customer account, behind row-level security): counts and
-- reasons only, never who reported.
create or replace function platform.staff_creator_report_counts() returns table (creator_id uuid, pending integer, reasons text[])
  language sql stable security definer set search_path = pg_catalog as $$
  select r.creator_id, count(*)::integer, array_agg(distinct r.reason) filter (where r.reason is not null)
  from wp.creator_profile_reviews r where r.status = 'pending' and r.verdict = 'invalid'
  group by r.creator_id
$$;
revoke all on function platform.staff_creator_report_counts() from public;
grant execute on function platform.staff_creator_report_counts() to mushin_worker;

-- One account's history for the staff Users page (owner, 22 Nov: "a user's entire history"): shortlists, campaigns,
-- searches (counts only: search text is never stored), saved searches, discovery jobs, payments, reveals and emails.
create or replace function platform.staff_workspace_history(p_workspace uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'lists', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select l.id, l.name, (select count(*) from wp.list_members m where m.list_id = l.id) creators, l.created_at "createdAt"
      from wp.lists l where l.workspace_id = p_workspace order by l.created_at desc limit 50) t),
    'campaigns', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select c.id, c.name, c.status, (select count(*) from wp.campaign_creators cc where cc.campaign_id = c.id) creators, c.created_at "createdAt"
      from wp.campaigns c where c.workspace_id = p_workspace order by c.created_at desc limit 50) t),
    'searches', jsonb_build_object(
      'total', (select count(*) from wp.search_events e where e.workspace_id = p_workspace),
      'last30Days', (select count(*) from wp.search_events e where e.workspace_id = p_workspace and e.created_at > now() - interval '30 days'),
      'charged', (select count(*) from wp.search_events e where e.workspace_id = p_workspace and e.charged),
      'recent', (select coalesce(jsonb_agg(row_to_json(t) order by t."at" desc), '[]'::jsonb) from (
        select e.created_at "at", e.results, e.charged, e.filter_count "filters", e.has_text "hadText"
        from wp.search_events e where e.workspace_id = p_workspace order by e.created_at desc limit 15) t)),
    'savedSearches', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select s.name, s.query_text "queryText", s.created_at "createdAt" from wp.saved_searches s where s.workspace_id = p_workspace order by s.created_at desc limit 20) t),
    'jobs', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select j.id, j.kind, j.status, j.search->>'text' brief, j.handle, j.credits_charged "creditsCharged", j.created_at "createdAt"
      from wp.discovery_jobs j where j.workspace_id = p_workspace order by j.created_at desc limit 20) t),
    'payments', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select p.kind, p.amount_minor "amountMinor", p.currency, p.status, p.refunded_minor "refundedMinor", p.created_at "createdAt"
      from wp.payments p where p.workspace_id = p_workspace order by p.created_at desc limit 20) t),
    'revealedContacts', (select count(*) from wp.contact_reveals r where r.workspace_id = p_workspace),
    'emailsSent', (select count(*) from wp.outreach_emails o where o.workspace_id = p_workspace),
    'suspended', exists (select 1 from wp.workspace_members m join wp.users u on u.id = m.user_id where m.workspace_id = p_workspace and u.status = 'suspended'))
$$;
revoke all on function platform.staff_workspace_history(uuid) from public;
grant execute on function platform.staff_workspace_history(uuid) to mushin_worker;

-- Suspending a customer account (owner, 22 Nov): every person in it is refused at sign-in until staff restore it.
-- People already deleted stay deleted. Returns how many people changed.
create or replace function platform.staff_set_account_suspended(p_workspace uuid, p_suspended boolean) returns integer
  language sql volatile security definer set search_path = pg_catalog as $$
  with changed as (
    update wp.users u set status = case when p_suspended then 'suspended' else 'active' end, updated_at = now()
    where u.id in (select m.user_id from wp.workspace_members m where m.workspace_id = p_workspace)
      and u.status = case when p_suspended then 'active' else 'suspended' end
    returning u.id)
  select count(*)::integer from changed
$$;
revoke all on function platform.staff_set_account_suspended(uuid, boolean) from public;
grant execute on function platform.staff_set_account_suspended(uuid, boolean) to mushin_worker;

-- Plan terms and credit costs from the staff console (owner, 22 Nov), Super Admin only through the API. The amount the
-- payment provider charges is set in the provider and is not changed here: this edits the credits a plan grants each
-- month, the PKR price shown to customers and the credits each action costs.
create or replace function platform.staff_set_plan_terms(p_id text, p_monthly_credits integer, p_display_monthly_minor bigint) returns void
  language plpgsql volatile security definer set search_path = pg_catalog as $$
begin
  if p_monthly_credits < 0 or p_monthly_credits > 1000000 or p_display_monthly_minor < 0 then raise exception 'plan terms out of range'; end if;
  update platform.plans set monthly_credits = p_monthly_credits, display_monthly_minor = p_display_monthly_minor, updated_at = now() where id = p_id;
  if not found then raise exception 'no such plan %', p_id; end if;
end $$;

create or replace function platform.staff_set_action_cost(p_action text, p_credits integer) returns void
  language plpgsql volatile security definer set search_path = pg_catalog as $$
begin
  if p_credits < 0 or p_credits > 100000 then raise exception 'credit cost out of range'; end if;
  update platform.credit_action_costs set credits = p_credits, updated_at = now() where action = p_action;
  if not found then raise exception 'no such action %', p_action; end if;
end $$;

revoke all on function platform.staff_set_plan_terms(text, integer, bigint) from public;
revoke all on function platform.staff_set_action_cost(text, integer) from public;
grant execute on function platform.staff_set_plan_terms(text, integer, bigint) to mushin_worker;
grant execute on function platform.staff_set_action_cost(text, integer) to mushin_worker;

-- The staff System Health page shows which database version is live (owner, 22 Nov).
grant select on platform.schema_migrations to mushin_worker;
