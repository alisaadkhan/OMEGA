# Sub-project 3: Creator Plane & Search — Design

**Date:** 2026-10-08 · **Status:** draft for review · **Umbrella spec:** `2026-10-06-mushin-backend-architecture-design.md` (§3 row 3, §5.4, §5.5, §5.12, §7) · **Requirements:** `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf` (SRS), `reference_files/MUSHIN_System_Diagrams.pdf` (Diagrams)

## 1. Intent

Deliver the "time to first aha" (SRS §5.4: sign-up to a ranked search result in under 5 minutes) over creators MUSHIN already knows — the **Brain-1** indexed path (Diagrams 6, 7). A signed-in user searches with filters or plain English, sees fit-ranked creators in under a second, opens a unified creator profile with freshness, an AI summary and authenticity evidence, sees the estimated audience within their plan's limit, reveals contact details for 5 credits after confirming, saves and re-runs searches, and looks up any creator from a top-bar omnibar.

This sub-project builds the **read side** of creator data. The **write side** — scrapers, live discovery (Brain-2), add-by-URL, paid refresh, enrichment, authenticity scoring, minor detection, erasure — is sub-project 4. Until then, development and tests run on seeded demo creators; production starts empty (architecture Q15).

**Done when** on seeded data a signed-in user: runs a filter search and a plain-English search (editable chips) and gets fit-ranked results under 1 s; opens a profile showing per-metric freshness, a generated AI summary, authenticity evidence or "Not yet assessed", and the estimated audience (counted against the plan); reveals contacts through a 5-credit confirmation with exactly one charge; saves and re-runs a search; finds a creator from the omnibar. All behaviour is covered by tests and `npm run verify` passes.

## 2. Decisions

Every decision was checked against the SRS and the Diagrams; where they speak, they win.

