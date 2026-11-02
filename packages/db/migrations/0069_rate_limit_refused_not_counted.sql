-- Rate limiter self-lock fix (security hardening 2026-11-03). 0034 counted refused hits too, so a client that kept
-- retrying while limited pushed its own estimate up and could stay locked out for as long as it kept trying (one
-- extra hit per retry). Only allowed requests are counted now: a refused hit is taken back inside the same statement,
-- while the row is still locked by the upsert, so concurrent callers can never be over-admitted.

create or replace function platform.rate_limit_hit(p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer) returns integer
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_now timestamptz := clock_timestamp();
  v_epoch double precision := extract(epoch from v_now);
  v_start timestamptz := to_timestamp(floor(v_epoch / p_window_seconds) * p_window_seconds);
  v_elapsed double precision := v_epoch - extract(epoch from v_start);
  v_current integer;
  v_previous integer;
  v_estimate double precision;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'rate_limit_hit: limit and window must be positive';
  end if;
  insert into platform.rate_limit_counters as c (bucket, key_hash, window_start, hits)
    values (p_bucket, p_key_hash, v_start, 1)
    on conflict (bucket, key_hash, window_start) do update set hits = c.hits + 1
    returning hits into v_current;
  select hits into v_previous from platform.rate_limit_counters
    where bucket = p_bucket and key_hash = p_key_hash and window_start = v_start - make_interval(secs => p_window_seconds);
  v_estimate := coalesce(v_previous, 0) * (1 - v_elapsed / p_window_seconds) + v_current;
  if v_estimate <= p_limit then
    return 0;
  end if;
  -- Refused: not counted.
  if v_current > 1 then
    update platform.rate_limit_counters set hits = hits - 1
      where bucket = p_bucket and key_hash = p_key_hash and window_start = v_start;
  else
    delete from platform.rate_limit_counters
      where bucket = p_bucket and key_hash = p_key_hash and window_start = v_start;
  end if;
  -- Retry when the current window ends (the earliest moment the estimate can fall back under the limit for sure).
  return greatest(1, ceil(p_window_seconds - v_elapsed)::integer);
end
$$;

revoke all on function platform.rate_limit_hit(text, text, integer, integer) from public;
grant execute on function platform.rate_limit_hit(text, text, integer, integer) to mushin_worker;
