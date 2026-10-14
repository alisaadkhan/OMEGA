-- YouTube API Services retention, second step (DATA-004, owner decision 2026-10-14). The Developer Policies
-- (III.E.4.c/d, checked 2026-10-14) allow API Data to be kept for at most 30 calendar days unless refreshed, list no
-- exemption for channel identity, and forbid derived data or metrics made from API Data (III.E.4.h). So, beyond what
-- 0029 cleared, a YouTube-primary creator whose YouTube profile was not refreshed within 30 days also loses:
--   * the API-sourced identity: display name (replaced by the handle) and avatar (row and stored image);
--   * everything MUSHIN derived from the API data: AI summary, niches, city, country, assessment status and the stored
--     assessments (enrichment snapshots), and Campaign Fit evidence on older Live Discovery results.
-- Kept: the profile's handle and canonical URL. MUSHIN holds them from sources outside the API (the Google result link
-- that found the channel, or the link a customer pasted), and they are needed to honour removal requests and avoid
-- re-adding suppressed channels. That reasoning holds only for identifiers obtained outside the API; it is recorded in
-- docs/readiness/progress.md (YouTube retention) for legal review.
drop function platform.expire_youtube_api_data(integer);

create function platform.expire_youtube_api_data(p_days integer default 30)
  returns table (creator_id uuid, avatar_key text)
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  stale uuid[];
  metrics uuid[];
begin
  delete from gcp.profile_metric_snapshots s
  using gcp.creator_profiles p
  where s.profile_id = p.id and p.platform = 'youtube' and s.captured_at < cutoff;

  with expired as (
    update gcp.creator_profiles p
    set followers = null, following = null, posts = null, engagement_rate = null, avg_likes = null, avg_comments = null,
        avg_views = null, bio = null, followers_updated_at = null, engagement_updated_at = null, updated_at = now()
    where p.platform = 'youtube'
      and coalesce(p.last_scraped_at, p.created_at) < cutoff
      and (p.followers is not null or p.following is not null or p.posts is not null or p.engagement_rate is not null
           or p.avg_likes is not null or p.avg_comments is not null or p.avg_views is not null or p.bio is not null)
    returning p.creator_id
  )
  select coalesce(array_agg(distinct e.creator_id), '{}') into metrics from expired e;

  -- YouTube-primary creators whose YouTube profile is past the window, whatever was cleared before.
  select coalesce(array_agg(distinct c.id), '{}') into stale
  from gcp.creators c
  join gcp.creator_profiles p on p.creator_id = c.id and p.platform = 'youtube'
  where c.primary_platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < cutoff;

  delete from gcp.enrichment_snapshots s where s.creator_id = any(stale);

  update wp.discovery_results r
  set campaign_fit = null, fit_score = 0, fit_label = 'Needs review'
  where r.creator_id = any(stale) and r.created_at < cutoff and (r.campaign_fit is not null or r.fit_score <> 0);

  return query
  with cleared as (
    update gcp.creators c
    set display_name = c.primary_handle, avatar_url = null, avatar_key = null,
        authenticity_score = null, fake_follower_pct = null,
        ai_summary = null, ai_summary_model = null, ai_summary_at = null, ai_summary_source_hash = null,
        niches = '{}', city = null, country = null, assessment_status = null, updated_at = now()
    from gcp.creators old
    where old.id = c.id and c.id = any(stale)
      and (c.display_name <> c.primary_handle or c.avatar_url is not null or c.avatar_key is not null
           or c.authenticity_score is not null or c.fake_follower_pct is not null or c.ai_summary is not null
           or c.niches <> '{}' or c.city is not null or c.country is not null or c.assessment_status is not null)
    returning c.id, old.avatar_key
  )
  select x.id, x.avatar_key from cleared x
  union
  select m, null::text from unnest(metrics) m where m not in (select x2.id from cleared x2);
end
$$;
revoke all on function platform.expire_youtube_api_data(integer) from public;
grant execute on function platform.expire_youtube_api_data(integer) to mushin_worker;
