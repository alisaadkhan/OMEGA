-- Account suspension kept per account (security review of 0095, 23 Nov). 0095 remembered only one suspending account
-- per person: when a person belonged to two suspended accounts, restoring either one let them sign in again although
-- the other account was still suspended. Each suspended account is now recorded, and a person is restored only once
-- no account they belong to is still suspended. A person suspended some other way (not through an account) is never
-- restored here.
create table if not exists wp.workspace_suspensions (
  workspace_id uuid primary key references wp.workspaces (id) on delete cascade,
  suspended_at timestamptz not null default now()
);
alter table wp.workspace_suspensions enable row level security;
alter table wp.workspace_suspensions force row level security;
-- Written only by the staff function below (security definer); no grant to the app role, the policy scopes any read.
create policy workspace_suspensions_tenant on wp.workspace_suspensions using (workspace_id = platform.current_workspace_id());
revoke all on wp.workspace_suspensions from public;

-- Accounts suspended through 0095 before this migration.
insert into wp.workspace_suspensions (workspace_id)
select distinct u.suspended_by_workspace from wp.users u where u.status = 'suspended' and u.suspended_by_workspace is not null
on conflict do nothing;

create or replace function platform.staff_set_account_suspended(p_workspace uuid, p_suspended boolean) returns integer
  language plpgsql volatile security definer set search_path = pg_catalog as $$
declare
  n integer;
begin
  if p_suspended then
    insert into wp.workspace_suspensions (workspace_id) values (p_workspace) on conflict do nothing;
    with changed as (
      update wp.users u set status = 'suspended', suspended_by_workspace = p_workspace, updated_at = now()
      where u.id in (select m.user_id from wp.workspace_members m where m.workspace_id = p_workspace) and u.status = 'active'
      returning u.id)
    select count(*)::integer into n from changed;
  else
    delete from wp.workspace_suspensions s where s.workspace_id = p_workspace;
    -- Members still in another suspended account stay suspended, now under that account.
    update wp.users u
      set suspended_by_workspace = (select s.workspace_id from wp.workspace_suspensions s join wp.workspace_members m on m.workspace_id = s.workspace_id
                                    where m.user_id = u.id order by s.suspended_at limit 1),
          updated_at = now()
    where u.status = 'suspended' and u.suspended_by_workspace = p_workspace
      and exists (select 1 from wp.workspace_suspensions s join wp.workspace_members m on m.workspace_id = s.workspace_id where m.user_id = u.id);
    with changed as (
      update wp.users u set status = 'active', suspended_by_workspace = null, updated_at = now()
      where u.status = 'suspended' and u.suspended_by_workspace = p_workspace
      returning u.id)
    select count(*)::integer into n from changed;
  end if;
  return n;
end
$$;
revoke all on function platform.staff_set_account_suspended(uuid, boolean) from public;
grant execute on function platform.staff_set_account_suspended(uuid, boolean) to mushin_worker;
