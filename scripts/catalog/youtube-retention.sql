-- Field-level YouTube data inventory for a local catalogue copy: what is stored, when it was fetched, and when the
-- 30-day YouTube API rule (Developer Policies III.E.4) expires it. Read-only; aggregates only (no handles or text).
--   psql -h localhost -p 54330 -U postgres -d mushin_catalog_v3 -v ON_ERROR_STOP=1 -f scripts/catalog/youtube-retention.sql
begin transaction read only;

\echo '== 1. YouTube profile fields: rows holding a value, and fetch dates (clock = coalesce(last_scraped_at, created_at))'
select count(*) profiles,
  count(followers) subscriber_count, count(posts) video_count, count(avg_views) avg_views, count(engagement_rate) engagement_rate_derived,
  count(bio) description, count(last_post_at) last_upload_date, count(country) country_decision,
  min(coalesce(last_scraped_at, created_at))::date oldest_fetch, max(coalesce(last_scraped_at, created_at))::date newest_fetch,
  (min(coalesce(last_scraped_at, created_at)) + interval '30 days')::date first_expiry,
  (max(coalesce(last_scraped_at, created_at)) + interval '30 days')::date last_expiry
from gcp.creator_profiles where platform = 'youtube';

\echo '== 2. Expiry calendar by day (all YouTube profiles; eligible ones in the second column)'
select (coalesce(p.last_scraped_at, p.created_at) + interval '30 days')::date expires_on, count(*) profiles,
  count(*) filter (where 'youtube' = any(coalesce(d.qualifying_platforms, '{}')::text[])) eligible_now
from gcp.creator_profiles p left join gcp.creator_search_documents d on d.creator_id = p.creator_id
where p.platform = 'youtube' group by 1 order by 1;

\echo '== 3. Creator-level fields of YouTube-primary creators that come from the channel (title, thumbnail, derived)'
select count(*) creators,
  count(*) filter (where display_name <> primary_handle) channel_title_as_name,
  count(avatar_url) + count(avatar_key) - count(*) filter (where avatar_url is not null and avatar_key is not null) thumbnail,
  count(*) filter (where niches <> '{}') niche_tags_derived, count(niche_main) main_niche_derived, count(city) city_derived,
  count(ai_summary) ai_summary_derived, count(platform_country) channel_declared_country, count(stated_country) description_country,
  count(confirmed_country) creator_confirmed_country, count(*) filter (where tags <> '{}') tags, count(*) filter (where name_variants <> '{}') name_variants
from gcp.creators where primary_platform = 'youtube';

\echo '== 4. Rows in other tables tied to YouTube-primary creators'
select 'attribute evidence (quotes description/title)' what, count(*) from gcp.creator_attribute_evidence e join gcp.creators c on c.id = e.creator_id where c.primary_platform = 'youtube'
union all select 'enrichment snapshots', count(*) from gcp.enrichment_snapshots s join gcp.creators c on c.id = s.creator_id where c.primary_platform = 'youtube'
union all select 'metric snapshots (statistics history)', count(*) from gcp.profile_metric_snapshots s join gcp.creator_profiles p on p.id = s.profile_id where p.platform = 'youtube'
union all select 'raw API payloads', count(*) from platform.raw_payloads where platform = 'youtube'
union all select 'raw payloads past their delete_after', count(*) from platform.raw_payloads where platform = 'youtube' and delete_after < now()
union all select 'contacts on YouTube-primary creators', count(*) from gcp.creator_contacts ct join gcp.creators c on c.id = ct.creator_id where c.primary_platform = 'youtube'
union all select 'links to other profiles on YouTube-primary creators', count(*) from gcp.creator_links l join gcp.creators c on c.id = l.creator_id where c.primary_platform = 'youtube'
union all select 'audience estimates (from comments)', count(*) from gcp.audience_estimates a join gcp.creators c on c.id = a.creator_id where c.primary_platform = 'youtube'
union all select 'search documents of YouTube-primary creators', count(*) from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id where c.primary_platform = 'youtube';

\echo '== 5. Raw payload deletion dates'
select min(delete_after)::date first_delete, max(delete_after)::date last_delete, max(delete_after - fetched_at) longest_kept
from platform.raw_payloads where platform = 'youtube';

\echo '== 6. Contacts and links on YouTube creators, by source'
select 'contact' kind, coalesce(ct.source::text, '-') source, count(*) from gcp.creator_contacts ct join gcp.creators c on c.id = ct.creator_id where c.primary_platform = 'youtube' group by 1, 2
union all
select 'link', coalesce(l.source::text, '-'), count(*) from gcp.creator_links l join gcp.creators c on c.id = l.creator_id where c.primary_platform = 'youtube' group by 1, 2
order by 1, 3 desc;

rollback;
