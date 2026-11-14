-- Contacts and links from video descriptions / post captions (owner unified plan 2026-11-14, Phase 4.1). When the bio or
-- About section has no email or phone, the last 5 videos' descriptions (YouTube) or captions (Instagram, TikTok) are read;
-- what was found there is recorded with its own source, so staff and customers see where it came from.
alter table gcp.creator_links drop constraint if exists creator_links_source_check;
alter table gcp.creator_links add constraint creator_links_source_check check (source in ('bio', 'profile_link', 'video_description', 'post_caption'));

-- Location from recent video descriptions / captions (Phase 4.2), kept as evidence on the profile so every later country
-- decision can read it: an explicit Pakistani residence statement in one of the last 5, or Pakistani evidence in 2+.
alter table gcp.creator_profiles add column caption_country_evidence text check (caption_country_evidence is null or char_length(caption_country_evidence) <= 300);

-- YouTube retention, regenerated from 0084 (security review): caption evidence and contacts read from YouTube video
-- descriptions are YouTube API data too, cleared with the rest after 30 days.
create or replace function platform.expire_youtube_api_data(p_days integer default 30)
  returns table (creator_id uuid, avatar_key text)
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  stale uuid[];
  metrics uuid[];
  photo_creators uuid[];
  photo_keys text[];
begin
  delete from gcp.profile_metric_snapshots s
  using gcp.creator_profiles p
  where s.profile_id = p.id and p.platform = 'youtube' and s.captured_at < cutoff;

  with expired as (
    update gcp.creator_profiles p
    set followers = null, following = null, posts = null, engagement_rate = null, avg_likes = null, avg_comments = null,
        avg_views = null, bio = null, followers_updated_at = null, engagement_updated_at = null,
        median_views = null, median_engagement_rate = null, performance_views_sample = null, performance_engagement_sample = null,
        performance_format = null, performance_from = null, performance_to = null, performance_at = null, post_locations = null,
        avatar_url = null, avatar_key = null, caption_country_evidence = null, updated_at = now()
    from gcp.creator_profiles old
    where old.id = p.id and p.platform = 'youtube'
      and coalesce(p.last_scraped_at, p.created_at) < cutoff
      and (p.followers is not null or p.following is not null or p.posts is not null or p.engagement_rate is not null
           or p.avg_likes is not null or p.avg_comments is not null or p.avg_views is not null or p.bio is not null
           or p.median_views is not null or p.median_engagement_rate is not null or p.performance_at is not null or p.post_locations is not null
           or p.avatar_url is not null or p.caption_country_evidence is not null)
    returning p.creator_id, old.avatar_key
  )
  -- The cleared profile photos' files are returned too, so the job removes them from storage (security review).
  select coalesce(array_agg(distinct e.creator_id), '{}'), coalesce(array_agg(e.creator_id) filter (where e.avatar_key is not null), '{}'),
         coalesce(array_agg(e.avatar_key) filter (where e.avatar_key is not null), '{}')
    into metrics, photo_creators, photo_keys from expired e;

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
  delete from gcp.creator_contacts ct where ct.creator_id = any(stale) and ct.source in ('bio', 'video_description');
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
         or c.niche_status is not null or c.platform_country is not null or c.stated_country is not null
           or c.niche_source is not null or (c.account_type is not null and c.account_type_source is distinct from 'staff'));

  return query
  with cleared as (
    update gcp.creators c
    set display_name = c.primary_handle, avatar_url = null, avatar_key = null,
        authenticity_score = null, fake_follower_pct = null,
        ai_summary = null, ai_summary_model = null, ai_summary_at = null, ai_summary_source_hash = null,
        -- A country the creator confirmed to Roster is not YouTube data and stays.
        niches = '{}', tags = '{}', city = null, country = c.confirmed_country, assessment_status = null,
        niche_main = null, niche_status = null, niche_confidence = null, niche_assessed_at = null, niche_source = null, niche_posts_assessed = null,
        -- 0078: an account type MUSHIN read from the channel is YouTube data; a staff decision is not, and stays.
        account_type = case when c.account_type_source = 'staff' then c.account_type else null end,
        account_type_source = case when c.account_type_source = 'staff' then c.account_type_source else null end,
        account_type_confidence = case when c.account_type_source = 'staff' then c.account_type_confidence else null end,
        account_type_evidence = case when c.account_type_source = 'staff' then c.account_type_evidence else null end,
        account_type_assessed_at = case when c.account_type_source = 'staff' then c.account_type_assessed_at else null end,
        platform_country = null, stated_country = null, country_source = case when c.confirmed_country is null then null else 'creator_confirmed' end,
        country_confidence = case when c.confirmed_country is null then null else 'high' end, country_checked_at = null,
        updated_at = now()
    from gcp.creators old
    where old.id = c.id and c.id = any(stale)
      and (c.display_name <> c.primary_handle or c.avatar_url is not null or c.avatar_key is not null
           or c.authenticity_score is not null or c.fake_follower_pct is not null or c.ai_summary is not null
           or c.niches <> '{}' or c.tags <> '{}' or c.city is not null or c.country is distinct from c.confirmed_country or c.assessment_status is not null
           or c.niche_status is not null or c.platform_country is not null or c.stated_country is not null
           or c.niche_source is not null or (c.account_type is not null and c.account_type_source is distinct from 'staff'))
    returning c.id, old.avatar_key
  )
  select x.id, x.avatar_key from cleared x
  union
  select m, null::text from unnest(metrics) m where m not in (select x2.id from cleared x2)
  union
  select pc, pk from unnest(photo_creators, photo_keys) as f(pc, pk);
end
$$;
