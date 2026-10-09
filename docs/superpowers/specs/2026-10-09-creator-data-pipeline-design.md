# Sub-project 4A: Creator Data Pipeline — Design

**Date:** 2026-10-09 · **Status:** draft for review · **Umbrella spec:** `2026-10-06-mushin-backend-architecture-design.md` (§3 row 4, §5.4, §5.5, §5.12, §7.2–7.5) · **Builds on:** `2026-10-08-creator-plane-search-design.md` (sub-project 3) · **Requirements:** `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf` (SRS), `reference_files/MUSHIN_System_Diagrams.pdf` (Diagrams)

## 1. Intent

Sub-project 4 ("Live Discovery & Enrichment") is split in two (user decision). **4A, this spec, is the write side of creator data for one creator at a time**: fetch a creator's public profile from Instagram, TikTok or YouTube, archive the raw response, clean it, measure authenticity signals, have the AI explain them and estimate the audience, flag possible minors, and save everything. It is exposed to users as **add a creator by profile link** (SRS §4.2.2, REQ-02.07) and **paid refresh / "Update info"** (SRS §4.1.2 "Enrich", REQ-01.06). **4B** then builds live discovery ("Find New Creators", Serper, candidate filtering, fit ranking, progressive results) and erasure on top of the same per-creator steps.

**Done when** a signed-in user can paste a public Instagram, TikTok or YouTube link, confirm the price (10 credits; TikTok 30), watch the job's steps, and open a new creator profile showing real numbers with per-metric freshness, an authenticity score with its evidence (or "Not enough recent posts to assess"), an estimated audience labelled as such, linked accounts, and a possible-minor notice when signals exist; can refresh a profile for the same price and see it update in place; every failure returns the credits; the raw responses are archived and purged after the retention period; Apify spend stops at the monthly cap. All behaviour is covered by tests and `npm run verify` passes.

## 2. Decisions

Every decision was checked against the SRS and the Diagrams; where they speak, they win.

| # | Decision | Source |
|---|---|---|
| D1 | Sub-project 4 is split: **4A** creator data pipeline (this spec), **4B** live discovery + erasure. | User choice |
| D2 | **Authenticity: code measures, AI explains.** Code computes signals and a score range (base ± 5); the AI writes the verdict and evidence and picks the score inside the range. Output that breaks the rules is rejected. | SRS REQ-01.02, §3.1, §5.2 (reconstructable from source), §5.5; Diagrams 6–7 ("LLM: assessment"); user choice |
| D3 | **Estimated audience** = AI estimate from what is already scraped (creator location, bio/caption language, hashtags, niche, YouTube channel country). Confidence never above `medium`; source labelled "estimated from public content". No commenter scraping. | SRS §2.7, REQ-01.07; user choice |
| D4 | **Add-by-URL of a new creator costs the same as a refresh**: Instagram and YouTube **10 credits** (existing `refresh_data`), **TikTok 30 credits** (new action `refresh_tiktok`, fetching the last 6 videos), confirmed first, refunded on failure. A creator MUSHIN already has opens free. TikTok is priced separately because Apify bills it per video ($0.003 each): at the cheapest credit (Scale yearly ≈ $0.002) 10 credits could not meet the 3× rule. | SRS §3.1 (cost shown first), §5.5 (3× COGS); Q12; recorded Apify prices; user choices |
| D5 | **Raw payloads kept 12 months**, a database setting until legal counsel decides (TBD-001). Erasure deletes immediately (4B). | SRS §5.2, §6.4, TBD-001; user choice |
| D6 | **Cross-platform links are recorded, not merged.** Accounts the creator links in their own bio/website field are saved as linked accounts and shown on the profile. Merging waits for TBD-010. | SRS REQ-01.01, TBD-010; Diagrams 6 ("possible merge"); user choice |
| D7 | **One background job per creator, in steps** (fetching → archiving → cleaning → assessing → saving). The API reserves credits and queues the job; the website polls. | SRS §2.5 (outbox), §3.1 (progress, notify > 30 s), §3.4 (polling, queue-only), NFR-P03; Diagram 7; user choice A |
| D8 | Scrapers: Instagram `apify/instagram-profile-scraper`, TikTok `clockworks/tiktok-profile-scraper`, YouTube **Data API v3** with `streamers/youtube-channel-scraper` as fallback. Storage: **Supabase Storage**. | Architecture Q7, Q11; SRS §3.3 |
| D9 | **Possible minors** are flagged when fixed rules **or** the AI find signals; the reason is stored; only staff can clear it. Flagged creators can be added and refreshed; reveal stays blocked (sub-project 3). | SRS §5.2, §5.5 |
| D10 | **Refresh is refused (free) when the data is under 24 hours old**; a job reuses another workspace's scrape of the same profile from the last 10 minutes and refunds. Both are settings. | SRS §5.5 (no surprise charges); cost control |

