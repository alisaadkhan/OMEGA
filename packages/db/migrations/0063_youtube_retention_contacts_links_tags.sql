-- YouTube retention: three kinds of YouTube API data the 30-day job did not clear (review 2026-10-29 against the YouTube
-- API Services Developer Policies III.E.4, page updated 2026-10-15): email addresses and phone numbers read from the
-- channel description, links to other profiles read from the channel, and hashtags taken from video titles and
-- descriptions (gcp.creators.tags). Everything else is unchanged from 0060.
-- Known limit: creator_contacts and creator_links carry no platform, so this applies, like the rest of the function, to
-- creators whose primary platform is YouTube. Once creators are linked across platforms, contacts need a platform column.

create or replace function platform.expire_youtube_api_data(p_days integer default 30)
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

  -- 0060: a YouTube profile's country comes from the channel's declared country and description (YouTube API data); a
  -- country the creator confirmed is not YouTube data and stays.
  update gcp.creator_profiles p
  set country = null, country_source = null, country_status = 'unknown', country_confidence = null, country_reason = 'YouTube data older than ' || greatest(p_days, 1) || ' days was cleared',
      country_checked_at = null
  where p.platform = 'youtube'
    and coalesce(p.last_scraped_at, p.created_at) < cutoff
    and p.country_source is distinct from 'creator_confirmed'
    and (p.country is not null or p.country_status <> 'unknown');

  select coalesce(array_agg(distinct c.id), '{}') into stale
  from gcp.creators c
  join gcp.creator_profiles p on p.creator_id = c.id and p.platform = 'youtube'
  where c.primary_platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < cutoff;

  delete from gcp.enrichment_snapshots s where s.creator_id = any(stale);
  -- Evidence rows quote the channel description and record the channel's declared country: YouTube API data too.
  delete from gcp.creator_attribute_evidence e where e.creator_id = any(stale);
  -- 0063: addresses read from the channel description (source 'bio') and links to other profiles read from the channel
  -- are copies of YouTube API data. A contact entered by staff ('staff') is not, and stays. contact_checks cascade;
  -- contact_reveals keep no value, so a workspace's reveal history is unaffected.
  delete from gcp.creator_contacts ct where ct.creator_id = any(stale) and ct.source = 'bio';
  delete from gcp.creator_links l where l.creator_id = any(stale);

  update wp.discovery_results r
  set campaign_fit = null, fit_score = 0, fit_label = 'Needs review'
  where r.creator_id = any(stale) and r.created_at < cutoff and (r.campaign_fit is not null or r.fit_score <> 0);

  insert into gcp.creator_lifecycle_events (creator_id, kind, from_state, to_state, reason, source, action)
  select c.id, 'retention', null, 'youtube_data_expired', 'YouTube API data older than ' || greatest(p_days, 1) || ' days', 'retention_job',
         'cleared derived fields, evidence and snapshots'
  from gcp.creators c
  where c.id = any(stale)
    and (c.display_name <> c.primary_handle or c.avatar_url is not null or c.niches <> '{}' or c.country is distinct from c.confirmed_country
         or c.niche_status is not null or c.platform_country is not null or c.stated_country is not null);

  return query
  with cleared as (
    update gcp.creators c
    set display_name = c.primary_handle, avatar_url = null, avatar_key = null,
        authenticity_score = null, fake_follower_pct = null,
        ai_summary = null, ai_summary_model = null, ai_summary_at = null, ai_summary_source_hash = null,
        -- A country the creator confirmed to Roster is not YouTube data and stays.
        niches = '{}', tags = '{}', city = null, country = c.confirmed_country, assessment_status = null,
        niche_main = null, niche_status = null, niche_confidence = null, niche_assessed_at = null,
        platform_country = null, stated_country = null, country_source = case when c.confirmed_country is null then null else 'creator_confirmed' end,
        country_confidence = case when c.confirmed_country is null then null else 'high' end, country_checked_at = null,
        updated_at = now()
    from gcp.creators old
    where old.id = c.id and c.id = any(stale)
      and (c.display_name <> c.primary_handle or c.avatar_url is not null or c.avatar_key is not null
           or c.authenticity_score is not null or c.fake_follower_pct is not null or c.ai_summary is not null
           or c.niches <> '{}' or c.tags <> '{}' or c.city is not null or c.country is distinct from c.confirmed_country or c.assessment_status is not null
           or c.niche_status is not null or c.platform_country is not null or c.stated_country is not null)
    returning c.id, old.avatar_key
  )
  select x.id, x.avatar_key from cleared x
  union
  select m, null::text from unnest(metrics) m where m not in (select x2.id from cleared x2);
end
$$;
