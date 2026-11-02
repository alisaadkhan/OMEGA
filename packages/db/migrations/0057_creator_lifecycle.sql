-- Creator lifecycle (owner instruction 2026-10-26). Kept apart: creator status (gcp.creators.status), each platform
-- profile's availability (here), eligibility per profile (computed by the policy in eligibility.ts, never stored as a
-- deletion), location confidence (0054 columns) and data retention. Hiding is never deletion.
--
-- Availability of one platform profile, as the providers last showed it:
--   available               the last fetch returned the profile
--   temporarily_unavailable a provider failed (timeout, outage, rate limit): nothing is concluded about the account
--   missing_unconfirmed     the provider said "not found" once: re-checked before anything is concluded
--   not_found               "not found" seen at least twice, at least 24 hours apart: the profile no longer qualifies
--   private                 the account is private: no data can be read
alter table gcp.creator_profiles
  add column availability text not null default 'available'
    check (availability in ('available', 'temporarily_unavailable', 'missing_unconfirmed', 'not_found', 'private')),
  add column availability_checked_at timestamptz,
  add column missing_since timestamptz;

-- Every lifecycle transition: what changed, why, from which source, and what was done. Append-only for the app roles.
create table gcp.creator_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  profile_id uuid,
  kind text not null check (kind in ('availability', 'retention', 'location', 'removal', 'eligibility')),
  from_state text,
  to_state text not null check (length(to_state) between 1 and 60),
  reason text not null check (length(reason) between 1 and 300),
  source text not null check (source in ('enrichment', 'refresh_job', 'lifecycle_sweep', 'retention_job', 'staff', 'backfill')),
  action text not null check (length(action) between 1 and 120),
  created_at timestamptz not null default now()
);
create index creator_lifecycle_events_creator on gcp.creator_lifecycle_events (creator_id, created_at desc);
grant select, insert on gcp.creator_lifecycle_events to mushin_worker;
grant select on gcp.creator_lifecycle_events to mushin_app;
grant update (availability, availability_checked_at, missing_since) on gcp.creator_profiles to mushin_worker;

-- YouTube API data retention (30 days) applies to everything derived from it, including the 0054 niche and country
-- fields and the evidence rows that quote a channel description. Same function as 0031, plus those and an event row.
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
