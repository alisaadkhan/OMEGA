-- Typical content performance per platform profile (owner decision 2026-11-02, policy elig-3; evaluated, not yet applied
-- to search). Written at every enrichment from the posts that fetch returned: medians of up to the latest 10 non-pinned
-- items, with the sample sizes and dates they came from. A fetch without usable posts writes nulls rather than keeping
-- older figures, so a median is never shown as current when it is not.
-- YouTube is left empty while YouTube-derived metrics are not permitted (Developer Policies III.E.4.h); if they ever are,
-- the retention function must clear these columns for YouTube with the rest of the API data.
alter table gcp.creator_profiles
  add column median_views integer check (median_views is null or median_views >= 0),
  add column median_engagement_rate double precision check (median_engagement_rate is null or median_engagement_rate >= 0),
  add column performance_views_sample smallint check (performance_views_sample is null or performance_views_sample between 0 and 50),
  add column performance_engagement_sample smallint check (performance_engagement_sample is null or performance_engagement_sample between 0 and 50),
  add column performance_format text check (performance_format is null or performance_format in ('reel', 'video')),
  add column performance_from timestamptz,
  add column performance_to timestamptz,
  add column performance_at timestamptz;

grant update (median_views, median_engagement_rate, performance_views_sample, performance_engagement_sample, performance_format,
  performance_from, performance_to, performance_at) on gcp.creator_profiles to mushin_worker;