**Open SRS items carried forward:** TBD-001 retention (12 months for now), TBD-002 prices (10 credits for now), TBD-004 Apify quality on Pakistani creators (the live check is first evidence), TBD-007 LLM routing (Groq → Ollama Cloud), TBD-010 identity resolution.

## 3. Data model (migration `0011_creator_pipeline.sql`)

Expand-only: no column or table is dropped or renamed (SRS §6.1).

### 3.1 Workspace Plane (`wp`, RLS forced on `workspace_id`, `using` + `with check`)

**`discovery_jobs`** (name from the umbrella spec §5.5, so 4B extends it):
`id`, `workspace_id`, `kind` (`add_by_url` | `refresh`; 4B adds `live`), `requested_by`, `input_url` (add-by-URL), `platform`, `handle`, `canonical_url`, `creator_id` (refresh target, or the result), `status` (`queued` | `running` | `completed` | `failed`), `step` (`fetching` | `archiving` | `cleaning` | `assessing` | `saving` | null), `attempts`, `reservation_id`, `credits_charged`, `outcome` (`created` | `refreshed` | `reused` | null), `error_code`, `error_message` (user-facing), `request_id`, `created_at`, `started_at`, `finished_at`, `updated_at`.
Partial unique index: one non-finished job per (`workspace_id`, `canonical_url`) — the duplicate guard. The API role may insert and read; the worker updates.

### 3.2 Global Creator Plane (`gcp`, no `workspace_id`)

- **`profile_metric_snapshots`** (append-only; no UPDATE/DELETE granted): `profile_id`, `followers`, `following`, `posts`, `engagement_rate`, `avg_likes`, `avg_comments`, `avg_views`, `captured_at`, `raw_payload_id`. Source of the growth signal.
- **`creator_links`**: `creator_id`, `platform` (`instagram` | `tiktok` | `youtube` | `website`), `url`, `source` (`bio` | `profile_link`), `first_seen_at`, `last_seen_at`; unique (`creator_id`, `url`). Readable by the API role.
- **`creators`** gains `minor_reason text`, `minor_flagged_at timestamptz`, `assessment_status text` (`assessed` | `pending` | `insufficient_data` | null), `avatar_key text` (stored copy of the photo).

### 3.3 Platform

- **`raw_payloads`**: `id`, `provider` (`apify` | `youtube`), `platform`, `canonical_url`, `creator_id` (null until saved), `job_id`, `storage_key`, `bytes`, `sha256`, `fetched_at`, `delete_after`. Worker-only.
- **`enrichment_settings`** (one row, seeded): `raw_retention_days` 365, `refresh_min_age_hours` 24, `reuse_window_minutes` 10, `recent_posts` 12 (Instagram, YouTube), `tiktok_recent_videos` 6, `min_posts_for_score` 3, `growth_min_days` 14, `score_band` 5, `stuck_job_minutes` 30, `engagement_benchmarks jsonb` (per platform and follower tier, §5.3), `model_version` (`assessment-v1`).
- Rate-limit bucket `jobs`: 20 per hour per user.

