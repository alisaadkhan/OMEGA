-- Engagement is never a misleading 0% (master directive §4.1, owner directive 2026-11-04). A real but tiny rate is
-- stored with four decimals (signals.ts engagementPercent); exactly 0 on every recent post means likes are hidden or not
-- returned, which is "not measurable" (null). Existing zeros become null; the check keeps it so for every writer.
update gcp.creator_profiles set engagement_rate = null where engagement_rate = 0;
update gcp.creator_profiles set median_engagement_rate = null where median_engagement_rate = 0;
update gcp.creator_search_documents set engagement_rate = null where engagement_rate = 0;
alter table gcp.creator_profiles add constraint creator_profiles_engagement_not_zero check (engagement_rate is null or engagement_rate > 0);
alter table gcp.creator_profiles add constraint creator_profiles_median_engagement_not_zero check (median_engagement_rate is null or median_engagement_rate > 0);
