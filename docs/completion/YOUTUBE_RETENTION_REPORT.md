# YouTube data retention: field-level report and decision (29 October 2026)

Read-only. Catalogue: local copy `mushin_catalog_v3` (staging was not inspected). Queries: `scripts/catalog/youtube-retention.sql`.
No YouTube call was made; `YOUTUBE_API_CALLS` stays off; no credential was created or enabled.

## 1. What the policy says (read 2026-10-29)

Sources: YouTube API Services Developer Policies (page updated 2026-10-15) and *Additional policies for derived metrics
and data storage* (updated 2026-09-14), both on developers.google.com/youtube/terms.

- MUSHIN reads public channels with an API key, without the creator's sign-in: all of it is **Non-Authorized Data**
  (III.E.4.d), storable "no more than 30 calendar days", then deleted or refreshed. Statistics such as subscriber counts
  are named explicitly (III.E.4.b).
- MUSHIN "must not … use API Data to create new or derived data or metrics" (III.E.4.h).
- The derived-metrics policy (III.L) allows, **only for developers who accept that amendment under the "Analytics &
  Reporting" use case**: statistics kept up to 36 months, and derived metrics (ratios such as engagement, categorisation
  and tags, brand-safety scores) clearly labelled as not from YouTube. Titles, names, descriptions and comment text stay
  on the 30-day rule even then.
- Channel and video identifiers are not specifically addressed by either page.
- Stored data must be kept consistent with YouTube and the most recent data shown (III.E.4.e/f); data may be obtained
  only through the API, never scraped (III.E.6, III.I.14). Default quota: 10,000 units per day (`channels.list`,
  `playlistItems.list`, `videos.list` 1 unit each).

**So the fields do not all share one rule** (correcting the earlier assumption):

| Category | MUSHIN fields | Rule today (MUSHIN has not accepted the amendment) | If the amendment were accepted |
|---|---|---|---|
| Statistics | subscriber count, video count, average views; metric snapshots | 30 days | up to 36 months |
| Text and images | channel title (display name), description, video titles, thumbnail, declared country | 30 days | 30 days |
| Derived from API data | engagement rate, niche tags and main niche, city, country decision from description/declared country, hashtags (`tags`), evidence quotes, AI summary, campaign fit | not allowed at all | allowed up to 36 months, labelled as MUSHIN's |
| Copied from the description | contact emails/phones (`source = bio`), links to other profiles | 30 days (they are description content) | 30 days |
| Identifiers | handle, channel URL | not addressed | not addressed |
| Not YouTube data | creator-confirmed country, staff-entered contacts, workspace notes | none from YouTube | none |

Whether MUSHIN's creator-discovery product qualifies as an "Analytics & Reporting" use case is a legal question for the
owner; this report does not assume it.

## 2. What is stored (measured)

| Data | Rows (YouTube) | Source |
|---|---|---|
| Profiles with subscriber count / video count / description | 2,379 / 2,379 / 2,379 | API (`provider_calls`: `scrape_youtube` 2,460 calls, 7,368 units) |
| Average views / engagement rate (derived) | 2,300 / 2,301 | computed by MUSHIN from API statistics |
| Last upload date | 2,376 | API (video `publishedAt`) |
| Country decision | 1,580 | channel declared country (1,548) or description |
| Channel title as display name / thumbnail | 2,355 / 2,357 | API |
| Niche tags / main niche / city (derived) | 1,963 / 1,155 / 440 | derived from description and titles (incl. 454 AI assessments) |
| Hashtags `tags` (derived) | 1,213 creators | video titles and descriptions |
| Attribute evidence quotes / enrichment snapshots / metric snapshots | 6,298 / 2,366 / 2,389 | derived / API |
| Contacts from the description / links from the channel | 530 / 381 | description content |
| Raw API payloads | 2,441 | API; each set to delete at 29 days 23:59 |
| Creator-confirmed countries | 0 | — |

Fetch dates: 2026-10-13 (1 profile) and 2026-10-20 to 10-21 (all others). Nothing came from another source.

