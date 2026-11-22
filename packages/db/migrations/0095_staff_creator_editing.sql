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
