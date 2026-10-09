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

On `creator.erasure_requested` for a creator, each step safe to repeat:
1. Remove the creator from the Meilisearch index.
2. Delete storage files: every raw payload of the creator (files, then `raw_payloads` rows) and the avatar.
3. In one transaction: delete `creator_contacts`, `creator_links`, `profile_metric_snapshots` (via profiles), `enrichment_snapshots`, `creator_profiles`, every workspace's `contact_reveals` and `audience_views` for the creator, and their `discovery_results` rows; insert a suppression hash for every canonical URL of the creator and of the request; clear the creator's personal fields (display name → "Erased creator", handles, avatar, city, country, niches, tags, bio-derived fields, AI summary, minor reason) and set status `erased`.
4. Mark the request's confirmation as pending (sent in sub-project 7), then clear the requester email.

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
