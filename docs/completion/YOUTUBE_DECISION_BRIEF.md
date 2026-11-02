# YouTube data: owner decision brief (29 October 2026)

Evidence: `YOUTUBE_RETENTION_REPORT.md` (field-level counts, policy quotes, sources). Nothing below has been done: no
YouTube call, no API enabled, no amendment accepted, no staging cleanup, 0063 not applied to staging.

**Deadlines (local catalogue copy; staging was loaded from the same collection):** 1 profile on **12 November**, 2,056 on
**19 November** (321 eligible), 322 on **20 November** (50 eligible). The frozen evaluation corpus also expires 12 November.

## Decision 1: refresh, or let it expire

| | A. Refresh through the official YouTube API | B. Let it expire |
|---|---|---|
| YouTube supply after 20 Nov | kept (371 eligible today, re-checked on fresh data) | 0 eligible (Instagram 16, TikTok 0 remain) |
| API calls | 3 units per channel: ~7,140 units for all 2,379, ~1,110 for the 371 eligible; default quota 10,000 units/day | none |
| Permissions | owner approval; refresh only (no discovery search); YouTube API Services terms apply | none |
| Configuration | `YOUTUBE_API_KEY` on the worker host, `YOUTUBE_API_CALLS=on`; worker running | retention job must still run (see decision 3) |
| Ongoing | refresh every < 30 days (20-day target); failures cleared on their deadline | none |
| Risks | quota on retries; deleted/renamed channels; derived-metrics question (decision 2) | loss of the only sizeable platform |
| Latest start | about **12 November** (time for failures before 19 November) | n/a |

Field rules either way: statistics (subscribers, views, video counts) and text/images (titles, descriptions, names,
thumbnails, declared country, description contacts and links) must be refreshed or deleted within 30 days. Creator-
confirmed countries and staff-entered contacts are not YouTube data and stay.

## Decision 2: the derived-metrics amendment (legal)

MUSHIN computes engagement rate and niche/category tags from YouTube API data. Without the "Analytics & Reporting"
amendment this is not allowed (Developer Policies III.E.4.h). With it, derived metrics (labelled as MUSHIN's) and
statistics may be kept up to 36 months; text still follows 30 days. Whether creator discovery counts as that use case is a
legal judgement. Choices: (a) seek the amendment; (b) stop deriving from YouTube data (drop YouTube engagement rate and
YouTube-derived niche tags, which reduces niche coverage); (c) seek legal advice first. Independent of decision 1.

## Decision 3: staging cleanup before a worker runs there

Staging has no confirmed running worker, so its retention job does not run. Steps for whichever option is chosen, each
needing approval:
1. Apply 0060-0063 to staging after `scripts/ops/preflight-0060-0062.sql` passes (it covers 0063).
2. Before 12 November (the earliest profile): either host the worker (it runs `creator.youtube_retention` daily at 03:50)
   or have an approved person run `select * from platform.expire_youtube_api_data(30)` followed by a search re-projection
   (`npm run search:reindex` against staging), and remove the returned avatar files from storage.
3. Delete or clear the local copies (`mushin_catalog_v3`, `mushin_frz_elig2_disposable`, `mushin_eval_disposable`) and the
   files in `docs/readiness/youtube-eval-data-inventory.md` by their dates.

Under option A, the refresh must run before step 2 for the channels to be kept; channels not refreshed are still cleared.
