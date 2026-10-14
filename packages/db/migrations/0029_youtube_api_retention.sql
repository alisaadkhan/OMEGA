-- YouTube API Services retention (DATA-004): non-authorised API data may not be stored beyond 30 calendar days unless it
-- is refreshed. Refreshing calls the YouTube API (quota), so until a refresh routine is authorised this removes what was
-- observed and not refreshed in time: metric history rows, observed counts and bio on the YouTube profile, and the
-- MUSHIN-derived authenticity figures on YouTube-primary creators. Raw payloads already expire after 30 days (pipeline).
-- Left in place pending an owner decision: the channel's handle, URL and display name (needed to identify the creator).
create function platform.expire_youtube_api_data(p_days integer default 30) returns uuid[]
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  affected uuid[];
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
  select coalesce(array_agg(distinct creator_id), '{}') into affected from expired;

  update gcp.creators c set authenticity_score = null, fake_follower_pct = null, updated_at = now()
  where c.id = any(affected) and c.primary_platform = 'youtube';

  return affected;
end
$$;
revoke all on function platform.expire_youtube_api_data(integer) from public;
grant execute on function platform.expire_youtube_api_data(integer) to mushin_worker;
