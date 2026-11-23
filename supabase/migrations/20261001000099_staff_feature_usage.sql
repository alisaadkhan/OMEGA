-- Feature adoption on the staff Overview (owner design, 23 Nov): how many times each customer feature was used in the
-- last p_days days and by how many accounts. Counts only, never what was searched or who was looked at. The API's system
-- role cannot read these workspace tables directly, so this runs as the owner and returns the aggregates alone.
create or replace function platform.staff_feature_usage(p_days integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  with since as (select now() - make_interval(days => greatest(1, least(p_days, 90))) t)
  select jsonb_agg(jsonb_build_object('key', key, 'count', n, 'accounts', accounts) order by ord) from (
    select 1 ord, 'catalogue_search' key, count(*) n, count(distinct workspace_id) accounts from wp.search_events, since where created_at >= since.t
    union all select 2, 'live_discovery', count(*), count(distinct workspace_id) from wp.discovery_jobs, since where created_at >= since.t and kind = 'live'
    union all select 3, 'profile_views', count(*), count(distinct workspace_id) from wp.creator_profile_views, since where viewed_at >= since.t
    union all select 4, 'contact_reveals', count(*), count(distinct workspace_id) from wp.contact_reveals, since where created_at >= since.t
    union all select 5, 'campaign_roster', count(*), count(distinct workspace_id) from wp.campaign_creators, since where added_at >= since.t
    union all select 6, 'outreach_emails', count(*), count(distinct workspace_id) from wp.outreach_emails, since where created_at >= since.t
  ) x
$$;
revoke all on function platform.staff_feature_usage(integer) from public;
grant execute on function platform.staff_feature_usage(integer) to mushin_worker;

-- Credit spending history is kept for as long as the account exists (owner, 23 Nov: "its credit expenditure shouldn't
-- be removed or deleted as long as we have its account"). The app and worker could already only insert and read it;
-- this also refuses any change or deletion by any role, except the cascade when the account itself is deleted.
create or replace function platform.credit_ledger_keep() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'credit history cannot be changed' using errcode = 'P0001';
  end if;
  if exists (select 1 from wp.workspaces w where w.id = old.workspace_id) then
    raise exception 'credit history is kept while the account exists' using errcode = 'P0001';
  end if;
  return old;
end
$$;
drop trigger if exists credit_ledger_keep on wp.credit_ledger;
create trigger credit_ledger_keep before update or delete on wp.credit_ledger for each row execute function platform.credit_ledger_keep();
