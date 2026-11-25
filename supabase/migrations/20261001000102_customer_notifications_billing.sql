-- More customer notifications (owner, 25 Nov: "notifications and emails on plan assigned, trial assigned, plan purchased,
-- card declined, error, success ..."). Each is made by the database as the change happens, so it appears without a
-- background worker, and is emailed through the same path as 0100 (unless the person turned account emails off).
-- Card declined is already covered (notify.payment_failed, 0100). Staff-side notifications are a separate migration.

create or replace function platform.money_text(p_minor bigint, p_currency text) returns text
  language sql immutable set search_path = pg_catalog as $$
  select upper(coalesce(p_currency, '')) || ' ' || to_char(p_minor / 100.0, 'FM999,999,999,990.00')
$$;

-- A completed payment: a top-up or a subscription charge went through.
create or replace function platform.notify_payment() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform platform.notify_account(new.workspace_id,
    case when new.kind = 'topup' then 'topup_paid' else 'payment_received' end,
    case when new.kind = 'topup' then 'Your credit top-up went through' else 'Payment received' end,
    'We received ' || platform.money_text(new.amount_minor, new.currency) ||
      case when new.kind = 'topup' then '. The credits are in your account.' else ' for your subscription. Thank you.' end,
    '#/dashboard/billing', 'payment:' || new.id);
  return new;
end
$$;
drop trigger if exists payments_notify on wp.payments;
create trigger payments_notify after insert or update of status on wp.payments for each row execute function platform.notify_payment();

-- Plans: a paid plan becoming active, a plan MUSHIN gave the account, and a free trial starting.
create or replace function platform.notify_subscription() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  plan_name text;
  credits integer;
  comp boolean := coalesce(new.paddle_subscription_id, '') like 'comp:%';
  until_text text;
begin
  select p.name, p.monthly_credits into plan_name, credits from platform.plans p where p.id = new.plan_id;
  plan_name := coalesce(plan_name, 'your');
  if new.status = 'trialing' and (tg_op = 'INSERT' or old.status is distinct from 'trialing') then
    until_text := to_char(new.trial_ends_at at time zone 'Asia/Karachi', 'FMDD Mon YYYY');
    perform platform.notify_account(new.workspace_id, 'trial_started', 'Your free trial has started',
      'Search, shortlist and reach out to creators' || coalesce(' until ' || until_text, '') || '. Nothing is charged when it ends.',
      '#/dashboard/billing', 'trial_started:' || new.workspace_id || ':' || coalesce(extract(epoch from new.trial_ends_at)::bigint, 0));
  elsif new.status = 'active' and comp
        and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.plan_id is distinct from new.plan_id
             or old.paddle_subscription_id is distinct from new.paddle_subscription_id) then
    until_text := to_char(new.current_period_end at time zone 'Asia/Karachi', 'FMDD Mon YYYY');
    perform platform.notify_account(new.workspace_id, 'plan_assigned', 'MUSHIN added the ' || plan_name || ' plan to your account',
      coalesce(credits::text || ' credits a month', 'Your plan') || coalesce(', active until ' || until_text, '') || '.',
      '#/dashboard/billing', 'plan_assigned:' || new.workspace_id || ':' || coalesce(new.plan_id, '') || ':' || coalesce(extract(epoch from new.current_period_end)::bigint, 0));
  elsif new.status = 'active' and not comp and new.paddle_subscription_id is not null
        and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.plan_id is distinct from new.plan_id) then
    perform platform.notify_account(new.workspace_id, 'plan_purchased', 'Your ' || plan_name || ' plan is active',
      coalesce(credits::text || ' credits are added every month. ', '') || 'Thank you for subscribing.',
      '#/dashboard/billing', 'plan_purchased:' || new.workspace_id || ':' || coalesce(new.plan_id, '') || ':' || coalesce(new.paddle_subscription_id, ''));
  end if;
  return new;
end
$$;
drop trigger if exists subscriptions_notify on wp.subscriptions;
create trigger subscriptions_notify after insert or update of status, plan_id, paddle_subscription_id on wp.subscriptions
  for each row execute function platform.notify_subscription();

-- Credits staff added (a correction or a gift). Top-ups are told by their payment; the staff note stays internal.
create or replace function platform.notify_staff_credits() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.actor_staff_id is null or new.amount <= 0 or new.kind not in ('grant', 'adjust') then return new; end if;
  perform platform.notify_account(new.workspace_id, 'credits_added',
    to_char(new.amount, 'FM999,999,999') || ' credits were added to your account', 'They are ready to use.',
    '#/dashboard/billing', 'credits_added:' || new.id);
  return new;
end
$$;
drop trigger if exists credit_ledger_notify on wp.credit_ledger;
create trigger credit_ledger_notify after insert on wp.credit_ledger for each row execute function platform.notify_staff_credits();

-- An outreach email that could not be delivered: the person who sent it is told (never the creator's address).
create or replace function platform.notify_outreach_email() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.status not in ('bounced', 'failed', 'complained') or new.status = old.status or new.mode <> 'resend' then return new; end if;
  perform platform.notify_user(new.requested_by, new.workspace_id, 'outreach_failed',
    case when new.status = 'complained' then 'A creator marked your email as spam' else 'Your outreach email was not delivered' end,
    'To ' || new.recipient_masked || ': ' || left(new.subject, 120) || '. Check the address or use another contact.',
    '#/dashboard/campaigns', 'outreach_email:' || new.id || ':' || new.status);
  return new;
end
$$;
drop trigger if exists outreach_emails_notify on wp.outreach_emails;
create trigger outreach_emails_notify after update of status on wp.outreach_emails for each row execute function platform.notify_outreach_email();

revoke all on function platform.notify_payment() from public;
revoke all on function platform.notify_subscription() from public;
revoke all on function platform.notify_staff_credits() from public;
revoke all on function platform.notify_outreach_email() from public;