### 3.4 Storage (Supabase Storage, created idempotently by the worker at start)

- `raw-payloads` — **private**: `{platform}/{yyyy}/{mm}/{payload id}.json`.
- `creator-avatars` — public read: `{creator id}/{sha256}.jpg`; `creators.avatar_url` points at it.

## 4. Adapters (`packages/integrations`)

All wrapped in `instrumented()` (timeout, retry policy, structured log, one `platform.provider_calls` row with cost — SRS §2.5, REQ-03.05).

| Interface | Implementation | Notes |
|---|---|---|
| `ProfileScraper` (`fetchProfile({ platform, handle, url })` → `{ raw: unknown; provider; costUsd }`) | `ApifyScraper` (Instagram, TikTok, YouTube fallback); `YouTubeApiScraper` | Apify: start a run (`waitForFinish` ≤ 120 s), read the dataset and the finished run. These actors are **pay-per-event**, so `usageTotalUsd` is 0: cost = `usageTotalUsd` + Σ `chargedEventCounts[e]` × `pricingInfo.pricingPerEvent.actorChargeEvents[e].eventPriceUsd`; when that is 0 but items were returned (free-tier runs report no charged events), cost = items × the primary event's price, so the spend cap still counts it. YouTube: `channels.list` (handle or id) + uploads playlist + `videos.list` for the last ~12 videos; cost $0 with quota units recorded; a quota error switches to the Apify YouTube actor. A private or missing account returns a typed result (not an exception). |
| `ObjectStorage` (`put`, `get`, `delete`, `ensureBucket`) | `SupabaseStorage` (REST, service key) | R2 later behind the same interface. |
| Spend cap | `ApifySpendGuard` | Before each Apify run: this calendar month's Apify `cost_usd` from `provider_calls` ≥ `APIFY_MONTHLY_BUDGET_USD` (default 5) → `PROVIDER_UNAVAILABLE` (`reason: spend_cap`) and a warning log. |

Fakes for tests: a fixture scraper replaying **recorded real responses** (one per platform, plus private and not-found) and an in-memory `ObjectStorage`.

## 5. The job (worker, `creators` module pipeline + `discovery` module orchestration)

### 5.1 Steps

1. **Fetching** — `normalizeProfileUrl` (sub-project 3) gives platform, handle, canonical URL. If this job already archived a payload (retry), reuse it. If another job archived this profile within `reuse_window_minutes`, reuse that payload (outcome `reused`, credits released). Otherwise call the scraper.
2. **Archiving** — store the raw JSON, then insert `raw_payloads` (`delete_after = fetched_at + raw_retention_days`).
3. **Cleaning** (SRS §5.3, hostile input) — per-platform Zod parse into one `StandardProfile`: display name, handle, bio, followers, following, posts, verified, website link, business email/phone, country (YouTube), avatar URL, and the last `recent_posts` posts (TikTok: `tiktok_recent_videos`)' date, likes, comments, views, type, caption (≤ 500 chars) and hashtags. Strip HTML and control characters, cap lengths, reject negative or non-finite numbers. Private/missing → failed (`PRIVATE_ACCOUNT` / `NOT_FOUND`), credits released. The avatar is copied to `creator-avatars` (failure keeps the initials avatar; never fails the job).
4. **Assessing** — §5.3 signals → score range → one LLM call (§5.4) → validated assessment; §5.5 minor rules.
5. **Saving** (one transaction, worker role) — upsert creator and profile by canonical URL (refresh updates the same creator); insert a metric snapshot; upsert contacts (§5.6) and linked accounts; insert an enrichment snapshot when assessed; set `authenticity_score`, `assessment_status`, `is_minor`/`minor_reason` (only ever **set**, never cleared, by the pipeline), `last_enriched_at`, metric timestamps; set `raw_payloads.creator_id`; outbox `creator.changed` (search index + AI summary). Then, in the job's workspace transaction: commit the reservation, mark the job `completed` with its outcome, outbox `notify.discovery_job_finished`.

