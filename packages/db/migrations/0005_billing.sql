-- Sub-project 2: credits & billing. Spec: docs/superpowers/specs/2026-10-07-billing-credits-design.md §3-§4.

-- ── Config (global, editable without a deploy) ─────────────────────────────
create table platform.plans (
  id text primary key check (id in ('explorer', 'growth', 'scale')),
  name text not null,
  monthly_credits integer not null check (monthly_credits > 0),
  display_currency char(3) not null default 'PKR',
  display_monthly_minor bigint not null check (display_monthly_minor >= 0),
  display_yearly_monthly_minor bigint not null check (display_yearly_monthly_minor >= 0),
  charge_currency char(3) not null default 'USD',
  charge_monthly_minor bigint not null check (charge_monthly_minor >= 0),
  charge_yearly_minor bigint not null check (charge_yearly_minor >= 0),
  entitlements jsonb not null,
  paddle_price_ids jsonb not null,
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.topup_packs (
  id text primary key,
  credits integer not null check (credits > 0),
  display_currency char(3) not null default 'PKR',
  display_price_minor bigint not null check (display_price_minor >= 0),
  charge_currency char(3) not null default 'USD',
  charge_price_minor bigint not null check (charge_price_minor >= 0),
  validity_months integer not null default 12 check (validity_months > 0),
  paddle_price_id text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.credit_action_costs (
  action text primary key check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  credits integer not null check (credits >= 0),
  updated_at timestamptz not null default now()
);

create table platform.billing_settings (
  id boolean primary key default true check (id),
  trial_days integer not null check (trial_days > 0),
  trial_credits integer not null check (trial_credits > 0),
  trial_plan_id text not null references platform.plans (id),
  reservation_ttl_minutes integer not null check (reservation_ttl_minutes > 0),
  meter_amber_pct integer not null check (meter_amber_pct between 0 and 100),
  meter_red_pct integer not null check (meter_red_pct between 0 and 100),
  trial_ending_notice_days integer not null check (trial_ending_notice_days >= 0),
  updated_at timestamptz not null default now()
);

create table platform.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, provider_event_id)
);

-- Provisional seed values (spec §3). Mock price ids are replaced with Paddle sandbox ids when keys exist.
insert into platform.plans
  (id, name, monthly_credits, display_monthly_minor, display_yearly_monthly_minor, charge_monthly_minor, charge_yearly_minor, entitlements, paddle_price_ids, sort_order)
values
  ('explorer', 'Explorer', 2500, 490000, 390000, 1800, 16800,
   '{"audienceViewsPerMonth": 5, "outreachEmailsPerMonth": 0, "campaignLimit": 3, "export": false}',
   '{"month": "pri_mock_explorer_month", "year": "pri_mock_explorer_year"}', 1),
  ('growth', 'Growth', 12000, 1290000, 1090000, 4600, 46800,
   '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 500, "campaignLimit": null, "export": false}',
   '{"month": "pri_mock_growth_month", "year": "pri_mock_growth_year"}', 2),
  ('scale', 'Scale', 35000, 2490000, 1990000, 8900, 85200,
   '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 2000, "campaignLimit": null, "export": true}',
   '{"month": "pri_mock_scale_month", "year": "pri_mock_scale_year"}', 3);

insert into platform.topup_packs (id, credits, display_price_minor, charge_price_minor, validity_months, paddle_price_id) values
  ('credits_1000', 1000, 250000, 900, 12, 'pri_mock_credits_1000'),
  ('credits_5000', 5000, 990000, 3500, 12, 'pri_mock_credits_5000'),
  ('credits_15000', 15000, 2490000, 8900, 12, 'pri_mock_credits_15000');

insert into platform.credit_action_costs (action, credits) values
  ('search_existing', 0), ('find_new', 12), ('reveal_contact', 5), ('refresh_data', 10);

insert into platform.billing_settings
  (trial_days, trial_credits, trial_plan_id, reservation_ttl_minutes, meter_amber_pct, meter_red_pct, trial_ending_notice_days)
values (14, 200, 'explorer', 15, 20, 5, 3);

