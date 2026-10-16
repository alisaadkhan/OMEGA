-- Audit OPS-03 (2026-10-17): alerts reach a person instead of only the logs.
--   process_heartbeats  the worker records that its queue runs (a scheduled job every minute); a stale or missing beat
--                       is a critical alert raised by the API, so a stopped worker is noticed within minutes.
--   alert_events        one-off problems any process reports (credit mismatch, a sign-in identity left behind).
--   alert_deliveries    what was last sent per alert key, so a standing alert is repeated rarely and its end is reported.
-- Messages hold counts and names of systems only: never personal data, contact details or secrets.

create table platform.process_heartbeats (
  process text primary key check (process in ('worker')),
  beat_at timestamptz not null default now()
);

create table platform.alert_events (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_]{1,60}$'),
  severity text not null check (severity in ('warning', 'critical')),
  message text not null check (length(message) between 1 and 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index alert_events_unsent on platform.alert_events (created_at) where sent_at is null;

create table platform.alert_deliveries (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  severity text not null check (severity in ('warning', 'critical')),
  last_sent_at timestamptz not null,
  resolved_at timestamptz
);

-- Like the other platform tables, these are reached only through the worker role (the API uses it via withSystem).
grant select, insert, update on platform.process_heartbeats to mushin_worker;
grant select, insert, update, delete on platform.alert_events, platform.alert_deliveries to mushin_worker;

create or replace function platform.staff_alerts() returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'outboxPending', (select count(*) from platform.outbox where published_at is null),
    'outboxOldestSeconds', (select extract(epoch from now() - min(created_at))::int from platform.outbox where published_at is null),
    'stuckJobs', (select count(*) from wp.discovery_jobs where status in ('queued', 'running') and created_at < now() - interval '30 minutes'),
    'failedJobs1h', (select count(*) from wp.discovery_jobs where status = 'failed' and finished_at > now() - interval '1 hour'),
    'providerErrors1h', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
      select provider, count(*) n from platform.provider_calls where status = 'error' and created_at > now() - interval '1 hour' group by 1) e),
    'providerCalls1h', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
      select provider, count(*) n from platform.provider_calls where created_at > now() - interval '1 hour' group by 1) c),
    'monthSpendUsd', (select coalesce(jsonb_object_agg(provider, s), '{}'::jsonb) from (
      select provider, round(sum(cost_usd)::numeric, 4) s from platform.provider_calls where created_at >= date_trunc('month', now()) group by 1) m),
    'pausedProviders', (select coalesce(jsonb_agg(provider order by provider), '[]'::jsonb) from platform.provider_controls where paused),
    'pendingApprovals', (select count(*) from staff.approvals where status = 'pending' and expires_at > now()),
    'pendingRemovals', (select count(*) from gcp.removal_requests where status = 'received'),
    'oldestRemovalDays', (select extract(day from now() - min(created_at))::int from gcp.removal_requests where status = 'received'),
    'workerHeartbeatSeconds', (select greatest(extract(epoch from now() - beat_at)::int, 0) from platform.process_heartbeats where process = 'worker')
  )
$$;
revoke all on function platform.staff_alerts() from public;
grant execute on function platform.staff_alerts() to mushin_worker;
