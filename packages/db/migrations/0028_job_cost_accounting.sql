-- Direct provider cost per discovery job for the staff job inspector (owner direction 2026-10-14, part B). Provider
-- calls already carry the job, model, tokens, latency, status and reported or estimated USD cost; this adds the per-model
-- detail and a summary next to what the customer was charged. Credits are customer prices, never provider cost.
create or replace function platform.staff_job(p_id uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'progress', j.progress,
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('stage', d.stage, 'decision', d.decision, 'reason', d.reason, 'count', d.n) order by d.n desc)
      from (select stage, decision, reason, count(*) n from wp.discovery_candidates where job_id = j.id group by 1, 2, 3) d), '[]'::jsonb),
    'providerCalls', coalesce((select jsonb_agg(jsonb_build_object(
        'provider', c.provider, 'operation', c.operation, 'model', c.model, 'status', c.status, 'errorCode', c.error_code,
        'calls', c.n, 'tokensIn', c.tokens_in, 'tokensOut', c.tokens_out, 'units', c.units, 'avgLatencyMs', c.latency, 'costUsd', c.cost)
        order by c.cost desc, c.provider, c.operation)
      from (select provider, operation, model, status, error_code, count(*) n, coalesce(sum(tokens_in), 0) tokens_in,
              coalesce(sum(tokens_out), 0) tokens_out, coalesce(sum(units), 0) units, round(avg(latency_ms)) latency, sum(cost_usd) cost
            from platform.provider_calls where job_id = j.id::text group by 1, 2, 3, 4, 5) c), '[]'::jsonb),
    'cost', (select jsonb_build_object(
        'totalUsd', coalesce(sum(p.cost_usd), 0),
        'failedCalls', count(*) filter (where p.status = 'error'),
        'attempts', j.attempts,
        'newCreators', (select count(*) from wp.discovery_results r where r.job_id = j.id and r.is_new),
        'creditsCharged', j.credits_charged,
        'costPerNewCreatorUsd', case when (select count(*) from wp.discovery_results r where r.job_id = j.id and r.is_new) > 0
          then coalesce(sum(p.cost_usd), 0) / (select count(*) from wp.discovery_results r where r.job_id = j.id and r.is_new) end)
      from platform.provider_calls p where p.job_id = j.id::text)
  ) from wp.discovery_jobs j where j.id = p_id
$$;