| # | Decision | Source |
|---|---|---|
| D1 | **No embeddings or similarity search** in this sub-project; no `embedding` column yet (added later by expand-only migration). | SRS REQ-02.05 is Should/**S2**; architecture Q4 defers S2; user: "go with the SRS" |
| D2 | **Fit ranking = Meilisearch retrieval + deterministic MUSHIN scoring** of the top candidates. No LLM call per search; the LLM only interprets plain-English queries into chips. | SRS REQ-02.03 (fit, not follower count), NFR-P01 (< 1 s), §3.3 (LLM for query interpretation); Diagrams 6–7 (LLM ranking only on the Brain-2 path); user: "go with the reference-file" |
| D3 | Brain-1 results show a **fit label and score only**; "why ranked here" explanations are not built. Reasons/pros/watch-outs on profiles come from Brain-2 assessment (sub-project 4). | SRS REQ-02.08 is Could/**S2** |
| D4 | **Contact reveal is per creator**: one click reveals all of a creator's emails and phone numbers for **5 credits**, once per workspace. Social profile links are public and always shown. | SRS REQ-01.03, §4.1.2, §5.2; Q12 (cost 5); user choice A |
| D5 | **Audience view** = the first opening of a creator's estimated-audience section by a workspace in a calendar month. Explorer and trial: 5/month; Growth/Scale: unlimited; expired/canceled: none. Repeat views of the same creator that month are free. | Billing entitlements (`audienceViewsPerMonth`, `lostAccess: audience_details`); SRS silent on counting; user choice A |
| D6 | **AI summary generated when a profile is opened** (if missing or stale), asynchronously, cached per creator for all workspaces, free to users. | SRS §4.3.2, REQ-03.01; Q12 has no summary price |
| D7 | Authenticity score is **only ever returned together with its evidence**; without an enrichment snapshot the profile shows "Not yet assessed". | SRS REQ-01.02, §3.1, §5.5 |
| D8 | **Meilisearch**: a local Meilisearch for development and tests; **Meilisearch Cloud for production** (created at deploy). The previous Cloud instance no longer exists. Same code via a `SearchIndex` adapter. | SRS §2.4, §3.3; user choice A |
| D9 | **Omnibar** added to the top bar (new UI): look up a creator by name, handle or URL. | SRS §3.1; user chose the SRS over "wiring only" (Q5) |
| D10 | **Freshness**: a metric is `current` if updated ≤ 7 days ago, `aging` ≤ 30 days, `stale` after; thresholds are settings. | SRS REQ-01.06 (no numbers given) |
| D11 | Development/test **seed of the frontend demo creators** (`npm run seed:creators`), refused in production. | Architecture Q15 |
| D12 | **Possible minors**: excluded from the search index, contact reveal refused (service + database trigger), profile explains why. Only MUSHIN staff can override (staff screen: sub-project 8). | SRS §5.2, §5.5; architecture §5.12 |

**Open items carried from the SRS (not decided here):** TBD-002 final per-action credit prices (reveal uses the seeded 5); TBD-007 final LLM provider/routing (Groq default, Ollama Cloud fallback, models are settings); TBD-010 cross-platform identity resolution (creator merging is sub-project 4).

## 3. Data model (migration `0009_creator_plane.sql`)

### 3.1 Global Creator Plane (`gcp`, shared, no `workspace_id`)

| Table | Columns |
|---|---|
| `creators` | `id`, `display_name`, `primary_handle`, `primary_platform` (`instagram`/`tiktok`/`youtube`), `avatar_url`, `city`, `country` (ISO 3166-1 alpha-2), `niches text[]`, `tags text[]`, `name_variants text[]` (transliteration aliases, SRS §6.2), `verified`, `authenticity_score` (0–100, null until assessed), `fake_follower_pct`, `ai_summary`, `ai_summary_model`, `ai_summary_at`, `ai_summary_source_hash`, `ai_summary_failed_at`, `is_minor` (default false), `minor_override_by_staff_id`, `minor_override_reason`, `status` (`active`/`merged`/`removal_requested`/`erased`), `merged_into_id`, `last_enriched_at`, `created_at`, `updated_at` |
| `creator_profiles` | `id`, `creator_id`, `platform`, `handle`, `canonical_url`, `followers`, `following`, `posts`, `engagement_rate` (percent), `avg_likes`, `avg_comments`, `avg_views`, `bio`, `followers_updated_at`, `engagement_updated_at`, `audience_updated_at`, `last_scraped_at`, `created_at`, `updated_at`; **unique (`platform`, `canonical_url`)** |
| `creator_contacts` | `id`, `creator_id`, `kind` (`email`/`phone`), `value_encrypted` (AES-256-GCM, `DATA_ENCRYPTION_KEY`), `value_hash` (dedupe), `masked`, `trust` (`verified`/`likely`/`unverified`), `source`, `first_seen_at`, `last_seen_at`, `last_verified_at` |
| `enrichment_snapshots` | **append-only** (no `UPDATE`/`DELETE` for any app role): `id`, `creator_id`, `verdict`, `authenticity_score`, `evidence_breakdown jsonb` (list of `{signal, detail, weight}`), `audience jsonb` (age/gender/cities/countries, each with `source` and `confidence`), `model_version`, `confidence`, `created_at` |

Constraints: a non-null `creators.authenticity_score` requires at least one enrichment snapshot with non-empty evidence (enforced by the writer in sub-project 4 and by the API read rule, D7). `gcp` tables carry **no `workspace_id`** (SRS §6.1, tested).

### 3.2 Workspace Plane (`wp`, RLS on `workspace_id`, forced)

| Table | Columns |
|---|---|
| `contact_reveals` | `workspace_id`, `creator_id`, `revealed_by`, `ledger_reservation_id`, `created_at`; **unique (`workspace_id`, `creator_id`)** |
| `audience_views` | `workspace_id`, `creator_id`, `month` (date, first of month UTC), `viewed_by`, `created_at`; **unique (`workspace_id`, `creator_id`, `month`)** |
| `saved_searches` | `workspace_id`, `name`, `query_text`, `filters jsonb`, `created_by`, `created_at`, `updated_at` |

### 3.3 Platform config

`platform.niches` (`id`, `label`, `sort_order`, `active`): the niche vocabulary for filters and query interpretation, seeded with Bridal, Fashion, Beauty, Tech, Food, Travel, Comedy, Finance, Wellness, Lifestyle (the frontend's list). `platform.search_settings` (single row): fit weights, label thresholds, freshness thresholds, candidate pool size (200), page size (24), few-results threshold (8).

### 3.4 Grants and database-level guards

- `mushin_app`: `SELECT` on `gcp.creators`, `gcp.creator_profiles`, `gcp.enrichment_snapshots`; on `gcp.creator_contacts` only `id, creator_id, kind, masked, trust, source, first_seen_at, last_seen_at, last_verified_at` — **never `value_encrypted`**. `SELECT, INSERT` on `wp.contact_reveals`, `wp.audience_views`; full CRUD on `wp.saved_searches`. No writes to `gcp`.
- `mushin_worker`: read/write `gcp` (summaries, index projection, seeding).
- `gcp.revealed_contacts(creator_id uuid)` — `SECURITY DEFINER` function returning `(id, kind, value_encrypted, masked, trust, source)` **only when** a `wp.contact_reveals` row exists for `platform.current_workspace_id()` and that creator; otherwise no rows. Decryption happens in the API.
- `BEFORE INSERT` trigger on `wp.contact_reveals` rejects a creator with `is_minor and minor_override_by_staff_id is null` (architecture §5.12).

## 4. Search (Brain-1)

### 4.1 API (customer guard; any member; free)

| Route | Behaviour |
|---|---|
| `POST /v1/search` | `{ text?, filters, page }` → `{ results[], total, page, fewResults }`; each result has creator card fields, `fitScore`, `fitLabel` |
| `POST /v1/search/interpret` | `{ text ≤ 300 chars }` → `{ chips: Filters, keywords: string[] }`; rate limit 20/min per user |
| `GET /v1/creators/lookup?q=` | omnibar: up to 8 matches by name, handle, name variant or profile URL (URL matched on normalized `canonical_url`) |
| `GET /v1/search/saved` · `POST /v1/search/saved` · `DELETE /v1/search/saved/:id` | saved searches (REQ-02.04); re-run = load filters + `POST /v1/search` |

**Filters** (REQ-02.01 plus the existing screen's extras): `platform`, `creatorCountry`, `creatorCity`, `audienceCountry`, `followersMin`/`followersMax`, `engagementMin`/`engagementMax`, `niches[]`, `verifiedOnly`, `minAuthenticity` (excludes not-yet-assessed creators), `hasContact`, `freshOnly` (follower data `current`, i.e. updated within the freshness threshold, D10). `audienceCountry` matches creators whose latest snapshot lists that country; until enrichment exists it matches none.

### 4.2 Ranking (D2)

1. Meilisearch query: `text` + keywords over `display_name`, `name_variants`, `primary_handle`, `handles`, `niches`, `tags`, `bio`; filters as Meilisearch filter expressions; typo tolerance on; up to 200 candidates with `_rankingScore`.
2. MUSHIN fit score (0–100), weights from `platform.search_settings`: **text relevance 35** (Meilisearch ranking score; full marks when no text) · **filter closeness 25** (followers nearer the centre of the requested range, engagement further above its minimum) · **engagement 15** · **authenticity 15** (neutral 0.5 when not assessed) · **freshness 10**.
3. Labels: ≥ 80 **Best match**, ≥ 65 **Strong match**, ≥ 50 **Possible match**, else **Needs review**. Sort by score, then followers, then id (stable).
4. `fewResults = total < 8` (SRS §4.2.2). The UI shows next-step guidance; "Search live" and "Add by URL" actions arrive in sub-project 4 (until then the guidance says so — no dead end, SRS §3.1).

### 4.3 Index

Meilisearch index `creators` (prefix from `MEILISEARCH_INDEX_PREFIX`, e.g. `test_<run>_` in tests): one document per `active` creator not flagged as a possible minor without override; fields: id, display_name, name_variants, primary_handle, handles[], platforms[], primary_platform, city, country, niches, tags, bio (primary profile, ≤ 500 chars), followers (max across profiles), engagement_rate (primary), verified, authenticity_score, has_contact (boolean), audience_countries[], freshest metric timestamp. **No contact values.** Settings (searchable, filterable, sortable attributes, typo tolerance) are applied idempotently at worker start.

**Sync:** any `gcp` change writes outbox `creator.changed { creatorId }` in the same transaction → `rescore-low` queue → upsert or delete the document. Nightly reconcile (cron) compares Postgres ids/`updated_at` with the index and repairs drift. If Meilisearch is unreachable, search returns `PROVIDER_UNAVAILABLE` (503, "Search is temporarily unavailable"); profiles, reveals and saved searches keep working. `/health/ready` adds `search`.

## 5. Creator profile, audience and reveal

| Route | Behaviour |
|---|---|
| `GET /v1/creators/:id` | header; per-platform profiles with stats and **per-metric freshness** (`current`/`aging`/`stale` + timestamp); social profile URLs; `summary: { status: ready|generating|unavailable, text?, model?, generatedAt? }`; `authenticity: { status: assessed, score, evidence[], assessedAt } | { status: not_assessed }` (D7); `contacts: [{ id, kind, masked, trust }]` plus `values` when this workspace revealed the creator; `revealed`; `revealCost`; `minorProtected`; `hasContacts` |
| `GET /v1/creators/:id/audience` | estimated audience from the latest snapshot, every value labelled `estimated` with `source` and `confidence` (REQ-01.07). First view this month per creator calls `billing.useEntitlement(ctx, "audience_views")` and inserts `wp.audience_views`; repeat → free. Limit reached or no plan → `ENTITLEMENT_REQUIRED` (`reason: plan_limit` / `no_active_plan`, with `lostAccess`). No snapshot → `{ status: not_assessed }` (not counted) |
| `POST /v1/creators/:id/reveal` | `Idempotency-Key` required; body `{ confirmedCost }`. Under the workspace credit lock in one transaction: already revealed → return values, no charge; possible minor → `FORBIDDEN` (`reason: minor_protected`) before any charge; no contacts → `CONFLICT` (`reason: no_contacts`), no charge; otherwise `billing.spendInstant(reveal_contact, confirmedCost)` (cost mismatch → `CONFLICT` as in billing) + insert `contact_reveals` → decrypt via `gcp.revealed_contacts` → return values |

Profiles of erased or removal-requested creators return `NOT_FOUND`; merged creators redirect to `merged_into_id` in the response (`mergedInto`).

## 6. AI (D6, REQ-03.x)

**Adapter** `Llm` in `packages/integrations`: `complete({ feature, system, input, schema, maxTokens })` → parsed output. Groq first; Ollama Cloud on Groq error/unavailability (architecture Q8; SRS §3.3 "cheaper model by default"). Models and per-token prices are settings (`GROQ_MODEL`, `OLLAMA_MODEL`, price config). Every call goes through `instrumented()` and records a `platform.provider_calls` row with `feature` (`search_interpret` / `creator_summary`), tokens and cost (REQ-03.05). Output is parsed with Zod; invalid → one corrective retry → `PROVIDER_UNAVAILABLE`.

**Interpretation** (REQ-02.02, REQ-03.02): system prompt lists the niche vocabulary and filter schema; the user's text is passed as data. Output is post-validated: niches must be in `platform.niches`, countries valid ISO codes, cities free text ≤ 60 chars, numeric ranges clamped to sane bounds (followers 0–500M, engagement 0–100) and min ≤ max; anything invalid is dropped. Chips are suggestions the user edits (REQ-03.06).

**Summaries** (REQ-03.01): on `GET /v1/creators/:id`, if `ai_summary` is missing or `ai_summary_source_hash` differs from the hash of the creator's current public data, the API writes outbox `creator.summary_requested { creatorId }` (job id = creator id + source hash, so concurrent opens collapse) and returns `status: generating`. The worker (`rescore-low`) builds a prompt from **public data only** (stats, bio, niches, latest evidence; never contacts), fences scraped text as data with an instruction to ignore embedded commands (SRS §5.3), requires 3 sentences ≤ 600 chars with no URLs, emails or phone numbers, then stores the text, model, time and source hash. Failure stores `ai_summary_failed_at` and retries with backoff (pg-boss retry policy); the profile shows `unavailable` after a failure until the next retry succeeds. The UI labels summaries "AI-generated · may be inaccurate" (REQ-03.06, §5.5) and polls the profile every 2 s for up to 30 s while `generating`.

## 7. Frontend (wiring, plus the omnibar)

- **Search screen** (`SearchModule.tsx`): `interpretQuery` → `POST /v1/search/interpret`; filters → `POST /v1/search`; results with fit labels; fake streaming removed; saved searches via API; `fewResults` guidance; "Add to list" unchanged until sub-project 5.
- **Creator profile panel** (`CreatorProfilePanel.tsx`): data from `GET /v1/creators/:id`; audience section from `/audience` with the existing upgrade prompt on `ENTITLEMENT_REQUIRED`; summary "generating" state; authenticity evidence or "Not yet assessed"; **Reveal opens the confirm dialog "Reveal contact info for 5 credits?"** then calls reveal and refreshes the billing summary; minor-protected message; "Update info" explains it arrives with live refresh (sub-project 4).
- **Compare** (`Compare.tsx`): real profile data instead of `getCreatorIntel()`; `data.ts` fake generator removed when unused.
- **Omnibar** (D9, new): compact input in `Topbar.tsx` styled like existing inputs, debounced `GET /v1/creators/lookup`, dropdown of matches, opens the profile panel.

## 8. Errors

| Situation | Response |
|---|---|
| Search engine unreachable | `PROVIDER_UNAVAILABLE` 503 "Search is temporarily unavailable" |
| LLM unavailable / invalid twice (interpret) | `PROVIDER_UNAVAILABLE` 503 "Couldn't interpret that — use the filters" |
| Reveal: possible minor | `FORBIDDEN` 403 `{ reason: minor_protected }`, nothing charged |
| Reveal: no contacts | `CONFLICT` 409 `{ reason: no_contacts }`, nothing charged |
| Reveal: cost changed / not enough credits / no plan | as billing: `CONFLICT` / `INSUFFICIENT_CREDITS` / `ENTITLEMENT_REQUIRED` |
| Audience views used up / no plan | `ENTITLEMENT_REQUIRED` 403 `{ reason, lostAccess? }` |
| Creator erased / removal requested / unknown | `NOT_FOUND` 404 |
| Too many interpret calls | `RATE_LIMITED` 429 |

## 9. Testing (SRS §5.4 Testability)

- **Unit:** fit score and labels; freshness buckets; interpretation post-validation; summary output validation and prompt fencing; contact masking; audience month key; Meilisearch filter-expression builder.
- **Integration** (test database + local test Meilisearch with a per-run index prefix): reveal charges once, 10 concurrent reveals → 1 charge, already revealed free, minor refused before charge and trigger blocks direct insert, no contacts no charge, cost mismatch refused; `mushin_app` cannot select `value_encrypted`, `revealed_contacts` returns values only to the paying workspace; audience views 5 distinct/month on Explorer, repeat free, 6th refused, unlimited on Growth/Scale, expired refused; every filter; ranking order and labels; minors/merged/erased never indexed; transliteration variants found; search p95 < 1 s over repeated runs on ~1,000 seeded creators; interpret and summaries via a mock LLM (valid, fixed on retry, failing twice, cost recorded, one generation for concurrent opens, regenerated when data changes); index sync on change, removal on minor flag, reconcile repairs drift; Meilisearch down → 503 while profiles work.
- **Security:** cross-tenant reads of `contact_reveals`, `audience_views`, `saved_searches` fail; RLS catalog guard covers new `wp` tables; `gcp` has no `workspace_id`; contact values absent from index documents and logs.
- **Optional live smoke test** of Groq, off by default (`LIVE_LLM_TESTS=1`).
- **Manual end-to-end** in the browser on seeded data (the "done when" list in §1).

## 10. Environment

New: `MEILISEARCH_HOST` (dev `http://127.0.0.1:7700`), `MEILISEARCH_API_KEY` (admin key, worker), `MEILISEARCH_SEARCH_KEY` (API reads), `MEILISEARCH_INDEX_PREFIX`, `MEILISEARCH_TEST_HOST` / test key for integration tests, `GROQ_MODEL`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`. Existing: `GROQ_API_KEY`, `OLLAMA_API_KEY`, `DATA_ENCRYPTION_KEY`. Local Meilisearch requires downloading the official Meilisearch binary — done only after the user approves the specific file and source.

## 11. Out of scope

Live discovery, add-by-URL, paid refresh, scrapers, raw-payload archive, spend caps, enrichment and authenticity scoring, minor detection, creator merging, erasure (sub-project 4); embeddings and similarity search, ranking explanations, historical metrics charts, content insights (SRS S2); staff minor override and cost dashboards (sub-project 8); lists and "Add to list" (sub-project 5).
