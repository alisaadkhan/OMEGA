-- Owner plan model (2026-10-16, pricing screenshot). platform.plans stays the one authoritative catalogue; the API and the
-- pricing page read it. Persisted ids are unchanged ('explorer' is shown as Starter) so subscriptions, checkouts,
-- ledger rows and provider price ids keep reconciling.
--
--   plan       PKR/month  credits  campaigns            audience details        outreach emails  data export
--   Starter     4,900     2,500   3 not archived        not included                  0             no
--   Growth     12,900    12,000   unlimited             included (global gate)      500             no
--   Scale      24,900    35,000   unlimited             included (global gate)    2,000             yes
--
-- Audience details and outreach email are also switched on or off for everyone by the server (an approved data source;
-- a configured, authorised email provider), so a plan's entitlement alone never makes them usable.

update platform.plans set name = 'Starter', monthly_credits = 2500, display_monthly_minor = 490000,
  entitlements = '{"audienceViewsPerMonth": 0, "outreachEmailsPerMonth": 0, "campaignLimit": 3, "export": false}'
  where id = 'explorer';
update platform.plans set name = 'Growth', monthly_credits = 12000, display_monthly_minor = 1290000,
  entitlements = '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 500, "campaignLimit": null, "export": false}'
  where id = 'growth';
update platform.plans set name = 'Scale', monthly_credits = 35000, display_monthly_minor = 2490000,
  entitlements = '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 2000, "campaignLimit": null, "export": true}'
  where id = 'scale';

-- The entitlement document has exactly these keys and types; a malformed edit is refused.
alter table platform.plans add constraint plans_entitlements_shape check (
  entitlements ?& array['audienceViewsPerMonth', 'outreachEmailsPerMonth', 'campaignLimit', 'export']
  and entitlements - array['audienceViewsPerMonth', 'outreachEmailsPerMonth', 'campaignLimit', 'export'] = '{}'::jsonb
  and jsonb_typeof(entitlements -> 'export') = 'boolean'
  and jsonb_typeof(entitlements -> 'audienceViewsPerMonth') in ('number', 'null')
  and jsonb_typeof(entitlements -> 'outreachEmailsPerMonth') in ('number', 'null')
  and jsonb_typeof(entitlements -> 'campaignLimit') in ('number', 'null'));

-- Annual billing has no approved price yet (open decision OD-002): the stored yearly prices are kept but not offered,
-- and new yearly checkouts or changes are refused until the owner turns this on.
alter table platform.billing_settings add column annual_billing_enabled boolean not null default false;

-- Campaign archive (owner rule: the Starter limit counts campaigns that are not archived; archiving frees a slot and
-- keeps the history).
alter table wp.campaigns drop constraint campaigns_status_check;
alter table wp.campaigns add constraint campaigns_status_check check (status in ('draft', 'active', 'paused', 'completed', 'archived'));
alter table wp.campaigns add column archived_at timestamptz;
alter table wp.campaigns add constraint campaigns_archived_at check ((status = 'archived') = (archived_at is not null));

-- Refunds and chargebacks reported by the payment provider (provisional policy until OD-009 is decided): the payment
-- is marked, the unspent credits it granted are removed through the ledger, and credits already spent are recorded as
-- a shortfall, never a negative balance. Each provider adjustment is applied once.
alter table wp.payments add column refunded_minor bigint not null default 0 check (refunded_minor >= 0);
create table wp.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  payment_id uuid not null references wp.payments (id),
  provider_adjustment_id text not null unique,
  action text not null check (action in ('refund', 'chargeback')),
  amount_minor bigint not null check (amount_minor >= 0),
  credits_removed integer not null check (credits_removed >= 0),
  credits_shortfall integer not null check (credits_shortfall >= 0),
  created_at timestamptz not null default now()
);
create index payment_adjustments_workspace_idx on wp.payment_adjustments (workspace_id, created_at desc);
alter table wp.payment_adjustments enable row level security;
alter table wp.payment_adjustments force row level security;
create policy payment_adjustments_tenant on wp.payment_adjustments
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select on wp.payment_adjustments to mushin_app;
grant select, insert on wp.payment_adjustments to mushin_worker;

-- Which workspace a provider transaction belongs to (adjustment events carry no workspace): worker only.
create function platform.payment_owner(p_transaction text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('paymentId', id, 'workspaceId', workspace_id) from wp.payments where paddle_transaction_id = p_transaction
$$;
revoke all on function platform.payment_owner(text) from public;
grant execute on function platform.payment_owner(text) to mushin_worker;