-- ── Workspace state ─────────────────────────────────────────────────────────
create table wp.subscriptions (
  workspace_id uuid primary key references wp.workspaces (id) on delete cascade,
  plan_id text references platform.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  trial_ending_notified_at timestamptz,
  next_credit_grant_at timestamptz,
  paddle_subscription_id text unique,
  paddle_customer_id text,
  cancel_at_period_end boolean not null default false,
  scheduled_plan_id text references platform.plans (id),
  scheduled_interval text check (scheduled_interval in ('month', 'year')),
  provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scheduled_plan_id is null) = (scheduled_interval is null))
);

create table wp.checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  kind text not null check (kind in ('subscription', 'topup')),
  plan_id text references platform.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  topup_pack_id text references platform.topup_packs (id),
  price_id text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  status text not null default 'open' check (status in ('open', 'paid', 'failed', 'expired')),
  provider_checkout_id text,
  hosted_url text,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'subscription' and plan_id is not null and billing_interval is not null and topup_pack_id is null)
    or (kind = 'topup' and topup_pack_id is not null and plan_id is null and billing_interval is null)
  )
);
create index checkouts_workspace_idx on wp.checkouts (workspace_id, created_at desc);

create table wp.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  paddle_transaction_id text not null unique,
  kind text not null check (kind in ('subscription', 'topup')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  status text not null,
  invoice_url text,
  checkout_id uuid references wp.checkouts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_workspace_idx on wp.payments (workspace_id, created_at desc);

create table wp.credit_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  source text not null check (source in ('trial', 'monthly', 'topup', 'adjustment')),
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining >= 0 and remaining <= amount),
  expires_at timestamptz not null,
  payment_id uuid references wp.payments (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_lots_spendable_idx on wp.credit_lots (workspace_id, expires_at) where remaining > 0;

create table wp.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  amount integer not null check (amount > 0),
  action text not null check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  confirmed_cost integer not null check (confirmed_cost >= 0),
  status text not null check (status in ('held', 'committed', 'released', 'expired')),
  expires_at timestamptz not null,
  ref_type text not null,
  ref_id text not null,
  committed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_reservations_held_idx on wp.credit_reservations (workspace_id, expires_at) where status = 'held';

-- Append-only: no UPDATE/DELETE grants to any role.
create table wp.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('grant', 'spend', 'refund', 'expire', 'adjust', 'reserve', 'release')),
  action text check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  lot_id uuid references wp.credit_lots (id),
  reservation_id uuid references wp.credit_reservations (id),
  source_ref text,
  actor_user_id uuid,
  actor_staff_id uuid,
  note text,
  created_at timestamptz not null default now(),
  check (kind not in ('reserve', 'release') or lot_id is null),
  check (kind not in ('grant', 'spend', 'expire') or lot_id is not null),
  -- Sign rules: grants add, spends and expiries remove, reserve/release record the held amount.
  check (
    (kind in ('grant', 'reserve', 'release') and amount > 0)
    or (kind in ('spend', 'expire') and amount < 0)
    or (kind in ('refund', 'adjust') and amount <> 0)
  )
);
create index credit_ledger_history_idx on wp.credit_ledger (workspace_id, created_at desc, id desc);
create index credit_ledger_lot_idx on wp.credit_ledger (lot_id) where lot_id is not null;
create unique index credit_ledger_source_ref_key on wp.credit_ledger (workspace_id, kind, source_ref) where source_ref is not null;

create table wp.entitlement_usage (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  key text not null check (key in ('audience_views', 'outreach_emails')),
  period_start date not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key, period_start)
);

-- updated_at triggers
create trigger plans_updated_at before update on platform.plans for each row execute function platform.set_updated_at();
create trigger topup_packs_updated_at before update on platform.topup_packs for each row execute function platform.set_updated_at();
create trigger credit_action_costs_updated_at before update on platform.credit_action_costs for each row execute function platform.set_updated_at();
create trigger billing_settings_updated_at before update on platform.billing_settings for each row execute function platform.set_updated_at();
create trigger subscriptions_updated_at before update on wp.subscriptions for each row execute function platform.set_updated_at();
create trigger checkouts_updated_at before update on wp.checkouts for each row execute function platform.set_updated_at();
create trigger payments_updated_at before update on wp.payments for each row execute function platform.set_updated_at();
create trigger credit_lots_updated_at before update on wp.credit_lots for each row execute function platform.set_updated_at();
create trigger credit_reservations_updated_at before update on wp.credit_reservations for each row execute function platform.set_updated_at();
create trigger entitlement_usage_updated_at before update on wp.entitlement_usage for each row execute function platform.set_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'checkouts', 'payments', 'credit_lots', 'credit_reservations', 'credit_ledger', 'entitlement_usage']
  loop
    execute format('alter table wp.%I enable row level security', t);
    execute format('alter table wp.%I force row level security', t);
    execute format(
      'create policy %I on wp.%I using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id())',
      t || '_tenant', t);
  end loop;
