-- Provider status for operations (owner instruction 2026-10-26). The worker records, per provider, whether it is
-- configured (never a secret: only facts such as the model name) and a usage/limit pair only when one is actually known:
-- the provider reported it (Apify account limits) or it is Roster's own configured limit (Serper monthly searches).
-- No remaining balance is ever estimated. Staff read it through the staff console; alerts flag authentication failures,
-- low or exhausted quota and failed checks.
create table platform.provider_status (
  provider text primary key check (provider ~ '^[a-z]{2,20}$'),
  configured boolean not null,
  detail jsonb not null default '{}'::jsonb,
  quota_used numeric check (quota_used is null or quota_used >= 0),
  quota_limit numeric check (quota_limit is null or quota_limit >= 0),
  quota_unit text check (quota_unit is null or quota_unit in ('usd', 'searches')),
  quota_source text check (quota_source is null or length(quota_source) <= 120),
  check_error text check (check_error is null or check_error ~ '^[a-z0-9_]{1,40}$'),
  checked_at timestamptz not null default now(),
  check ((quota_used is null) = (quota_limit is null) and (quota_limit is null) = (quota_unit is null))
);
grant select, insert, update on platform.provider_status to mushin_worker;

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
    -- Rejected credentials (HTTP 401/403) in the last hour: a key was revoked, mistyped or lost access.
    'providerAuthErrors1h', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
      select provider, count(*) n from platform.provider_calls where status = 'error' and error_code in ('http_401', 'http_403')
        and created_at > now() - interval '1 hour' group by 1) a),
    'monthSpendUsd', (select coalesce(jsonb_object_agg(provider, s), '{}'::jsonb) from (
      select provider, round(sum(cost_usd)::numeric, 4) s from platform.provider_calls where created_at >= date_trunc('month', now()) group by 1) m),
    'pausedProviders', (select coalesce(jsonb_agg(provider order by provider), '[]'::jsonb) from platform.provider_controls where paused),
    'providerStatus', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider', provider, 'configured', configured, 'quotaUsed', quota_used, 'quotaLimit', quota_limit, 'quotaUnit', quota_unit,
        'checkError', check_error, 'checkedSecondsAgo', greatest(extract(epoch from now() - checked_at)::int, 0)) order by provider), '[]'::jsonb)
      from platform.provider_status),
    'pendingApprovals', (select count(*) from staff.approvals where status = 'pending' and expires_at > now()),
    'pendingRemovals', (select count(*) from gcp.removal_requests where status = 'received'),
    'oldestRemovalDays', (select extract(day from now() - min(created_at))::int from gcp.removal_requests where status = 'received'),
    'workerHeartbeatSeconds', (select greatest(extract(epoch from now() - beat_at)::int, 0) from platform.process_heartbeats where process = 'worker')
  )
$$;
revoke all on function platform.staff_alerts() from public;
grant execute on function platform.staff_alerts() to mushin_worker;
