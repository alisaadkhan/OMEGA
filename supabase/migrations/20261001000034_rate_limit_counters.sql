-- Rate-limit counters in PostgreSQL (RATE-001; Supabase migration map §5). Replaces the Upstash/in-memory limiter when
-- RATE_LIMIT_STORE=postgres (the default when Upstash is not configured). Counters are disposable, so the table is
-- unlogged: a crash empties it, which only resets the current windows. Keys are SHA-256 hashes computed by the API.

create unlogged table platform.rate_limit_counters (
  bucket text not null check (bucket ~ '^[a-zA-Z]{1,32}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (bucket, key_hash, window_start)
);

-- Counts one hit and returns 0 when it is allowed, otherwise the seconds until it would be. The limit is a sliding
-- window estimated from the current fixed window plus the previous window weighted by how much of it still overlaps
-- (the method Upstash's sliding window uses). Refused hits are counted too, so hammering does not open the limit early.
create function platform.rate_limit_hit(p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer) returns integer
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
  -- Retry when the current window ends (the earliest moment the estimate can fall back under the limit for sure).
  return greatest(1, ceil(p_window_seconds - v_elapsed)::integer);
end
$$;

-- Old windows are useless after one window; anything older than a day is removed by the nightly purge.
create function platform.rate_limit_purge() returns integer
  language sql security definer set search_path = pg_catalog as $$
  with d as (delete from platform.rate_limit_counters where window_start < now() - interval '1 day' returning 1)
  select count(*)::integer from d
$$;

revoke all on table platform.rate_limit_counters from public;
revoke all on function platform.rate_limit_hit(text, text, integer, integer) from public;
revoke all on function platform.rate_limit_purge() from public;
grant execute on function platform.rate_limit_hit(text, text, integer, integer) to mushin_worker;
grant execute on function platform.rate_limit_purge() to mushin_worker;
