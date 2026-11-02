-- Read-only preflight before applying migrations 0060, 0061, 0062 and 0063 to a hosted database (staging first).
-- (0063 only replaces the YouTube retention function; step 2's check of that function covers it.)
-- It changes nothing: everything runs in a read-only transaction that is rolled back.
--   psql "$STAGING_DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/preflight-0060-0062.sql
-- (Supply the URL from your own environment; never paste it into a report or chat.)
-- Every check prints ok=true when the migration can proceed. Any ok=false is a stop condition: do not migrate.
begin transaction read only;

\echo '== 1. Migration history: 0001-0059 applied, 0060-0062 not yet applied'
select count(*) filter (where name < '0060') = 59 and count(*) filter (where name >= '0060') = 0 as ok,
       count(*) as applied, max(name) as latest
from platform.schema_migrations;

\echo '== 2. Objects the migrations drop without IF EXISTS are present'
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'platform' and p.proname = 'expire_youtube_api_data' and pg_get_function_identity_arguments(p.oid) = 'p_days integer') = 1 as ok,
       'platform.expire_youtube_api_data(integer) (0060)' as object
union all
select count(*) = 3, 'constraints credit_lots_source_check, credit_reservations_spend_scope_check, billing_schedule_job_check (0061)'
from pg_constraint where conname in ('credit_lots_source_check', 'credit_reservations_spend_scope_check', 'billing_schedule_job_check')
union all
select count(*) = 2, 'policies credit_lots_app_insert, credit_ledger_app_insert (0061)'
from pg_policies where policyname in ('credit_lots_app_insert', 'credit_ledger_app_insert');

\echo '== 3. Columns the migrations add do not exist yet'
select count(*) = 0 as ok, string_agg(table_name || '.' || column_name, ', ') as already_present
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('gcp', 'creator_profiles', 'country_status'), ('wp', 'users', 'testing_allowance_at'),
  ('wp', 'workspaces', 'testing_allowance_since'), ('platform', 'billing_settings', 'testing_monthly_credits'), ('wp', 'credit_lots', 'period'));

\echo '== 4. Roles the grants name exist'
select count(*) = 2 as ok from pg_roles where rolname in ('mushin_app', 'mushin_worker');

\echo '== 5. Existing rows satisfy the widened constraints (always true unless data was edited by hand)'
select not exists (select 1 from wp.credit_lots where source not in ('trial', 'monthly', 'topup', 'adjustment')) as ok, 'credit_lots.source' as checked
union all
select not exists (select 1 from wp.credit_reservations where spend_scope not in ('all', 'topup_only')), 'credit_reservations.spend_scope';

\echo '== 6. 0062 preflight inputs: no testing lots can exist before 0061 (0062 backfills and checks them)'
select not exists (select 1 from wp.credit_lots where source = 'testing') as ok;

\echo '== 7. Size of the tables 0060 alters (an ALTER takes a brief exclusive lock; run in a quiet period)'
select relname, n_live_tup from pg_stat_user_tables where schemaname = 'gcp' and relname in ('creator_profiles', 'creators') order by 1;

\echo '== 8. Sessions that could block the ALTERs (long transactions)'
select count(*) = 0 as ok, max(now() - xact_start) as longest_open_transaction
from pg_stat_activity where datname = current_database() and xact_start < now() - interval '5 minutes' and pid <> pg_backend_pid();

rollback;
