-- Creator Trash and Ban (owner, 23 Nov): staff move creators who do not qualify to Trash. A trashed creator is out of
-- every customer view at once (eligibility treats any status other than active as hidden), can be restored for 45 days,
-- and is then erased by the daily job. A banned creator is trashed too, and its profile links go on the do-not-re-add
-- list straight away, so no search or import brings it back, before or after the erasure.
alter table gcp.creators drop constraint if exists creators_status_check;
alter table gcp.creators add constraint creators_status_check check (status in ('active', 'merged', 'removal_requested', 'erased', 'hidden', 'trashed'));
alter table gcp.creators add column if not exists trashed_at timestamptz;
alter table gcp.creators add column if not exists trashed_by_staff_id uuid references staff.staff_users (id);
alter table gcp.creators add column if not exists trash_reason text check (trash_reason is null or char_length(trash_reason) <= 500);
alter table gcp.creators add column if not exists trash_banned boolean not null default false;
create index if not exists creators_trashed_at_idx on gcp.creators (trashed_at) where status = 'trashed';

-- Which ban put a link on the do-not-re-add list, so restoring a banned creator lifts only its own ban and never a
-- privacy erasure's suppression of the same link.
alter table gcp.creator_suppressions add column if not exists banned_creator_id uuid references gcp.creators (id) on delete set null;

create or replace function platform.staff_lift_ban(p_creator_id uuid) returns integer
  language sql volatile security definer set search_path = pg_catalog as $$
  with gone as (
    delete from gcp.creator_suppressions s where s.banned_creator_id = p_creator_id and s.removal_request_id is null returning 1)
  select count(*)::integer from gone
$$;
revoke all on function platform.staff_lift_ban(uuid) from public;
grant execute on function platform.staff_lift_ban(uuid) to mushin_worker;