Each step updates `discovery_jobs.step` and **extends** the reservation (billing engine `extend`).

### 5.2 Retries and failure

- Retryable (provider timeout/5xx, network): the handler increments `attempts`; below 3 it rethrows so the queue retries with backoff; at 3 the job fails (`PROVIDER_UNAVAILABLE`, "Couldn't fetch this profile right now"), credits released.
- Not retryable (private, not found, invalid link, spend cap): fail at once, credits released.
- **AI-only failure**: the profile, metrics, contacts and links are saved and **charged**; `assessment_status = pending`; outbox `creator.assessment_requested` re-runs §5.3–5.4 from the stored data on `rescore-low`, free.
- A sweeper (every 5 minutes) fails jobs `running`/`queued` longer than `stuck_job_minutes`; their reservations are already released by the existing 15-minute `release_abandoned` job.
- Every failure leaves the ledger balanced: a job never commits a released reservation; a commit that finds the reservation released keeps the data and charges nothing (logged).

### 5.3 Signals and score range

Computed from `StandardProfile` (+ the previous metric snapshot). Each signal has a value, a status (`ok` | `watch` | `risk`), a sub-score 0–100 and a weight; each yields a deterministic evidence fact.

| Signal | Measure | Weight |
|---|---|---|
| `engagement_vs_tier` | mean (likes + comments) / followers over recent posts vs `engagement_benchmarks[platform][tier]` (tiers: < 10K, 10K–100K, 100K–1M, ≥ 1M) | 30 |
| `likes_to_comments` | likes per comment (very high → bought likes) | 15 |
| `views_to_followers` | mean views / followers (TikTok, YouTube, Instagram video) | 15 |
| `follow_ratio` | following / followers | 10 |
| `posting_regularity` | posts per week and gaps over the recent posts | 10 |
| `engagement_consistency` | posts with ≥ 5× median engagement (pods / bought engagement on single posts) | 10 |
| `follower_growth` | change since a snapshot ≥ `growth_min_days` old, vs engagement change | 10 (only when available; weights renormalise) |

Base score = weighted mean of available sub-scores; **range = base ± `score_band`**, clamped to 0–100. Fewer than `min_posts_for_score` recent posts → no score, `assessment_status = insufficient_data`, profile shows "Not enough recent posts to assess". `fake_follower_pct` stays null (not measurable from public data).

### 5.4 AI assessment (one call, `feature: "creator_assessment"`, cost recorded)

Input: the signals with their values and facts, follower tier, platform, and a cleaned sample of the bio and captions — all fenced as data (`fenced()`, sub-project 3), bio contacts redacted (`redactContacts`). Output schema (Zod): `verdict` (`genuine` | `mostly genuine` | `mixed signals` | `likely inflated`), `score`, `evidence[] { signal, detail }`, `watchOuts[]`, `audience { age[], gender, cities[], countries[] }` each with `confidence` (`low` | `medium`), `niches[]`, `creatorCity`, `creatorCountry`, `minorSigns { likely: boolean, reason }`.
Validation (rejected → one corrective retry → failure §5.2): score outside the range; verdict inconsistent with the score (≥ 80 genuine, 60–79 mostly genuine, 40–59 mixed signals, < 40 likely inflated); evidence naming a signal that was not measured; empty evidence. Cleaned silently: confidence above `medium` → `medium`; niches not in `platform.niches`, countries not ISO 3166-1, shares not summing to ~100 → dropped. `audience.source = "estimated from public content"` (SRS REQ-01.07).

### 5.5 Possible minors (SRS §5.2, §5.5)

Flag when **either** rule-based phrases in the bio/captions match (e.g. "15 y/o", "16yo", "age 14", "class 9", "class 10", "matric student", "O levels student", "born 2011", a stated birth year under 18 years ago) **or** the AI reports `minorSigns.likely`. Phrases that must not flag: "class of 2015", "15 years of experience", "born in 1998", "teaching class 9". The reason (rule or AI text) goes to `creators.minor_reason`; customers see the existing generic notice. The pipeline never clears the flag.

