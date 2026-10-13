# Sub-project 4B: Live Discovery and Erasure — Design

**Date:** 2026-10-09 · **Status:** draft for review · **Umbrella spec:** `2026-10-06-mushin-backend-architecture-design.md` (§3 row 4, §5.4–5.5, §5.12, §7.4–7.5) · **Builds on:** `2026-10-08-creator-plane-search-design.md` (sub-project 3, Brain 1), `2026-10-09-creator-data-pipeline-design.md` (sub-project 4A, the per-creator pipeline) · **Requirements:** `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf` (SRS), `reference_files/MUSHIN_System_Diagrams.pdf` (Diagrams)

## 1. Intent

MUSHIN's search has two halves ("Two Brains", SRS §2.1). **Brain 1** (sub-project 3) searches the creators MUSHIN already knows: instant and free. **Brain 2**, this spec's first half, finds creators MUSHIN does not know yet: when a search returns fewer than 8 or poor results, the user confirms "Find New Creators" with the cost shown, and a background job searches Google (Serper), picks relevant profiles, merges the ones MUSHIN already has, fetches and assesses the new ones with 4A's pipeline, and shows ranked results progressively (SRS §4.2.2, glossary "Live Discovery"; Diagrams 6 and 7). Everything it adds joins the database and the Brain 1 index, so future searches find it instantly (SRS §2.1).

The second half is **erasure**: a creator (who has no MUSHIN account) can ask for removal through a public page; they are hidden at once; MUSHIN staff approve or reject the request on a new admin screen; approval deletes their personal data everywhere and keeps them from being re-added (SRS §6.3; Diagrams 1, 2 and 10: "removal / erasure", "verification / confirmation", "Perform Administrative Actions").

**Done when**
- A signed-in user can run "Find New Creators" from the search page, choose 5, 10 or 20 new creators, see the maximum cost, confirm, watch the steps in the Jobs tray, and see found creators appear on the search page ranked by fit, new ones marked "New" and known ones marked "Already in MUSHIN".
- The run charges 12 credits plus the add price of each new creator actually saved and returns the rest; a run that finds nothing, or fails, returns everything.
- Repeated Google searches within 7 days cost nothing; Serper stops at the monthly search limit; retries never pay Serper or Apify twice or charge twice.
- A creator can submit a removal request on a public page; their profile disappears from customers at once; staff signed in with password and 2-step code can approve or reject it on a "Removal requests" screen; approval deletes their personal data, archives and photo, keeps a tombstone, and blocks the profile links from being added again.
- A workspace owner or admin can remove contacts their workspace revealed.
- All behaviour is covered by tests and `npm run verify` passes.

## 2. Decisions

Every decision was checked against the SRS and the Diagrams; where they speak, they win.

