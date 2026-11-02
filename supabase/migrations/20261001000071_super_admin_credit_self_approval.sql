-- Owner directive (addendum item 5, 2026-11-03): the Super Admin (owner) may approve their own credit grant or refund
-- in one step, e.g. from a support ticket, without a second staff account. Only credits.grant; every other request
-- keeps the two-person rule, and staff access changes are untouched. The decision is flagged and audited, and the
-- database itself checks that the self-approver is an active Super Admin.

alter table staff.approvals add column self_approved boolean not null default false;

alter table staff.approvals drop constraint approvals_check;
alter table staff.approvals add constraint approvals_decider_check check (
  decided_by is null
  or (decided_by <> requested_by and not self_approved)
  or (decided_by = requested_by and self_approved and action_type = 'credits.grant')
);

create function staff.approvals_self_approval_guard() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  if new.self_approved and not exists (
    select 1 from staff.staff_users s where s.id = new.decided_by and s.role = 'super_admin' and s.status = 'active'
  ) then
    raise exception 'only an active Super Admin can approve their own credit grant' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger approvals_self_approval_guard before insert or update of self_approved, decided_by on staff.approvals
  for each row execute function staff.approvals_self_approval_guard();