### 5.6 Contacts and linked accounts

Emails/phones from business-contact fields → trust `likely`; from the bio text → `unverified`. Encrypted, hashed and masked exactly as sub-project 3 (`encryptSecret`, `maskContact`); `last_seen_at` updated on refresh. Linked accounts: the website field and profile URLs found in the bio (`normalizeProfileUrl`), excluding the creator's own profile.

## 6. Credits

- Start (API, one workspace transaction): the action is `refresh_tiktok` for TikTok links/creators and `refresh_data` otherwise; `confirmedCost` must equal its current price (else 409 with `currentCost`); reserve; insert the job; outbox `discovery.requested` (add-by-URL → `discovery-high`) or `refresh.requested` (refresh → `discovery-standard`). `Idempotency-Key` required; a replay returns the stored response.
- Free answers, no reservation: link already known → `{ status: "known", creatorId }`; refresh within `refresh_min_age_hours` → `{ status: "up_to_date", updatedAt }`; a non-finished job for the same profile in this workspace → that job.
- Commit on success (`created` / `refreshed`); release on `reused` or failure. Ledger reference: `refType: "discovery_job"`, `refId: job id`.
- 3× COGS (SRS §5.5), recorded prices: Instagram $0.0026 per profile, TikTok $0.003 per video (6 videos = $0.018), YouTube $0 (API quota), AI ≈ $0.0003. At the cheapest credit (Scale yearly, $852 / 420,000 ≈ $0.002): 10 credits ≈ $0.020 ≥ 3 × $0.0029 (Instagram) and 3 × $0.0003 (YouTube); 30 credits ≈ $0.061 ≥ 3 × $0.0183 (TikTok). Final prices stay TBD-002.
- `refresh_tiktok` is added to the credit-action list everywhere it is enumerated (the three `0005` check constraints, replaced in `0011`; `creditActionSchema`; the billing `actionCosts` response; the Billing screen and banner labels).

## 7. API (`discovery` module; customer guard)

| Route | Behaviour |
|---|---|
| `POST /v1/discovery/jobs` (Idempotency-Key) | Body `{ kind: "add_by_url", url, confirmedCost }` or `{ kind: "refresh", creatorId, confirmedCost }` → **202** `{ jobId }`, or **200** `{ status: "known", creatorId }` / `{ status: "up_to_date", updatedAt }`, **409** price changed, **400** not a supported profile link, **429** `jobs` bucket. |
| `GET /v1/discovery/jobs/:id` | `{ id, kind, status, step, outcome, creatorId, error: { code, message } | null, createdAt, finishedAt }`. |
| `GET /v1/discovery/jobs?active=true` | This workspace's queued/running jobs and those finished in the last 10 minutes. |

Changes to sub-project 3 routes: `GET /v1/creators/lookup` adds `addable: { platform, handle, url, cost }` (cost 30 for TikTok, 10 otherwise) when the query is a supported profile link with no match. `GET /v1/creators/:id` adds `refreshCost`, `refreshJob` (`{ id, step }` | null), `linkedAccounts[]`, `lastScrapedAt`, and authenticity statuses `pending` and `insufficient_data`.

The `discovery` module owns `wp.discovery_jobs`; it calls the `creators` module only through `creators/index.ts` and billing only through `billing/index.ts` (SRS §5.4).

## 8. Frontend (wiring, plus two small additions)

