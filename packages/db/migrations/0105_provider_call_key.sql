-- Which API key served each provider call (owner, 25 Nov: "show every API, Groq 1 2 3, Apify 1 2 3"): 1 for the first
-- key, 2 for the next, ...; null when the provider has a single key. The key itself is never stored.
alter table platform.provider_calls add column if not exists key_slot smallint check (key_slot is null or key_slot between 1 and 20);
create index if not exists provider_calls_provider_slot_created_idx on platform.provider_calls (provider, key_slot, created_at desc);

-- The requests made through one API key, with the account, the person and the job's search (staff console; the
-- system role cannot read workspace rows, as for platform.staff_jobs). Newest first.
create or replace function platform.staff_api_calls(p_provider text, p_slot integer, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.at desc), '[]'::jsonb) from (
    select c.created_at at, c.operation, c.model, c.status, c.error_code "errorCode", c.cost_usd::float8 "costUsd", c.latency_ms "latencyMs",
      w.id "workspaceId", w.name "workspaceName", u.email "userEmail",
      j.id "jobId", j.kind "jobKind", j.status "jobStatus", j.search->>'text' "jobSearch", coalesce(j.handle, j.input_url) "jobTarget"
    from platform.provider_calls c
    left join wp.workspaces w on w.id = c.workspace_id
    left join wp.discovery_jobs j on j.id::text = c.job_id::text
    left join wp.users u on u.id = j.requested_by
    where c.provider = p_provider and (p_slot is null or coalesce(c.key_slot, 1) = p_slot)
    order by c.created_at desc limit least(greatest(p_limit, 1), 500)) t
$$;

-- Who started each job (staff jobs list).
create or replace function platform.staff_job_requesters(p_ids uuid[]) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_object_agg(j.id, u.email), '{}'::jsonb)
  from wp.discovery_jobs j join wp.users u on u.id = j.requested_by where j.id = any(p_ids)
$$;

revoke all on function platform.staff_api_calls(text, integer, integer) from public;
revoke all on function platform.staff_job_requesters(uuid[]) from public;
grant execute on function platform.staff_api_calls(text, integer, integer) to mushin_worker;
grant execute on function platform.staff_job_requesters(uuid[]) to mushin_worker;
