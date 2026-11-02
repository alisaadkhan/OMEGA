-- Per-profile country (owner instruction 2026-10-27: the customer catalogue shows only Pakistani profiles, each platform
-- profile judged on its own evidence). Nothing is deleted: a profile whose country is foreign, unknown, conflicting or
-- stale is excluded from customer search and new list/campaign additions by the eligibility rule (elig-2) and stays
-- reviewable by staff. country_reason records why, for audit.
alter table gcp.creator_profiles
  add column country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column country_source text check (country_source is null or country_source in ('creator_confirmed', 'creator_stated', 'platform_declared')),
  add column country_status text not null default 'unknown' check (country_status in ('pakistan', 'foreign', 'unknown', 'conflicting')),
  add column country_reason text check (country_reason is null or length(country_reason) <= 300),
  add column country_confidence text check (country_confidence is null or country_confidence in ('high', 'medium', 'low')),
  add column country_checked_at timestamptz,
  add constraint creator_profiles_country_status_consistent check (
    (country_status in ('pakistan', 'foreign') and country is not null and country_source is not null)
    or (country_status in ('unknown', 'conflicting') and country is null and country_source is null));

grant update (country, country_source, country_status, country_reason, country_confidence, country_checked_at) on gcp.creator_profiles to mushin_worker;

-- Retention: same function as 0057, plus the YouTube profile's derived country.
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
        niches = '{}', city = null, country = c.confirmed_country, assessment_status = null,
        niche_main = null, niche_status = null, niche_confidence = null, niche_assessed_at = null,
        platform_country = null, stated_country = null, country_source = case when c.confirmed_country is null then null else 'creator_confirmed' end,
        country_confidence = case when c.confirmed_country is null then null else 'high' end, country_checked_at = null,
        updated_at = now()
    from gcp.creators old
    where old.id = c.id and c.id = any(stale)
      and (c.display_name <> c.primary_handle or c.avatar_url is not null or c.avatar_key is not null
           or c.authenticity_score is not null or c.fake_follower_pct is not null or c.ai_summary is not null
           or c.niches <> '{}' or c.city is not null or c.country is distinct from c.confirmed_country or c.assessment_status is not null
           or c.niche_status is not null or c.platform_country is not null or c.stated_country is not null)
    returning c.id, old.avatar_key
  )
  select x.id, x.avatar_key from cleared x
  union
  select m, null::text from unnest(metrics) m where m not in (select x2.id from cleared x2);
end
$$;
revoke all on function platform.expire_youtube_api_data(integer) from public;
grant execute on function platform.expire_youtube_api_data(integer) to mushin_worker;

-- Erasure removes a creator's lifecycle history (states and reasons about that person), keeping only the record that
-- the removal happened. The table stays append-only for the app roles; only this function deletes from it.
create function platform.erase_creator_lifecycle(p_creator_id uuid) returns void
  language sql security definer set search_path = pg_catalog as $$
  delete from gcp.creator_lifecycle_events where creator_id = p_creator_id and kind <> 'removal';
$$;
revoke all on function platform.erase_creator_lifecycle(uuid) from public;
grant execute on function platform.erase_creator_lifecycle(uuid) to mushin_worker;