- **Omnibar:** a profile link with no match shows "Add @handle · {cost} credits" (10, or 30 for TikTok) → existing confirm dialog → `POST /v1/discovery/jobs`.
- **Search page:** the empty and few-results states gain an **"Add a creator by profile link"** button opening a paste-link dialog (SRS REQ-02.07 fallback). The "arrives in the next update" text is removed for add-by-URL (kept for Find New Creators until 4B).
- **Job card** in the top bar: active jobs with their step, then "Open profile" or the failure reason and "credits returned"; restored after reload from `?active=true`; polls every 2 s while a job is active. The credit meter is refetched on start and finish.
- **Profile panel:** "Update info" → confirm the price (`refreshCost`) → "Refreshing…" with the step; refetch on completion; "Already up to date" toast for the free answer; linked accounts as platform links; authenticity "Assessment pending" and "Not enough recent posts to assess".

## 9. Errors

| Code | When | HTTP / job |
|---|---|---|
| `VALIDATION_FAILED` | not a supported Instagram/TikTok/YouTube profile link | 400 |
| `CONFLICT` (`confirmedCost`, `currentCost`) | price changed | 409 |
| `INSUFFICIENT_CREDITS` / `ENTITLEMENT_REQUIRED` | from billing | 402 / 403 |
| `RATE_LIMITED` | `jobs` bucket | 429 |
| `PRIVATE_ACCOUNT`, `NOT_FOUND` | job failure, credits released | job `failed` |
| `PROVIDER_UNAVAILABLE` (`reason: spend_cap` \| `provider`) | cap reached or retries exhausted, credits released | job `failed` |

## 10. Testing (SRS §5.4 Testability)

- **Unit:** link parsing; per-platform cleaning from recorded responses, including hostile input (HTML, control characters, a 50,000-character caption, negative/absurd numbers); each signal, the range, insufficient posts, growth with/without an earlier snapshot; AI-output validation (range, verdict/score consistency, unmeasured signal, confidence cap, niche/country cleanup); minor rules including the must-not-flag phrases; contact extraction and trust; linked accounts; spend-cap maths; Apify run/wait/dataset/cost parsing; YouTube parsing and quota fallback; storage REST.
- **Integration** (test DB, test Meilisearch, fixture scraper, `MockLlm`, in-memory storage): happy path (steps, archive, creator, snapshots, contacts, links, credits committed, index updated); known link and fresh refresh free; duplicate job not charged twice; reuse within the window refunds; private / not found / provider down after 3 attempts / spend cap → refunded; AI failure → charged, `pending`, then the background assessment; stuck-job sweep; Idempotency-Key replay; **workspace B cannot read workspace A's jobs (RLS)**; a flagged minor is not indexed; retention purge deletes old payloads and their files; ledger balances after every case.
- **Live, opt-in** (`LIVE_SCRAPE_TESTS=1`): scrape one public profile per platform (~$0.02) and round-trip one object through Supabase Storage. First evidence for TBD-004.
- **Browser:** add and refresh a real creator through the website — only after the user agrees (spends Apify cents and 20 workspace credits).

## 11. Environment

New: `APIFY_INSTAGRAM_ACTOR_ID=apify/instagram-profile-scraper`, `APIFY_TIKTOK_ACTOR_ID=clockworks/tiktok-profile-scraper`, `APIFY_YOUTUBE_ACTOR_ID=streamers/youtube-channel-scraper`, `APIFY_MONTHLY_BUDGET_USD=5`, `LIVE_SCRAPE_TESTS`. Already set in `.env`: `APIFY_TOKEN`, `YOUTUBE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; the worker config starts reading `APIFY_TOKEN`, `YOUTUBE_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (worker only — the API never holds the storage key or scraper tokens; production requires them). Without `APIFY_TOKEN` (or `YOUTUBE_API_KEY` for YouTube) the worker logs a warning at start and fails those jobs with `PROVIDER_UNAVAILABLE`, releasing the credits.

## 12. Out of scope

**4B:** Find New Creators (Serper, candidate filtering, fit ranking, progressive results, `live` jobs), the Serper spend cap, erasure and removal requests. **Later:** creator merging (TBD-010); notification delivery (sub-project 7); staff minor override and cost dashboard (sub-project 8); bulk enrichment, growth charts, content insights (S2).
