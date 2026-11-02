-- Creator-supply funnel for a local catalogue copy. Read-only; aggregates only (no handles, bios or contacts).
--   psql -h localhost -p 54330 -U postgres -d mushin_catalog_v3 -v ON_ERROR_STOP=1 -f scripts/catalog/funnel.sql
-- Windows match apps/api/src/modules/creators/eligibility.ts (DEFAULT_ELIGIBILITY): followers 10,000 counted within 90
-- days, no post older than 90 days (unknown activity only flags), country Pakistan checked within 365 days.
begin transaction read only;

\echo '== 1. Funnel per platform (each stage includes the ones before it)'
with p as (
  select pr.*, d.qualifying_platforms
  from gcp.creator_profiles pr join gcp.creators c on c.id = pr.creator_id
  left join gcp.creator_search_documents d on d.creator_id = pr.creator_id
  where c.status = 'active'
), s as (
  select platform,
    true as s1_profile,
    followers is not null as s2_known,
    followers is not null and followers_updated_at > now() - interval '90 days' as s3_fresh,
    followers >= 10000 and followers_updated_at > now() - interval '90 days' as s4_10k,
    coalesce(availability, 'available') not in ('not_found', 'private') and (last_post_at is null or last_post_at > now() - interval '90 days') as active_available,
    country_status = 'pakistan' as pk,
    platform::text = any(coalesce(qualifying_platforms, '{}')::text[]) as eligible_doc
  from p
)
select platform,
  count(*) profiles,
  count(*) filter (where s2_known) followers_known,
  count(*) filter (where s3_fresh) count_fresh_90d,
  count(*) filter (where s4_10k) fresh_10k,
  count(*) filter (where s4_10k and active_available) plus_active_available,
  count(*) filter (where s4_10k and active_available and pk) plus_pakistan,
  count(*) filter (where eligible_doc) eligible_in_search_doc
from s group by platform order by platform;

\echo '== 2. Near misses: fresh 10k, active and available, failing only on country'
select platform, coalesce(country_status::text, 'null') country_status, count(*)
from gcp.creator_profiles
where followers >= 10000 and followers_updated_at > now() - interval '90 days'
  and coalesce(availability, 'available') not in ('not_found', 'private')
  and (last_post_at is null or last_post_at > now() - interval '90 days')
  and country_status is distinct from 'pakistan'
group by 1, 2 order by 1, 2;

\echo '== 3. Country by platform, status and source'
select platform, country_status, coalesce(country_source::text, '-') source, coalesce(country_confidence::text, '-') confidence, count(*)
from gcp.creator_profiles group by 1, 2, 3, 4 order by 1, 2, 3, 4;

\echo '== 4. Decided countries with no check time (never become stale under the current rule)'
select platform, country_status, count(*) from gcp.creator_profiles
where country_status in ('pakistan', 'foreign', 'conflicting') and country_checked_at is null group by 1, 2;

\echo '== 5. Follower-count age of fresh 10k profiles: days until the 90-day window closes'
select platform,
  count(*) filter (where followers_updated_at + interval '90 days' < now() + interval '7 days') within_7d,
  count(*) filter (where followers_updated_at + interval '90 days' < now() + interval '30 days') within_30d,
  count(*) filter (where followers_updated_at + interval '90 days' < now() + interval '60 days') within_60d,
  min(followers_updated_at)::date oldest_count, max(followers_updated_at)::date newest_count
from gcp.creator_profiles where followers >= 10000 and followers_updated_at > now() - interval '90 days' group by 1 order by 1;

\echo '== 6. YouTube retention calendar: profiles whose stored data the 30-day job would clear, by week (eligible in search doc only)'
select date_trunc('week', coalesce(pr.last_scraped_at, pr.created_at) + interval '30 days')::date clears_week, pr.country_source, count(*)
from gcp.creator_profiles pr join gcp.creator_search_documents d on d.creator_id = pr.creator_id
where pr.platform = 'youtube' and 'youtube' = any(d.qualifying_platforms::text[])
group by 1, 2 order by 1, 2;

\echo '== 7. Has the YouTube retention job ever cleared data in this database?'
select count(*) cleared_by_retention from gcp.creator_profiles where country_reason like 'YouTube data older than%';

\echo '== 8. Search projection: creators without a document, documents without an active creator, eligibility rule versions'
select (select count(*) from gcp.creators c where c.status = 'active' and not exists (select 1 from gcp.creator_search_documents d where d.creator_id = c.id)) active_without_doc,
       (select count(*) from gcp.creator_search_documents d where not exists (select 1 from gcp.creators c where c.id = d.creator_id and c.status = 'active')) doc_without_active_creator,
       (select string_agg(distinct coalesce(eligibility_version, 'null'), ',') from gcp.creator_search_documents) versions;
\echo '   active creators without a document, by follower band and country status'
select pr.platform, case when pr.followers is null then 'unknown' when pr.followers >= 10000 then '>=10k' else '<10k' end band, pr.country_status, count(*)
from gcp.creators c join gcp.creator_profiles pr on pr.creator_id = c.id
where c.status = 'active' and not exists (select 1 from gcp.creator_search_documents d where d.creator_id = c.id)
group by 1, 2, 3 order by 1, 2, 3;

\echo '== 9. Duplicates: more than one profile on the same platform for one creator'
select count(*) from (select creator_id, platform from gcp.creator_profiles group by 1, 2 having count(*) > 1) x;

\echo '== 10. Eligible creators with a usable public contact (not suppressed or bounced)'
select count(distinct d.creator_id) eligible, count(distinct ct.creator_id) with_contact
from gcp.creator_search_documents d left join gcp.creator_contacts ct on ct.creator_id = d.creator_id and coalesce(ct.status::text, 'active') not in ('invalid', 'bounced', 'suppressed', 'removed')
where d.eligible;

\echo '== 11. Recorded provider spend (platform.provider_calls)'
select provider, count(*) calls, round(coalesce(sum(cost_usd), 0)::numeric, 4) usd from platform.provider_calls group by 1 order by 1;

rollback;