| # | Decision | Source |
|---|---|---|
| D1 | **Price = search fee + each new creator added.** The search costs `find_new` (12 credits, existing action). Each **new** creator saved costs the add-by-link price: `refresh_data` 10 for Instagram and YouTube, `refresh_tiktok` 30 for TikTok. Creators MUSHIN already knows are free. One reservation for the maximum; at the end the job charges what was used and releases the rest. At the cheapest credit (≈ $0.002) 12 credits covers ≈ $0.008 of cost, enough for the Google searches and AI filtering but not for fetching profiles, so the 3× rule needs the per-creator part. | SRS §3.1 (cost shown first), §5.5 (3× COGS), REQ-02.06; user choice |
| D2 | **The user picks the run size: 5, 10 or 20 new creators** (default 10). The maximum shown is `12 + size × 30` when TikTok is in scope (the "All platforms" or TikTok tab) and `12 + size × 10` otherwise. | SRS §3.1 (never surprised); user choice |
| D3 | **A run that finds nothing is free**: zero results releases the whole reservation, including the 12. | Umbrella §7.4 step 6 ("0 results or failure → release"); user choice |
| D4 | **One job per run (option A)**, following Diagram 7: one reservation, one job id polled for status and partial results; the job searches, filters, merges known creators, fetches, assesses, ranks and saves. Profiles are fetched in **one Apify run per platform** for all new candidates. | SRS glossary ("a background job … finds and scrapes"), §4.2.2; Diagrams 6–7; user choice |
| D5 | **Google searches are built by code from the filter chips** (the AI already turned plain English into chips in Brain 1, Diagram 6 "LLM: requirement understanding"), 2–3 per platform. **The AI filters candidates for relevance** from their Google title and snippet. Ranking uses **sub-project 3's deterministic fit score and label** (no AI ranking call), so both brains rank the same way. | Diagrams 6–7; SRS §3.4 (Serper results "fed into the scraping pipeline"); sub-project 3 decision (fit = deterministic) |
| D6 | **Serper results are cached for 7 days**, shared by all workspaces. Serper stops at **2,500 searches per calendar month** (`SERPER_MONTHLY_SEARCH_LIMIT`, Serper's free tier). | SRS §3.4 ("cached for 7 days"); umbrella Q11 |
| D7 | **Erasure: public form + staff approval.** The request hides the creator at once (`removal_requested`); staff approve (erasure runs) or reject (creator restored). Confirmation emails to the requester arrive with sub-project 7. | SRS §6.3; Diagrams 1, 2, 10; user choice |
| D8 | **Erasure deletes personal data and keeps a tombstone**: contacts, profiles, links, metric and assessment history, raw archives and the photo are deleted; the `gcp.creators` row stays with personal fields cleared and status `erased`; the credit ledger (IDs and amounts only) is kept. | SRS §6.3, §6.4 (ledger 7 years); umbrella §5.12 |
| D9 | **Do not re-add**: erased profile links are kept only as SHA-256 hashes in `gcp.creator_suppressions`; add-by-link, refresh and Find New Creators refuse them. | SRS §6.3; privacy by design |
| D10 | **Delete per workspace**: owners and admins can remove the contact details their workspace revealed for a creator (no refund). | SRS §6.3 ("deletable per workspace and globally") |
| D11 | **Admin sign-in is wired now** to the real staff login (password, then 2-step code, from sub-project 1), with one new screen, "Removal requests". The other admin pages stay demo until sub-project 8. | User choice (settles the pending admin-login decision) |

**Naming follows the umbrella spec:** job kind `live`, tables `wp.discovery_results` and `gcp.removal_requests`, results polled with a `seq` cursor.

**Open SRS items carried forward:** TBD-001 (raw retention, 12 months for now), TBD-002 (prices), TBD-004 (Apify quality), TBD-007 (LLM routing), TBD-010 (identity resolution: known candidates are matched by profile link only, never merged across platforms).

## 3. Data model (migration `0012_live_discovery_erasure.sql`)

Expand-only: no column or table is dropped or renamed (SRS §6.1). Columns made optional are relaxed, not removed.

### 3.1 Workspace Plane (`wp`, RLS forced on `workspace_id`, `using` + `with check`)

**`discovery_jobs`** (from 4A), extended:
- `kind` gains `live`.
- `platform`, `handle`, `canonical_url` become nullable; a CHECK keeps them required for `add_by_url` and `refresh`.
- New: `search jsonb` (the Brain 1 request: `text` + `filters`), `max_new int` (5, 10 or 20), `search_hash text` (hash of the normalised search), `found_count`, `new_count`, `known_count` (ints, default 0).
- `step` gains `searching` and `filtering` (before `fetching`).
- New partial unique index: one open `live` job per (`workspace_id`, `search_hash`), the duplicate guard for repeated clicks (the 4A index on `canonical_url` ignores the nulls).

**`discovery_results`** (new):
`id`, `workspace_id`, `job_id` (FK), `creator_id` (FK → `gcp.creators`), `seq` (increasing per job, the polling cursor), `rank`, `fit_score`, `fit_label`, `is_new` (bool), `credits` (what this result cost: 0, 10 or 30), `reason` (the relevance filter's one-line reason, cleaned like 4A's AI text), `created_at`. Unique (`job_id`, `creator_id`). The API role reads; the worker inserts and updates `rank`.

### 3.2 Global Creator Plane (`gcp`, no `workspace_id`)

**`creator_suppressions`** (new): `url_hash text primary key` (SHA-256 of the canonical profile URL), `platform`, `created_at`, `removal_request_id`. No URL, name or handle is stored.

**`removal_requests`** (new): `id`, `urls text[]` (the canonical profile links given, 1–3), `creator_id` (matched creator or null), `requester_email_encrypted` (AES-256-GCM, `DATA_ENCRYPTION_KEY`; cleared when the confirmation has been sent, or 30 days after processing), `reason` (≤ 500 characters, cleaned), `status` (`received` | `processed` | `rejected`), `staff_note`, `handled_by_staff_id`, `created_at`, `processed_at`. Writes come only from the API's public endpoint (insert) and staff actions (update); customers cannot read it.

### 3.3 Platform (`platform`)

**`serper_cache`** (new): `query_hash text primary key`, `query text`, `results jsonb` (title, link, snippet per result, capped), `fetched_at`. Rows older than 7 days are ignored and purged by the nightly purge job.

**`credit_action_costs`**: unchanged (`find_new` 12, `refresh_data` 10, `refresh_tiktok` 30).

## 4. The run (worker; `discovery` module orchestration over the `creators` pipeline)

### 4.1 Starting (API, synchronous)
`POST /v1/discovery/jobs` with `{ kind: "live", search, maxNew, confirmedCost }` and an `Idempotency-Key`:
1. Validate the search with sub-project 3's `searchRequestSchema`; `maxNew` ∈ {5, 10, 20}.
2. Compute the maximum from the live prices (D2). If `confirmedCost` differs, answer `CONFLICT {confirmedCost, currentCost}` (same rule as every paid action).
3. If an open run with the same `search_hash` exists in the workspace, return it (200) without charging.
4. In one transaction: reserve the maximum, insert the job (`queued`), write the outbox event `discovery.live_requested` → **202** with the job (Diagram 7 "202 Accepted {job_id, poll_url}").
The `jobs` rate limit (20 starts per hour per user, from 4A) applies.

### 4.2 Worker steps
1. **Searching.** Build 2–3 Google queries per platform in scope from the chips, e.g. `site:instagram.com "bridal" "makeup" Lahore`, `site:tiktok.com bridal makeup Pakistan`, `site:youtube.com bridal makeup Lahore channel`. Each query is looked up in `serper_cache` first; a miss calls Serper (≤ 20 results) and stores the result. At most 9 Serper calls per run.
2. **Collecting.** Every result link goes through 4A's `normalizeProfileUrl` (post, reel, story and app links are not profiles and are dropped; a TikTok video link yields its `@handle`). Duplicates are removed. Links on the suppression list, and links of creators customers cannot see, are dropped.
3. **Filtering.** One AI call (feature `discovery_relevance`) receives the request and each candidate's platform, handle, Google title and snippet, fenced as untrusted data (like bios in 4A), and returns keep/drop with a one-line reason per candidate. The reply is validated against a schema; reasons are cleaned and refused if they carry links or contacts (4A's rule). If the AI fails twice, candidates are kept in Google's order with no reason (the run still works; the filter only saves money).
4. **Merging known creators.** Kept candidates MUSHIN already has (by canonical URL) become results immediately, `is_new = false`, `credits = 0`.
5. **Fetching.** The most relevant new candidates, at most `max_new`, are fetched: one Apify run for all Instagram handles, one for all TikTok handles (6 recent videos each), YouTube channels via the Data API. Before each Apify run the budget guard admits the batch at its estimated cost (count × per-profile worst case). Each platform's response is archived once per job (`raw_payloads`, as in 4A) and split per profile.
6. **Assessing and saving.** Each fetched profile goes through 4A's steps (clean, measure signals, AI assessment, possible-minor rules, contacts, links, photo, save) in its own transaction, which also inserts its `discovery_results` row (`is_new = true`, `credits` = its add price) and bumps the job's counters. Private, missing or unusable profiles are skipped and never charged. A save that finds the profile was added by someone else meanwhile becomes a known result (free).
7. **Ranking.** After each save, results are re-ranked by sub-project 3's `fitScore` against the run's filters; `fit_label` comes from the same thresholds as Brain 1.
8. **Finishing.** In one transaction: if there is at least one result, **partial commit** of `12 + Σ credits` and release of the rest; otherwise release everything (D3). The job becomes `completed`, and `notify.discovery_job_finished` is written (delivered in sub-project 7).

