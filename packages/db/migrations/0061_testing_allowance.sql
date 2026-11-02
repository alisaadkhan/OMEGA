-- Monthly testing allowance (owner instruction 2026-10-27): a new customer account's first workspace receives
-- `testing_monthly_credits` (500) credits for the current calendar month (Asia/Karachi), and again at 00:00 PKT on the
-- first of every month. Rules:
--   * One allowance per person (wp.users.testing_allowance_at, claimed once like trial_granted_at), on the workspace
--     provisioned for them (wp.workspaces.testing_allowance_since). Invited members and further workspaces get none.
--   * Each month's grant is one ledger row with source_ref 'testing:<workspace>:<YYYY-MM>'; the existing unique index
--     on (workspace_id, kind, source_ref) makes a second grant for the same month impossible.
--   * The month's lot expires at 00:00 PKT on the first of the next month: unused testing credits lapse (expire rows in
--     the ledger) and never accumulate. Purchased, plan, trial and adjustment lots are never touched by this.
--   * Without a plan, testing credits pay only for actions that cost MUSHIN no provider spend (catalogue search,
--     contact reveal); reservations paid from them carry spend_scope 'testing_only'.
alter table wp.credit_lots drop constraint credit_lots_source_check;
alter table wp.credit_lots add constraint credit_lots_source_check check (source in ('trial', 'monthly', 'topup', 'adjustment', 'testing'));

alter table wp.credit_reservations drop constraint credit_reservations_spend_scope_check;
alter table wp.credit_reservations add constraint credit_reservations_spend_scope_check check (spend_scope in ('all', 'topup_only', 'testing_only'));

alter table platform.billing_schedule drop constraint billing_schedule_job_check;
alter table platform.billing_schedule add constraint billing_schedule_job_check
  check (job in ('release_abandoned', 'expire_lots', 'end_trials', 'trial_notices', 'monthly_grants',
                 'scheduled_changes', 'reconcile', 'mock_renewals', 'comp_period_end', 'testing_allowance'));

alter table wp.users add column testing_allowance_at timestamptz;
alter table wp.workspaces add column testing_allowance_since timestamptz;

-- 0 turns the allowance off for new grants (existing lots run to their expiry).
alter table platform.billing_settings
  add column testing_monthly_credits integer not null default 500 check (testing_monthly_credits between 0 and 100000);

-- The API role may create credits only as narrowly as before (0005: the bounded trial grant). It may now also create
-- this month's testing grant at sign-up, and nothing more: an enrolled workspace, at most the configured amount, the
-- workspace in the reference, and a lot that lapses by the start of next month. Monthly renewals run
-- in the worker.
drop policy credit_lots_app_insert on wp.credit_lots;
create policy credit_lots_app_insert on wp.credit_lots as restrictive for insert to mushin_app
  with check (
    (source = 'trial' and amount <= (select trial_credits from platform.billing_settings))
    or (source = 'testing'
        and amount <= (select testing_monthly_credits from platform.billing_settings)
        and expires_at <= (date_trunc('month', now() at time zone 'Asia/Karachi') + interval '1 month') at time zone 'Asia/Karachi'
        and exists (select 1 from wp.workspaces w where w.id = workspace_id and w.testing_allowance_since is not null))
  );
drop policy credit_ledger_app_insert on wp.credit_ledger;
create policy credit_ledger_app_insert on wp.credit_ledger as restrictive for insert to mushin_app
  with check (
    kind in ('reserve', 'spend', 'release')
    or (kind = 'grant' and source_ref = 'trial:' || workspace_id::text
        and amount <= (select trial_credits from platform.billing_settings))
    -- The lot policy above bounds the value (a lot lapsing by next month); the reference names this workspace, and the
    -- unique (workspace, kind, source_ref) index allows one grant per month.
    or (kind = 'grant' and source_ref like 'testing:' || workspace_id::text || ':____-__'
        and amount <= (select testing_monthly_credits from platform.billing_settings))
  );
