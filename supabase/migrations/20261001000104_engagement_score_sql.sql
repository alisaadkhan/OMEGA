-- Engagement Score 1.0–10.0 in SQL (owner, 25 Nov: rank and sort by the score, not the raw rate, so YouTube, Instagram
-- and TikTok compare fairly). The same piecewise-linear anchors as @mushin/contracts engagementScore; a test checks the
-- two give the same score for every platform across the range. Null when the rate is unknown.
create or replace function platform.engagement_score(p_rate double precision, p_platform text) returns numeric
  language plpgsql immutable set search_path = pg_catalog as $$
declare
  r double precision[];
  s double precision[];
  i integer;
  v double precision := 10;
begin
  if p_rate is null or p_rate < 0 or p_rate = 'NaN'::double precision then return null; end if;
  case p_platform
    when 'instagram' then r := array[0, 0.1, 0.3, 0.55, 1, 3, 6];
    when 'youtube' then r := array[0, 0.02, 0.08, 0.15, 0.4, 1.15, 2.5];
    when 'tiktok' then r := array[0, 0.09, 0.2, 0.25, 0.6, 2.5, 5];
    else return null;
  end case;
  s := array[1, 2.5, 4.5, 5, 7, 9, 10];
  for i in 2 .. array_length(r, 1) loop
    if p_rate < r[i] then
      v := s[i - 1] + ((p_rate - r[i - 1]) / (r[i] - r[i - 1])) * (s[i] - s[i - 1]);
      exit;
    end if;
  end loop;
  -- Rounded exactly as Math.round(x * 10) / 10 in floating point, so both definitions agree at the halves.
  return (floor(least(10, greatest(1, v)) * 10 + 0.5) / 10)::numeric;
end
$$;
grant execute on function platform.engagement_score(double precision, text) to public;
