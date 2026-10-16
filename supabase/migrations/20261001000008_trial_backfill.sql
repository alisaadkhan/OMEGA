-- Workspaces provisioned before billing existed have no subscription, so they could neither spend credits nor
-- start a trial. Give each of them the trial that provisioning now starts (billing startTrial): a trialing
-- subscription, the trial credit lot with its ledger grant, and the trial's due work. Workspaces that already have
-- a subscription are untouched, so running this again changes nothing.
with settings as (
  select trial_days, trial_credits, trial_ending_notice_days from platform.billing_settings
),
missing as (
  select w.id as workspace_id,
         now() + make_interval(days => s.trial_days) as ends_at,
         s.trial_credits as credits,
         s.trial_ending_notice_days as notice_days
  from wp.workspaces w cross join settings s
  where not exists (select 1 from wp.subscriptions x where x.workspace_id = w.id)
),
subs as (
  insert into wp.subscriptions (workspace_id, trial_ends_at)
  select workspace_id, ends_at from missing
  returning workspace_id
),
lots as (
  insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at)
  select workspace_id, 'trial', credits, credits, ends_at from missing
  returning id, workspace_id, amount
),
grants as (
  insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, source_ref, note)
  select workspace_id, amount, 'grant', id, 'trial:' || workspace_id::text, 'Free trial credits' from lots
  returning workspace_id
)
insert into platform.billing_schedule (workspace_id, job, due_at)
select m.workspace_id, j.job, j.due_at
from missing m
cross join lateral (values
  ('end_trials', m.ends_at),
  ('trial_notices', m.ends_at - make_interval(days => m.notice_days)),
  ('expire_lots', m.ends_at),
  ('reconcile', now() + interval '1 day')
) as j(job, due_at)
on conflict (workspace_id, job) do update set due_at = least(platform.billing_schedule.due_at, excluded.due_at);
