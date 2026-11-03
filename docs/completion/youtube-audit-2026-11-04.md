# YouTube refresh and retention audit (2026-11-04)

Master directive 2026-11-03, Part 8 decision 4. Code reading and local tests only: no YouTube API call was made and no
staging or production data was changed.

## What runs

| Job | When (UTC) | Code | Runs only if |
|---|---|---|---|
| `creator.youtube_refresh` | 03:10 daily | `apps/api/src/modules/creators/youtube-refresh.ts` | `YOUTUBE_API_CALLS=on` and `YOUTUBE_API_KEY` set; otherwise logged and skipped (no call) |
| `creator.youtube_retention` | 03:50 daily | `platform.expire_youtube_api_data(30)` (0063, now 0078) | always |

- Refresh picks active YouTube profiles whose stored API data is 20 to 30 days old (oldest first, 500 per day). A
  success moves `last_scraped_at`; a failure moves nothing, so the profile is tried again the next day (up to ten tries
  before day 30). A staff alert is raised on failures, critical when profiles are within 3 days of the limit.
- Retention clears every YouTube API value older than 30 days: counts, rates, bio, country read from the channel,
  snapshots, evidence, contacts and links read from the channel, hashtags, niche, summary, avatar and display name. The
  handle and channel URL stay. A country the creator confirmed and staff-entered contacts stay. Search is re-projected.
- A `reused` refresh result only happens when the profile was fetched minutes earlier (reuse window), so it never
  stretches data past 30 days.

## Finding fixed: columns added after 0063 were not cleared

0066, 0068, 0074 and 0075 added MUSHIN-derived columns that retention did not touch. In the local catalogue
(`mushin_catalog_v4`) 843 YouTube-led creators had an account type and 1,197 a niche source that would have outlived
the 30-day limit; performance and post locations were empty for YouTube (not computed while derived YouTube metrics
are restricted) but would not have been cleared if ever filled.

Migration **0078** clears them with the rest: median views and engagement with their samples and window, post
locations, niche source and posts assessed, and an account type read from the channel. A staff account-type decision
stays. Test: `source-policy.int.test.ts` ("also clears content performance ... (0078)").

## Known limits (unchanged, for the owner)

- Contacts and links carry no platform column, so, as in 0063, they are cleared for creators whose primary platform is
  YouTube only. Linked cross-platform creators need a platform column before this is exact.
- The near-deadline count includes inactive creators' profiles (reporting only; no data effect).
- Whether `YOUTUBE_API_CALLS` is on in the deployed worker is a deployment setting not visible from the code. While it
  is off, YouTube data is never refreshed and retention clears it at day 30, as designed.

## Status

- 0078 applied to the local test and catalogue databases only. Live (`yknp…`) is at 0073; 0074 to 0078 go live only
  with the owner's approval and the usual preflight and schema snapshot.