## 3. Deadlines (fetch + 30 days)

| Date | Profiles | Eligible now |
|---|---|---|
| **2026-11-12** | 1 | 0 |
| **2026-11-19** | 2,056 | 321 |
| **2026-11-20** | 322 | 50 |

Raw payloads delete themselves on 2026-11-19/20 (`purge_raw_payloads`). The frozen evaluation corpus (fetched
2026-10-13) expires 2026-11-12, as the owner decided on 2026-10-15.

## 4. The retention implementation

`platform.expire_youtube_api_data` (0060), run daily at 03:50 by the worker (`creator.youtube_retention`), clears every
YouTube profile and creator whose last fetch is older than 30 days **whatever its eligibility** (test YT-RET-03), then
re-projects the search documents. A creator-confirmed country is kept.

**Gaps found today and fixed in migration 0063** (file only; applied to the disposable test database, nowhere else):
contacts read from the description (530 here), links read from the channel (381), and hashtags in `tags` (1,213) were
not cleared. 0063 deletes the first two for expired YouTube creators and empties `tags`; staff-entered contacts stay.
Test YT-RET-02. Known limit: contacts and links carry no platform, so like the rest of the function this applies to
creators whose primary platform is YouTube (all YouTube creators today; revisit when creators are linked across platforms).

**Fail-safe already in code (28-29 Oct):** eligibility treats a YouTube count older than 30 days as stale even if the job
has not run (YT-RET-01), so stale data is never shown as eligible.

**What can still miss a deadline: the job only runs where a worker runs.** Staging has no hosted worker; the local copies
have none. On those, the data stays until someone runs the job or deletes it.

**Separate issue (not retention):** MUSHIN computes engagement rate and niche/category tags from API data. Under III.E.4.h
that is not allowed unless the derived-metrics amendment is accepted for an eligible use case. This needs a legal/owner
decision independent of the 30-day question.

## 5. Options

### A. Refresh through the official API (keeps YouTube supply)

- Calls: the existing client uses 3 units per channel (channel, uploads list, latest videos). All 2,379 channels: about
  **7,140 units**, within one day's default 10,000. Eligible only (371): about 1,110. Repeating every 20 days stays far
  inside the quota.
- Requires: owner approval; `YOUTUBE_API_KEY` set on the worker host and `YOUTUBE_API_CALLS=on`, for refresh only (not
  discovery search, which uses a separate, much smaller `search.list` budget); a running worker; the refresh completed
  before 2026-11-19 (start by about 2026-11-12 to leave time for failures).
- Each refresh resets the 30-day clock for the data it re-fetched. Channels that fail to refresh are still cleared on their deadline.
- Risks: quota exhaustion on retries (bounded by the provider controls), deleted or renamed channels (marked missing,
  then cleared), the derived-metrics question above, and that the policy requires stored data to stay current, not only
  under 30 days old.

### B. Let the data expire (no API use)

- Supply after the deadline: YouTube eligible 0 (it is 371 today); Instagram 16, TikTok 0 remain.
- Requires: the retention job (with 0063) to run on staging before 2026-11-12/19, through a worker or an approved one-off
  run followed by re-projection; and the local copies cleared or deleted (`mushin_catalog_v3`, `mushin_frz_elig2_disposable`,
  `mushin_eval_disposable` by 2026-11-12, files in `docs/readiness/youtube-eval-data-inventory.md`). About 2,338 YouTube
  thumbnails in staging storage are removed by the job when it runs with storage configured.
- Risk: the catalogue loses its only sizeable platform.

**Recommendation:** decide by **2026-11-12**. Option A is the only compliant way to keep YouTube creators. Whichever is
chosen, migration 0063 should go to staging with 0060-0062, and staging and the local copies must not hold this data past
the dates in section 3. Owner decisions: A or B; whether to pursue the derived-metrics amendment (legal); approval to
apply 0060-0063 to staging; who runs the job on staging before a worker is hosted.