end $$;

-- ── Due-work index for scheduled jobs ───────────────────────────────────────
-- Only workspace ids and due times (no workspace data), so jobs find which workspaces to visit without reading
-- workspace tables across tenants (SRS §2.5: every workspace-data access filters by workspace ID).
create table platform.billing_schedule (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  job text not null check (job in ('release_abandoned', 'expire_lots', 'end_trials', 'trial_notices', 'monthly_grants',
                                   'scheduled_changes', 'reconcile', 'mock_renewals')),
  due_at timestamptz not null,
  primary key (workspace_id, job)
);
create index billing_schedule_due_idx on platform.billing_schedule (job, due_at);
-- Per-workspace rows: tenant-scoped like every workspace table. The worker may read ids/times to find due work,
-- but every write needs workspace context.
alter table platform.billing_schedule enable row level security;
alter table platform.billing_schedule force row level security;
create policy billing_schedule_tenant on platform.billing_schedule
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());
create policy billing_schedule_worker_scan on platform.billing_schedule for select to mushin_worker using (true);

-- ── Billing integrity for the API role ─────────────────────────────────────
-- Credits and plans change only through payment webhooks applied by the worker (mushin_worker). The API role
-- (mushin_app) may start the one trial, hold/spend/release credits and record checkout attempts, nothing more,
-- so a bug in any API path cannot grant credits or activate a plan.
create unique index credit_lots_one_trial_key on wp.credit_lots (workspace_id) where source = 'trial';

create policy credit_lots_app_insert on wp.credit_lots as restrictive for insert to mushin_app
  with check (source = 'trial' and amount <= (select trial_credits from platform.billing_settings));

create policy credit_ledger_app_insert on wp.credit_ledger as restrictive for insert to mushin_app
  with check (
    kind in ('reserve', 'spend', 'release')
    or (kind = 'grant' and source_ref = 'trial:' || workspace_id::text
        and amount <= (select trial_credits from platform.billing_settings))
  );

create policy checkouts_app_update on wp.checkouts as restrictive for update to mushin_app
  using (true) with check (status in ('open', 'failed'));

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select on platform.plans, platform.topup_packs, platform.credit_action_costs, platform.billing_settings to mushin_app, mushin_worker;
-- API role: column-level rights only where it has a legitimate write.
grant select on wp.subscriptions to mushin_app;
grant insert (workspace_id, trial_ends_at) on wp.subscriptions to mushin_app;
grant update (scheduled_plan_id, scheduled_interval) on wp.subscriptions to mushin_app;
grant select, insert on wp.credit_lots to mushin_app;
grant update (remaining) on wp.credit_lots to mushin_app;
grant select, insert on wp.credit_reservations to mushin_app;
grant update (status, expires_at, committed_at, released_at) on wp.credit_reservations to mushin_app;
grant select, insert on wp.checkouts to mushin_app;
grant update (status, provider_checkout_id, hosted_url) on wp.checkouts to mushin_app;
grant select, insert, update on wp.entitlement_usage to mushin_app;
grant select on wp.payments to mushin_app;
grant select, insert on wp.credit_ledger to mushin_app;
-- Worker role: applies webhooks and runs jobs (always inside one workspace's context).
grant select, insert, update on wp.subscriptions, wp.checkouts, wp.credit_lots, wp.credit_reservations, wp.entitlement_usage, wp.payments
  to mushin_worker;
grant select, insert on wp.credit_ledger to mushin_worker;
grant select, insert, update on platform.webhook_events to mushin_worker;
grant select, insert, update on platform.billing_schedule to mushin_app;
grant select, insert, update, delete on platform.billing_schedule to mushin_worker;