### 4.3 Retries and idempotency
The job runs at least once per delivery. A retry reuses: cached Serper results (step 1), the job's archived Apify responses (step 5), and existing `discovery_results` rows (a candidate already saved for this job is skipped). The runner's 3 attempts, the 30-minute stuck-job sweeper and refund-on-failure from 4A apply unchanged.

### 4.4 Spend caps
- **Apify:** 4A's monthly budget guard, now admitting a batch at its estimated cost.
- **Serper:** each call counts in `provider_calls`; at `SERPER_MONTHLY_SEARCH_LIMIT` (default 2,500) calls fail with `spend_cap` before reaching Serper. Cache hits are free and not counted.

## 5. Credits (billing engine)

- **New operation `commitPartial(tx, workspaceId, reservationId, amount, actor)`**: `0 ≤ amount ≤ reserved`. Charges `amount` from lots (as `commit` does) and releases the remainder; two append-only ledger entries (`spend`, `release`); `amount = 0` is a plain release. Runs inside the job's final transaction.
- The maximum and the per-creator prices are read from `platform.credit_action_costs`, so staff price changes reach the confirmation box and the charge together.
- A run whose reservation was released by the 15-minute cleanup while it waited in the queue saves its creators without a charge and logs it (4A's rule); the runner extends the reservation on every step.

## 6. API (`discovery` module; customer guard)

| Route | Purpose |
|---|---|
| `POST /v1/discovery/jobs` (`kind: "live"`) | Start a run (§4.1). `Idempotency-Key` required. 202 / 200 (existing open run). |
| `GET /v1/discovery/jobs/:id` | Job status, step and counters (`found`, `new`, `known`), plus `maxCost` and `creditsCharged`. |
| `GET /v1/discovery/jobs/:id/results?after=<seq>` | Result cards after the cursor: sub-project 3's `creatorCard` plus `isNew`, `reason`, `rank`. Polled every 2 s while open. |
| `GET /v1/discovery/jobs?active=true` | Unchanged; runs appear in the Jobs tray. |
| `DELETE /v1/creators/:id/reveal` | Owner/admin: remove the workspace's revealed contacts (D10). |
| `POST /v1/public/removal-requests` | No sign-in. `{ urls[1..3], email, reason?, confirm: true, website: "" }` (`website` is the bot trap). Always `202 {status: "received"}` for valid input. IP rate limit. |

**Staff API** (`/admin/v1`, staff guard, permission `creators.removal.review` for role `admin`):
| Route | Purpose |
|---|---|
| `GET /admin/v1/removal-requests?status=received` | List with matched creator (name, handle, platform), links, masked email, reason, date. |
| `POST /admin/v1/removal-requests/:id/approve` | Mark `processed` and queue `creator.erasure_requested`; audit-logged. |
| `POST /admin/v1/removal-requests/:id/reject` | `{ note }`; restore the creator to `active` (if no other open request names it); audit-logged. |

## 7. Erasure (worker, queue `erasure`, concurrency 1)

On `erasure.creator_requested` (the worker routes `creator.*` to another queue), each step safe to repeat:
1. Remove the creator from the Meilisearch index.
2. Delete storage files: every raw payload of the creator (files, then `raw_payloads` rows) and the avatar.
3. In one transaction: delete `creator_contacts`, `creator_links`, `profile_metric_snapshots` (via profiles), `enrichment_snapshots`, `creator_profiles`, every workspace's `contact_reveals` and `audience_views` for the creator, and their `discovery_results` rows; insert a suppression hash for every canonical URL of the creator and of the request; clear the creator's personal fields (display name → "Erased creator", handles, avatar, city, country, niches, tags, bio-derived fields, AI summary, minor reason) and set status `erased`.
4. Announce `notify.removal_processed` (the confirmation email is sent in sub-project 7). The requester's email stays encrypted until then, and a nightly job clears it 30 days after the request was handled.

A request that matched no creator still adds its URLs to the suppression list on approval.

## 8. Frontend (wiring plus the new screens)

- **Search page:** "Find New Creators" opens a new confirmation (search summary, 5 / 10 / 20 choice, cost lines and maximum from live prices) replacing the fixed-12 `CreditConfirm`. While a run is open, its results stream into the existing "streaming" state, with "New" and "Already in MUSHIN" badges and the fit label; Brain 1's results stay above. When Brain 1 returns `fewResults`, the note suggests "Find New Creators" and "add a creator by profile link".
- **Jobs tray:** live runs show "Finding creators: <summary>", the step and "N found so far"; the finished summary ("Found 9 creators (6 new) · 72 credits used, 240 returned") with **View results**, which opens the search page on that run.
- **Profile panel:** owners and admins see "Remove revealed contacts" when contacts are revealed.
- **Public page `#/remove-my-data`** (no sign-in), linked from the landing page footer: the request form and the "received" confirmation.
- **Admin:** `#/admin/login` uses the real staff login (password, then 2-step code) and session; "Removal requests" lists pending requests with Approve (confirmation dialog) and Reject (note). Other admin pages stay as they are.

## 9. Errors

| Code | When | HTTP / job |
|---|---|---|
| `CONFLICT` (`confirmedCost`, `currentCost`) | price changed | 409 |
| `INSUFFICIENT_CREDITS` / `ENTITLEMENT_REQUIRED` | from billing | 402 / 403 |
| `RATE_LIMITED` | `jobs` or IP bucket | 429 |
| `VALIDATION_FAILED` | bad search, size or removal-form link | 400 |
| `PROVIDER_UNAVAILABLE` (`reason: spend_cap` \| `provider` \| `not_configured`) | Serper or Apify down, capped or not set up; retries exhausted | job `failed`, everything released |
| `TIMED_OUT` | stuck past 30 minutes | job `failed`, everything released |
| `FORBIDDEN` | staff without the permission; member removing revealed contacts | 403 |

## 10. Testing (SRS §5.4)

- **Unit:** Google query building from chips; result-link to profile parsing (posts dropped, TikTok video links to handles); the relevance filter's schema and cleaning; maximum-cost calculation; `commitPartial` maths; suppression hashing; removal-form validation and bot trap; staff permission table.
- **Integration** (test database, recorded Serper and Apify responses, `MockLlm`, in-memory storage):
  - a full run: known candidates free, new ones charged at their platform price, a private one skipped, the rest released; ledger balances;
  - zero results releases everything; failure releases everything; the stuck sweep releases everything;
  - repeated click returns the same run; a retry never calls Serper or Apify twice and never charges twice;
  - Serper cache hit within 7 days, miss after; Serper cap stops calls;
  - results polling with `after` returns only new rows; workspace B cannot read workspace A's runs or results (RLS);
  - a public removal request hides the creator at once and answers the same for unknown links; reject restores; approve erases every listed item, keeps the tombstone and ledger, removes the index entry and blocks re-adding by link, refresh and discovery;
  - "Remove revealed contacts" deletes only that workspace's reveal; staff routes enforce the permission and write the audit log.
- **Fixtures:** one real Serper search recorded once (with the user's agreement; a fraction of a cent).
- **Live, opt-in** (`LIVE_SCRAPE_TESTS=1`): one real Serper query added to 4A's live check.
- **Browser** (with the user's agreement; about 50–100 credits): a real Find New Creators run, a removal request approved on the admin screen, admin sign-in with the 2-step code.

## 11. Environment

New: `SERPER_MONTHLY_SEARCH_LIMIT=2500`. Already set in `.env`: `SERPER_API_KEY` (verified). The worker reads the Serper key (the API never holds it); production requires it. Without it, live runs fail with `PROVIDER_UNAVAILABLE` and release the credits.

## 12. Out of scope

**Later:** confirmation emails to requesters and job notifications (sub-project 7); the rest of the admin tools, staff minor override and cost dashboard (sub-project 8); creator merging across platforms (TBD-010); similarity search (REQ-02.05, S2); "why this creator ranked here" explanations (REQ-02.08, S2); workspace data export and deletion (SRS §6.3 first bullet, account surfaces).

## 13. Implementation notes

Built on branch `feat/subproject-4b-live-discovery-erasure` (2026-10-09/10). Where the build departs from or adds to the sections above:

**Billing and database**
- **Quoted reservations:** the database's reservation policy (0005) allowed only an action's exact price. Migration `0013` keeps that defence and also allows `find_new` amounts of 12 + 5, 10 or 20 × the Instagram/YouTube or TikTok price.
- **Erasure reaches old jobs:** migration `0014` makes the workspace cleanup take the creator's profile links and scrub earlier add-by-link and refresh jobs that name them (security review). The eraser also drops cached Google results that mention the creator.
- **Simultaneous clicks:** both start paths return the open job when a second click fails for lack of credits because the first click already reserved them.

**Live runs**
- **Serper free plan:** 10 results per `site:` search (20 is refused), so up to 3 × 10 results per platform. The test fixture was recorded once from a real search (2026-10-09), with phone numbers in snippets removed.
- **Apify budget:** a batch is admitted only if all of it fits under the monthly budget (security review), not just the work already running.
- **Archive:** each fetched profile is archived on its own (not one file per batch), so erasure and re-assessment find a creator's own data.
- **Possible minors** found by a run cost nothing (they are hidden from the user).
- **Results:** the website polls one query per run with a cursor and re-reads the list once when the run finishes, so final ranks show.

**Erasure**
- **Stale links:** links are resolved again when the erasure runs, so a creator added after the request was made is erased too (security review).
- **Open decision:** an unverified request hides a creator at once (D7). Staff rejection restores them; the public form is limited per IP. Optionally, a new request could be stopped from re-hiding a creator whose request staff rejected in the last 30 days.

**Smaller corrections to the plan:** carry-over type changes between tasks; test data fixed (valid hashes, the fixture's random handle, counting only new outbox events); the staff sign-in screen rewritten in full; prices for the confirmation box come from the billing plans response.

**Evidence**
- Live check (`LIVE_SCRAPE_TESTS=1`, 2026-10-10): one real Serper search returned Instagram profile links and was recorded as a provider call.

## 14. Current implementation status (2026-10-13)

This section records the implementation state after the `fffc751` baseline. It supersedes stale statements above where the shipped behavior has moved on.

**Verified in this worktree**
- Discovery estimates are server-priced, expire after 15 minutes, and are consumed atomically with the credit reservation, job and outbox event. Existing database integration tests cover expiry, concurrent confirmations, failures, retries, duplicate delivery and credit settlement.
- The query planner now has at most three deterministic rounds. Round one is English precision; later rounds use a small explicit Roman Urdu/Urdu-script topic map for supported Pakistani niches or English recall templates. It stops early after eight unique, normalized profile URLs. Serper receives `gl`, `hl`, `num <= 10`, and `autocorrect=false`; locale and query are included in the cache key. Unsupported topics are not machine-translated.
- The configured Instagram actor returned one real dataset item for the smoke-test handle. The observed item included `username`, `biography`, `followersCount`, `followsCount`, `postsCount`, `latestPosts`, `isBusinessAccount` (boolean) and `businessCategoryName` (string); the handle matched and the provider adapter recorded $0.0026. The selected actor build is pinned to `0.0.634`, and that exact build selector passed the smoke test. This verifies that actor call and observed output only; it is not a legal/retention review or full paid-workflow verification. Do not reject every `isBusinessAccount=true` profile: the field alone also labels some individual creators and publishers.
- Unit tests (266), TypeScript, lint, module-boundary checks and the React/Vite production build passed. The frontend emits existing upstream-comment and large-chunk warnings.
- Integration setup now refuses non-local or ambiguously named databases before migration. The configured `TEST_DATABASE_URL` resolves to a remote Supabase host, and no local Postgres/Docker executable is available. `npm run test:int` was invoked only to verify the guard; it stopped before migration, truncation or test execution.

**Still incomplete / release gates**
- Integration cases listed in §10 remain unexecuted against a disposable local database. The next test environment must use a local database named with `test` or `disposable`; never point this suite at the configured remote host.
- Persisted progress still exposes only the current step and found/new/known totals. The fuller funnel counters and terminal outcomes (`succeeded`, `completed_empty`, `insufficient`, `partial`, `canceled`, `expired`) from the current build spec have not been added; do not describe progress as full-funnel accurate.
- The current runner still uses the existing relevance/ranking pipeline and settlement rules. It has not yet implemented the full G1 cheap gate, minimum-pool `insufficient` settlement, evidence-backed Fit/Authenticity contract, or source/evidence funnel persistence described by the newer consolidated spec.
- TikTok's configured actor remains on the moving `latest` build and was not live-validated in this work. Instagram actor terms/retention approval and a broader profile/business-output panel remain open.
- Catalog Search still uses the existing Meilisearch runtime. Defer its PostgreSQL-native migration, and the Supabase runtime migration, until the complete Live Discovery workflow and its local integration tests pass.

## 15. Verification and implementation update (2026-10-13, continued from `1c9088b`)

**Code changed in this continuation**
- Live jobs now persist monotonic funnel counters for Serper results, normalized/deduplicated candidates, ambiguous candidates, extracted profiles, visible qualified cards, persisted results, and billable creators. The frontend reports searched, qualified and saved counts separately; it does not show a fabricated percentage. `snippetGatePass` remains zero because the deterministic cheap snippet gate is not implemented yet; ambiguous candidates continue through the schema-validated relevance adapter.
- After the allowed query rounds, fewer than eight relevance-approved profile candidates now finishes as `insufficient`, commits a zero-amount settlement (releasing the full reservation), and emits the normal completion event. A viable pool that produces no visible saved profiles finishes as `completed_empty`; a result-bearing run finishes as `succeeded`.
- A permanent error after visible results have been persisted now settles the search component plus only persisted billable creator credits, releases the unused reservation, and returns `partial` with an accurate user message. A failure with no delivered result remains `failed` and releases the reservation. A row lock serializes terminal settlement for duplicate worker deliveries.
- The additive migration `0017_live_discovery_progress_outcomes.sql` adds the progress object and live outcome values while retaining the generic job status values consumed by the existing job system. API contracts and status wording were updated.

**Checks run in this worktree**
- TypeScript typecheck, ESLint, module-boundary check and frontend Vite production build passed. The frontend build retains the existing upstream Zod annotation and large-chunk warnings.
- Unit suite passed: 266 tests across 37 files. Frontend mapping tests run as part of that root suite.
- The integration global setup was run with a deliberately fake remote hostname. It refused the URL before connection, migration, truncation or test discovery. Its unit safety cases also passed.
- Database integration tests were not run: this Windows environment has no PostgreSQL server/client, Docker/Podman, Supabase CLI or WSL distribution. The existing `.env` test URL is remote and was never supplied to an integration invocation. Quote expiry, duplicate/concurrent confirmation, retry, provider failure and ledger settlement therefore remain unverified against a database.
- One explicitly bounded live TikTok profile extraction through `clockworks/tiktok-profile-scraper` returned two dataset items; the actor output contained `input`, `authorMeta`, profile counters and post metrics, and the requested handle matched. The adapter recorded the call. The actor has no configured build pin, so behavior is not reproducible against a fixed actor build. The prior Instagram validation remains limited to the pinned `0.0.634` run documented in §14.

**Remaining release gates**
- Provision a disposable local PostgreSQL service and run the integration project; never reuse the remote Supabase test URL.
- The current “qualified” progress count is the existing visibility/ranking result, not the specification's G3 Campaign Fit gate. The separate deterministic topic Fit model, minimum Fit threshold, individual-account evidence gate and authenticity/evidence contract are still incomplete. The current relevance LLM is not a score or billing authority, and implementation status must not be read as verification of those G3 requirements.
- The cheap G1 snippet/persona gate and evidence/source funnel persistence are incomplete. `snippetGatePass` intentionally stays at zero; candidate rejection reasons are not yet persisted as a full funnel.
- Duplicate terminal settlement is locked, but running-job claims are not yet lease-based; simultaneous worker delivery during provider calls and ambiguous provider outcomes still need integration/recovery tests.
- TikTok requires a reviewed actor build pin and output validation against that exact pin. Do not treat the moving-build smoke test as a production integration gate.
- Catalog Search remains on Meilisearch. Do not migrate it, or the runtime to Supabase, before the complete Live Discovery workflow and local database integration suite are verified.

## 16. Verification and implementation update (2026-10-13, continued from `e8dd22f`)

This section supersedes earlier status bullets in §§14–15 where they conflict.

**Implemented in the current worktree**
- TikTok's `clockworks/tiktok-profile-scraper` configuration now pins build `0.99.2065`. A real bounded actor run against that build returned three items for the requested profile; the actor's `input` and `authorMeta.name` agreed with the requested handle, and the standardizer mapped the public profile and sampled-video fields. The live call cost $0.018. The adapter now drops TikTok rows whose requested input and reported author identity disagree. This verifies one profile/output shape, not every account or provider failure mode.
- Live results now carry separate, versioned `mushin-live-fit-v1` evidence (source URL, original fetch time, sample count, normalized topic score, context confidence and reasons). The deterministic gate requires sampled recent topic evidence, a positive individual-creator lexical cue, visibility/minor clearance, activity within 90 days, platform match and score >=50. The job-specific Fit is returned to the UI and used for live ranking; it does not replace Catalog Search scoring. Profiles that fail the gate are not delivered or billed. Existing creators are reused only when retained source payloads provide a usable job-specific sample; otherwise they remain available through free Catalog Search and are omitted from this run.
- `0018_live_discovery_campaign_fit.sql` adds an optional result evidence column. The migration is additive and existing result rows remain readable with `campaign_fit = null`.
- Integration-test configuration and `.env.example` now point to the local disposable database name. The URL guard runs before migrations and truncation and accepts only loopback hosts plus a database name containing `test` or `disposable`.

**Verification actually completed**
- Unit tests passed: 272 tests across 38 files. TypeScript typecheck, ESLint and dependency-boundary checks passed. The React/Vite production build passed with the existing upstream-comment and large-chunk warnings.
- The real TikTok actor run described above passed its observed-handle and output-mapping checks; do not generalize the result beyond that account and build.
- A portable PostgreSQL 17.11 archive was downloaded and matched its published SHA-256. `initdb` completed in the workspace. The server then failed to bind `localhost` (`127.0.0.1` and `::1`: `Permission denied`), including on the elevated shell attempt. It did not accept connections.
- `npm run test:int` with the currently configured test URL stopped in global setup because that URL fails the localhost/disposable-name guard. A second run with an explicit local disposable URL passed the guard but failed connecting to loopback (`ECONNRESET`) while attempting the first migration bootstrap statement. No migration completed, no truncation ran, and no database test executed. The guard's unit tests continue to cover remote URLs.

**Still incomplete / release gates**
- Quote expiry, replay/concurrent confirmation, retry, provider failure, partial-result and settlement integration cases remain unverified against PostgreSQL. The exact blocker is this environment's denial of local loopback binds; never work around it by using the remote test/Supabase URL. Once local port binding is allowed, use `localhost:5432/mushin_disposable_test` and rerun `npm run test:int`.
- The Fit implementation is deliberately conservative but not yet calibrated to the source formula: account-type classification is lexical rather than a validated individual-probability classifier; topic matching is deterministic caption/hashtag phrase matching rather than the fixed taxonomy classifier; Roman Urdu and declared-language shares are not fully identified. These signals can exclude legitimate creators and are not a production launch validation panel. The score threshold and provisional coefficients require calibration.
- Known catalog creators are deduplicated and omitted from paid Live Discovery results until they can be evaluated with job-scoped evidence. YouTube's hidden-subscriber-count normalization still stores a zero in the legacy numeric metric field; a nullable/provenance migration is still needed before that field can be represented as unknown throughout the product.
- Candidate rejection evidence and the cheap G1 pass/reject funnel are not yet persisted per candidate. Job counters still do not retain those rejection reasons.
- No end-to-end Live Discovery run is verified against a real database. The workflow must not be marked complete, and Catalog Search must remain on Meilisearch, until the local database suite passes and API/persistence/ledger/UI state are reconciled.

## 17. Verification and implementation update (2026-10-13, continued from `1932d70`)

This section supersedes earlier implementation-status statements where they conflict.

**Implemented and verified in this continuation**
- A local PostgreSQL 17.11 service was available on `127.0.0.1:5432`. Testing used only the newly created `mushin_disposable_test` database. Integration setup still rejects remote hosts or database names without `test`/`disposable`; no Supabase or production URL was used. Local PostgreSQL has SSL disabled, so the database client now disables TLS only for loopback URLs without a CA; remote URLs retain TLS behavior.
- `0019_unknown_follower_counts.sql` makes profile and metric-snapshot follower counts nullable. YouTube's hidden or missing subscriber count now standardizes to `null`, remains nullable through profile and append-only metric history, API contracts and frontend display, and generates no follower-based authenticity signals or tier when unknown. A requested follower range rejects a profile with an unknown count. Customer-facing catalog cards, profile views and search-index projection also treat the legacy YouTube `0` written by the former normalizer as unknown; catalog filtering does not allow unknown counts to satisfy an explicit numeric follower filter. Historical metric snapshots were not rewritten, preserving their append-only contract.
- Fit now recognizes reviewed Roman Urdu variants for supported niches, measures a Roman Urdu caption share when the brief asks for Roman Urdu, and recognizes a narrow first-person Roman Urdu creator cue in public profile text. Unit cases cover these paths, off-topic and business/minor/activity gates, and missing requested follower counts. These remain provisional deterministic heuristics; no calibration dataset or production threshold calibration is claimed.
- The opt-in real-provider test `LIVE_DISCOVERY_E2E=1` completed twice against the final code: real brief → quote → confirmation → reservation → Serper queries → pinned Instagram actor extraction → deduplication/Fit evidence → PostgreSQL profile/result persistence → terminal success → credit settlement, with a real result each time. Provider calls and profile/payload rows were recorded in the local database; the final available/reserved balance matched the settled charge. The relevance and creator-assessment LLM was a deterministic test fixture, and raw payload storage used memory storage, so this does not verify hosted LLM or Supabase Storage behavior.
- The existing bounded live-provider smoke test also passed for one Instagram, TikTok and YouTube sample and one real Serper search. The configured default actor builds are pinned to Instagram `0.0.634` and TikTok `0.99.2065`; those assertions verify the observed sample shapes and identity mapping only. The Supabase Storage round-trip test was excluded from that live smoke invocation.

**Checks**
- Unit suite: 279 tests passed across 39 files.
- PostgreSQL integration suite: 266 tests passed, 5 skipped across 35 files (32 passed, 3 skipped). It covers quote expiry, concurrent and duplicate confirmation, retries, provider failures, partial/empty outcomes, settlement, RLS, schema drift, hidden-count persistence and legacy profile projection. Three optional live suites are skipped by default.
- TypeScript typecheck, ESLint, dependency-boundary check and React/Vite production build passed. The frontend build retains the existing upstream Zod annotation and large-chunk warnings.
- Remote-database safety tests passed as part of the unit suite. Live Serper and Apify calls ran only in the explicitly opted-in provider checks; their credentials were not written to source or reported.

**Remaining verification limits**
- Fit coefficients, lexical individual-account cues and the `50` eligibility threshold are not calibrated against a labeled evaluation set. They may exclude legitimate creators and must remain described as provisional.
- The hosted LLM live test and Supabase Storage round-trip were not run. The real-provider database workflow uses deterministic LLM and memory-storage adapters.
- Historical append-only metric snapshots and already-written Meilisearch documents may retain old YouTube zeros produced before this change. Current profile/card API hydration exposes ambiguous profile zeros as unknown, explicit follower filters exclude unknown values, and new index projections emit null; no historical snapshot was rewritten and the Meilisearch index was not rebuilt here.
- Catalog Search remains on Meilisearch; no catalog-search or runtime migration was performed.

## 18. Verification and implementation update (2026-10-13, continued from `050201d`)

This section supersedes earlier status statements in §§14–17 where they conflict. It records the current committed-source verification; the scoring thresholds remain provisional.

**Live Discovery and hosted integrations**
- Added the documented cheap candidate gate. Explicit business/shop results are dropped before extraction; topic-supported public results may enter the possible-profile pool; only ambiguous results are sent to the schema-validated relevance LLM. This gate does not assert personhood or campaign eligibility. The profile gate still requires individual-creator evidence, sampled recent topic evidence, activity, platform/metric checks and visibility/minor clearance before persistence or creator charging. Persisted `snippetGatePass` and `ambiguousCandidates` counters now reflect the gate.
- Two final opt-in provider E2E runs used real Serper, the pinned Instagram actor, the configured hosted LLM adapter(s), and only local `mushin_disposable_test` PostgreSQL. The runs completed the brief → quote → confirmation → reservation → multilingual search rounds → cheap/relevance gates → extraction → Fit/evidence → persistence → settlement chain. One run persisted 2 creators after extracting 5 and charged 32 credits; the final run persisted 1 after extracting 5 and charged 22 credits. Each charge matched the existing rule of 12 search credits plus 10 credits per persisted new Instagram creator; the test asserted zero remaining reservation and the matching available balance. Provider-call and local result/profile/evidence rows were reconciled after the final run. Search yield differed between live runs, as expected for current providers; no result was substituted or fabricated.
- The final run recorded 30 Serper results, 17 normalized/deduplicated profile candidates, 14 topic-supported possible candidates, 1 ambiguous candidate, 5 extracted profiles, 1 eligible/persisted evidence-backed result, and outcome `succeeded`. The configured Groq and `ollama` adapter attempts were recorded, including Groq failures and successful provider responses/fallback. A separate controlled hosted-LLM JSON smoke test passed (1/1). Unit coverage verifies malformed-response correction/failure, provider fallback, timeouts, and a simulated HTTP 429 retry; no live 429 was intentionally induced.
- The real discovery E2E uses `MemoryStorage` for raw payload/object storage. Supabase Storage was not exercised, so the E2E does not validate external bucket writes or retention behavior. Live actor validation remains limited to the observed pinned Instagram build/output and sample profiles.
- Search Relevance, Campaign Fit and Authenticity remain distinct. The lexical individual-creator cues, topic aliases, and Fit threshold are provisional; no labeled evaluation set or calibration claim exists. Candidate-level rejection reasons are not yet retained as a per-candidate audit trail.

**Catalog Search migration**
- Added migration `0020_postgres_catalog_search.sql` with a worker-maintained `gcp.creator_search_documents` projection, initial visible-creator backfill, full-text and trigram search indexes, typed filter indexes, stable browse ordering, and no audience-demographic projection. Search documents are dual-written to PostgreSQL and to Meilisearch when that rollback backend is configured; reconciliation checks both projections.
- PostgreSQL-native Catalog Search is now the default. `CATALOG_SEARCH_BACKEND=meilisearch` retains the rollback route; Meilisearch was not removed. Queries execute through the tenant database context, enforce active/minor visibility, use typed filters and bounded candidate hydration, and return an exact match count. `search.int.test.ts` compares representative filtered, spelling-alias and paginated results with a uniquely named Meilisearch test index and runs both backends against the same five-query/1,000-creator p95 panel. Both met the test threshold. This is a representative regression panel, not a broad labeled relevance evaluation.
- The additive migration, projection and parity/performance tests passed on the disposable local PostgreSQL database. No remote Supabase/production database was used for destructive tests.

**Checks completed on the final code**
- Unit: 286 passed across 39 files.
- PostgreSQL integration: 267 passed, 5 skipped across 35 files (32 files passed, 3 optional live suites skipped by default).
- Real Live Discovery provider E2E: 1 passed in each of two runs; direct hosted LLM smoke: 1 passed.
- TypeScript typecheck, ESLint, dependency boundaries (241 modules, 882 dependencies), and React/Vite production build passed. Existing Zod annotation and large frontend chunk warnings remain.

**Remaining runtime and release work**
- The catalog cutover has a runtime rollback flag and continues writing Meilisearch when configured; production cutover/rollback has not been deployed or verified against a staging project.
- The target Supabase Edge Function / `pg_cron` worker runtime has not been migrated. The current application has a Fastify API and a Node worker/pg-boss process; this repository contains no Supabase Functions project. The Live Discovery runner still performs multiple provider rounds and bounded profile extraction/processing within one job invocation. Porting it directly to one Edge Function request would not meet the target's one-bounded-stage execution model. Before that move, persist explicit stage checkpoints/leases, provider run IDs/unknown outcomes and a recovery sweep, then measure deployment-specific execution limits in a non-production Supabase project. Supabase Storage and Edge runtime behavior remain unverified here.
- Fit remains provisional, and the live provider's candidate/result yield varies between runs. Continue the labeled English/Urdu/Roman Urdu quality panel before describing scores as calibrated or launching a broad paid pilot.

## 19. Three-platform real-provider verification (2026-10-13)

This section supersedes the earlier single-platform verification scope above. Destructive integration tests and live workflow persistence used only `127.0.0.1:5432/mushin_disposable_test`; the `.env` database URL was remote and was overridden in every test process. A direct PostgreSQL query confirmed the selected database and server address before the test suite ran. The remote Supabase URL was never used for test resets.

**Implementation changes made for verification quality**
- First-round search now makes three role-specific, platform-filtered queries (`content creator`, `blogger`, `influencer`) with the selected city or country. It no longer spends one of the first-round queries on a bare niche term. Adaptive Urdu-script and Roman Urdu rounds remain conditional on a thin candidate pool.
- A multi-platform brief now selects extraction candidates round-robin across Instagram, TikTok, and YouTube before applying the global `maxNew` cap. Previously, search covered all platforms but the first platform could consume the entire extraction cap.
- The opt-in live integration harness reports actual query strings, normalized URL duplicates, provider-call status/latency, standardized profile counts, evidence-gate rejection reasons by platform, delivered results, terminal state, and quote/charge/release amounts. It reads raw provider responses only from test `MemoryStorage`; those raw responses are not written to the repository or printed.
- Added a regression that equal handles on different platform URLs remain separate candidates and that extraction slots spread across platforms. This prevents a false merge based on handle alone; it does not implement cross-platform person resolution.

**Dedicated real-provider runs**

| Platform / brief | Search and extraction funnel | Eligibility and delivery | Credits / duration |
|---|---|---|---|
| Instagram — “Pakistani food blogger in Karachi” (English, Food) | 3 real Serper queries: `site:instagram.com food content creator karachi`; `site:instagram.com pakistani food blogger blogger karachi`; `site:instagram.com pakistani food blogger influencer karachi`. 30 search results → 12 unique profile URLs (18 duplicate/non-profile results rejected) → 5 profiles extracted by pinned `apify/instagram-profile-scraper` build `0.0.634` and standardized. | 2 delivered with eligible Campaign Fit and source evidence. 2 rejected as `individual_creator_unverified`; 1 rejected as `below_min_fit`. No search, actor, or database errors. | 62 reserved; 32 charged; 30 released. 75.130 s total; actor 30.111 s. |
| TikTok — “Pakistani travel vlogger in Karachi” (English, Travel) | 3 real Serper queries: `site:tiktok.com/@ travel content creator karachi`; `site:tiktok.com/@ pakistani travel vlogger blogger karachi`; `site:tiktok.com/@ pakistani travel vlogger influencer karachi`. 30 search results → 28 unique profile URLs (2 duplicates) → 5 extracted and standardized through pinned `clockworks/tiktok-profile-scraper` build `0.99.2065`. | 0 delivered. 4 rejected as `individual_creator_unverified`; 1 rejected as `off_topic`. The actor call and response mapping succeeded; the campaign ended `completed_empty`. No search or actor error. | 162 reserved; 0 charged; 162 released. 83.727 s total; actor 38.195 s. |
| YouTube — “لاہور میں کھانے کے بلاگر” (Urdu script, Food) | 3 real Serper queries: `site:youtube.com/@ food content creator pakistan`; `site:youtube.com/@ لاہور میں کھانے کے بلاگر blogger pakistan`; `site:youtube.com/@ لاہور میں کھانے کے بلاگر influencer pakistan`. 13 results → 13 unique channel profiles → 5 channels fetched with the configured YouTube Data API adapter and standardized. YouTube is not configured as an Apify actor. | 1 delivered with eligible Fit and source evidence. 4 rejected as `individual_creator_unverified`. Groq errors fell back to Ollama; no search or YouTube API error. | 62 reserved; 22 charged; 40 released. 55.805 s total; YouTube API calls 3.976 s combined. |

**Cross-platform Roman Urdu run**
- Brief: “Lahore ke khana bloggers”, city Lahore, country PK, Food niche. Nine real Serper queries (three per platform):
  - Instagram: `site:instagram.com food content creator lahore`; `site:instagram.com ke khana bloggers blogger lahore`; `site:instagram.com ke khana bloggers influencer lahore`.
  - TikTok: `site:tiktok.com/@ food content creator lahore`; `site:tiktok.com/@ ke khana bloggers blogger lahore`; `site:tiktok.com/@ ke khana bloggers influencer lahore`.
  - YouTube: `site:youtube.com/@ food content creator lahore`; `site:youtube.com/@ ke khana bloggers blogger lahore`; `site:youtube.com/@ ke khana bloggers influencer lahore`.
- 84 Serper results → 70 same-platform profile URL occurrences: 15 duplicate canonical profile URLs and 14 non-profile/unsupported URLs were removed, leaving 55 unique candidates; no wrong-platform URLs were observed. The deterministic topic gate marked 42 possible; 13 went to hosted relevance review; none were rejected by the cheap gate. Five profiles were extracted and standardized: Instagram 2, TikTok 2, YouTube 1. All three actual extractors returned successful provider calls.
- Per-platform Fit/delivery: Instagram 2 attempts, both delivered; TikTok 2 attempts, 0 delivered, both `inactive_or_unverified`; YouTube 1 attempt, 0 delivered, `off_topic`. Overall `succeeded`, two evidence-backed results. Both delivered results were Instagram; extraction from TikTok/YouTube did not imply delivery.
- Credits: 162 reserved, 32 charged (12 search + 20 for two new Instagram creators), 130 released. Job attempt count was 1. Nine Serper calls took 14.549 s combined; Instagram actor 10.690 s; TikTok actor 16.406 s; YouTube API 1.119 s; total workflow 96.430 s.
- The hosted LLM path was exercised. In this run Groq recorded 10 assessment errors and 2 relevance errors; Ollama completed 7 assessments and 1 relevance request. These errors were recorded under a generic provider `error` code; available telemetry does not distinguish rate limits from malformed responses or other provider errors. No timeout or worker retry occurred.

**Response mapping, identity, and interpretation**
- The real Instagram, TikTok, and YouTube responses all standardized and persisted through the local database path. For the sampled live profiles, follower, engagement, and average-post metric fields were populated; this sample did not exercise missing live metric values. Existing regression tests verify that missing/hidden YouTube subscriber counts remain `null` in standardized profiles, profile reads, and creator cards. The discovery response mapping tests passed, and each delivered result in the live harness had `eligible: true`, an HTTPS evidence source, and evidence strings.
- Provider mismatch protections remain in `splitByHandle`: TikTok rows are associated only when actor-reported author and requested profile agree; a unit regression rejects a mismatched author. No mismatch was observed in the live sample, but a separate count of discarded actor rows is not persisted.
- URL deduplication does not merge equal handles across platforms. The schema permits multiple platform profiles under one creator, but this implementation has no automatic cross-platform same-person resolver. Same-person consolidation therefore remains unverified; matching a handle or display name is not a safe substitute.
- The previous Instagram runs that delivered two and one creators used changing Serper candidate sets and the bounded five-profile sample, then different hosted relevance/Fit decisions; the current Instagram run again delivered two from five extracted. The persisted funnel and rejection records show that eligible yield is sensitive to search coverage, provider output, and the provisional Fit gates. No evidence indicates those earlier counts came from duplicate merging. Fit is not calibrated.
- Database creator/profile/result rows and credit ledger were real PostgreSQL writes. Raw-object storage remained the explicit `MemoryStorage` test fixture; no Supabase Storage round-trip was included in these full workflow runs.

**Verification after implementation**
- Dedicated Live Discovery runs: Instagram succeeded with 2 delivered; YouTube succeeded with 1 delivered; TikTok completed empty with 0 delivered. The cross-platform Roman Urdu run succeeded with 1 delivered across all three extractions.
- Unit and PostgreSQL integration suite: 554 passed, 5 skipped across 74 files; all database tests pointed to the disposable localhost database. A previous attempt failed only because two old assertions expected two first-round search calls; those assertions were updated and the focused Live Discovery integration file passed 10/10 before the full rerun.
- TypeScript, lint, dependency-boundary check, frontend discovery mapping tests, and production frontend build passed. The build retains existing upstream Zod comment and large-chunk warnings.

**Remaining release blockers**
- TikTok's actual extraction and persistence were verified, but no tested TikTok campaign delivered an eligible creator. Do not describe TikTok Live Discovery as fully verified until a real evidence-backed TikTok result is delivered and correctly settled.
- Cross-platform same-person identity resolution is absent and requires an explicit, high-confidence evidence policy before implementation; false merges must remain prohibited.
- Groq provider errors have generic telemetry codes; their exact causes remain unknown. Supabase Storage was not used in the local E2E test. Campaign Fit remains provisional and should not be called calibrated.
- No Catalog Search or runtime migration was performed in this task.
