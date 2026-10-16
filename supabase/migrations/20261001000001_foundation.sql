-- Roles used by the API and worker inside every transaction (SET LOCAL ROLE).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mushin_app') then
    create role mushin_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mushin_worker') then
    create role mushin_worker nologin;
  end if;
end $$;

grant mushin_app to current_user;
grant mushin_worker to current_user;

create schema if not exists wp;
create schema if not exists staff;
-- platform is created by the migration runner.

revoke all on schema wp, staff, platform from public;
do $$
begin
  -- Supabase's Data API roles must never reach our schemas.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema wp, staff, platform from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema wp, staff, platform from authenticated;
  end if;
end $$;

grant usage on schema wp, platform to mushin_app, mushin_worker;
grant usage on schema staff to mushin_worker;

-- Tenant settings: NULL when unset OR empty (pooled connections keep '' after a transaction).
create or replace function platform.current_workspace_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;
create or replace function platform.current_user_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
grant execute on function platform.current_workspace_id(), platform.current_user_id() to mushin_app, mushin_worker;

create or replace function platform.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
