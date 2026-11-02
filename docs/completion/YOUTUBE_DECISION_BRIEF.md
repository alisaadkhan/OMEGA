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

## Owner questions of 2 November 2026: what exists now

| # | Requirement | Status (evidence) |
|---|---|---|
| 1 | Automatic 20-day refresh | **Built 2 Nov** (was missing: the lifecycle sweep only reported profiles over 75 days). `creators/youtube-refresh.ts` + worker job `creator.youtube_refresh`, daily 03:10, before retention (03:50). Picks YouTube profiles 20-29 days since their last fetch, oldest first, up to 500 a day, whatever their eligibility. Tests: `youtube-refresh.int` RF-01..04, `queues.test` |
| 2 | Worker must run | **External.** Staging has no hosted worker; nothing scheduled runs there until one is hosted |
| 3 | API key and `YOUTUBE_API_CALLS=on` on the worker | **Owner action.** Without them the job logs "skipped" and makes no call (test) |
| 4 | User refresh resets only on success | **Already true.** "Update info" refreshes immediately; `last_scraped_at` is written only when the fetched profile is saved (`enrichment/repository.ts`), a failure throws before it. RF-02 shows a failed fetch leaves the clock unchanged |
| 5 | Retry, then delete | A failed refresh is retried by the next daily run (days 20-29, up to ten attempts); at day 30 the retention job clears it. Staff get an alert (counts only) when refreshes fail or profiles are within 3 days of deletion |
| 6 | 0063 on staging | **Owner action**: `scripts/ops/migration-preflight.ts`, then `npm run db:migrate` |
| 7 | Derived metrics | **Not solved by the timer.** A scheduled refresh makes no AI call and asks for no new assessment, but engagement rate and niche/category tags are still derived from YouTube data: decision 2 (amendment or stop deriving) |
| 8 | Search consistency | A refresh writes `creator.changed` (search re-projected); retention re-projects the creators it clears; eligibility counts a YouTube follower count as stale after 30 days even if no job ran |

Cost when switched on: about 3 API units per channel (all 2,379 channels ≈ 7,140 units; default quota 10,000 a day), no AI spend.
