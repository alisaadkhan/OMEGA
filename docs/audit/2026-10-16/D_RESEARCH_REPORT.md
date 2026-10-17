# D — Research report (external sources) and technology recommendations

Accessed 2026-10-16 unless stated. Each source is tagged **[R]** official requirement, **[G]** official guidance or
documentation, **[E]** empirical/academic evidence, **[S]** secondary source. Conclusions marked **Judgement** are the
auditor's engineering opinion, not a source's statement. Every topic answers a concrete MUSHIN question.

## 1. Identity: can MUSHIN trust the "email verified" signal? (→ SEC-03, UX-02, SEC-13)

- **[G]** Supabase RLS guide: `raw_user_meta_data` "can be updated by the authenticated user using the
  `supabase.auth.update()` function"; it "is not a good place to store authorization data"; `raw_app_meta_data`
  "cannot be updated by the user, so it's a good place to store authorization data."
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- **[G]** Supabase `updateUser` reference: `updateUser({ data: {...} })` updates the signed-in user's metadata.
  <https://supabase.com/docs/reference/javascript/auth-updateuser>
- **[G]** Supabase JWT fields: `amr`, `aal` (`aal1`/`aal2`), `is_anonymous`; no claim states email confirmation.
  <https://supabase.com/docs/guides/auth/jwt-fields>
- **[G]** Supabase custom SMTP: the default email service sends only to team members, about **2 messages/hour**, no SLA,
  "not meant for production use"; with custom SMTP a default **30 messages/hour** limit applies until raised.
  <https://supabase.com/docs/guides/auth/auth-smtp>

**Conclusion.** MUSHIN's `emailVerified` comes from `user_metadata.email_verified` and must not authorise invitation
acceptance. Real sign-up/recovery testing requires a custom SMTP sender (Resend is already a planned vendor). Account
deletion must call the Auth admin API server-side.

## 2. Target architecture: Supabase Edge Functions versus the current Node API + pg-boss worker (→ ARCH-01)

- **[G]** Supabase Edge Function limits: memory **256 MB**; wall clock **150 s (Free) / 400 s (paid)**; **CPU time 2 s
  per request**; request idle timeout 150 s; bundle 20 MB (CLI) / 5 MB (dashboard).
  <https://supabase.com/docs/guides/functions/limits>
- **[G]** Supabase Node/npm compatibility announcement: npm modules and Node built-ins are supported; native (N-API)
  addons are not addressed. <https://supabase.com/blog/edge-functions-node-npm>
- **[G]** Supabase connection modes: transaction pooler (6543) has no prepared statements and no LISTEN/NOTIFY; session
  pooler and direct connections support both; long-running servers should use direct or session mode.
  <https://supabase.com/docs/guides/database/connecting-to-postgres>

**MUSHIN facts that matter.** [code] staff passwords use `@node-rs/argon2` (a native addon); Live Discovery awaits Apify
runs for up to minutes and LLM calls up to 30 s; the outbox relay uses LISTEN on the session connection; the DB client
already sets `prepare: false` for the transaction pooler; 847 tests exercise the Node stack.

**Judgement (recommendation).** Keep the Node API and the pg-boss worker as two small always-on processes; use Supabase
for PostgreSQL, Auth and Storage only. A port to Edge Functions + pgmq + pg_cron would rewrite a tested backend,
re-implement argon2 and WebAuthn verification under Deno, and split every long step into ≤ 2 s CPU ticks — with no
product capability gained for a pilot of 10–30 workspaces. Revisit only for stateless webhooks if hosting cost or
operations data later justify it. **This contradicts the 14 Oct "owner direction" in the migration map, so it is a
decision for the owner (D-01), not something to be silently applied.**

| Option | Monthly cost (pilot, before usage) | Migration effort | Reliability risk | Fit |
|---|---|---|---|---|
| A. Supabase (DB/Auth/Storage) + 2 small containers (Fly.io/Render/Railway) for API + worker + static SPA on Cloudflare Pages | ≈ USD 30–40 (repo estimate; confirm on vendor pages) | Low: deployment config only | Low: same code as tested | **Recommended** |
| B. Full Supabase (Edge Functions + pgmq + pg_cron) | ≈ USD 25+ | High: port 116 routes and all jobs; re-verify every invariant | Medium–High: CPU/wall-clock limits, Deno compatibility | Defer |
| C. Single VPS with Postgres self-hosted | lowest | Medium | High (backups, patching, HA by hand) | Not recommended |

## 3. Database operations: backups and recovery (→ OPS-04)

- **[G]** Supabase backups: Pro keeps daily backups **7 days** (Team 14, Enterprise up to 30); Free has no automatic
  backups (use `supabase db dump`); PITR is an add-on on Pro+ requiring at least the **Small** compute add-on, priced
  7 days ≈ **USD 100/month**, 14 days ≈ 200, 28 days ≈ 400; enabling PITR stops daily backups; **Storage objects are not
  included** in database backups. <https://supabase.com/docs/guides/platform/backups>

**Conclusion.** With daily backups the RPO is up to a day; raw payloads and avatars in Storage need their own backup or
must be treated as reproducible; a restore can resurrect erased creators and expired YouTube data, so the restore
runbook must re-apply the suppression list, erasures and the YouTube expiry function before re-opening.

## 4. Payments: Paddle (→ BIL-03)

- **[G]** Paddle webhook verification: `Paddle-Signature: ts=…;h1=…`; HMAC-SHA256 over `ts:rawBody`; must use the raw
  body unmodified; more than one `h1` may be present during secret rotation; SDKs reject timestamps older than **5 s** by
  default. <https://developer.paddle.com/webhooks/signature-verification>
- **[G]** Paddle supported countries lists where Paddle can sell to buyers; seller/payout eligibility is not on that page.
  <https://developer.paddle.com/concepts/sell/supported-countries-locales>

**MUSHIN.** [code] `signature.ts` handles multiple `h1` values, constant-time comparison and the raw body correctly; it
allows a **300 s** timestamp window (wider than the SDK default; acceptable because `(provider, event_id)` is unique and
processing is idempotent — keep, but document). **Seller onboarding for a Pakistan-based business must be confirmed with
Paddle in writing (owner).**

## 5. Search and extraction providers (→ SRCH-04, SRCH-10, credit economics)

- **[G]** Serper home page: "starting at **USD 0.30 per 1,000 queries**"; 2,500 free queries; no card. Package tiers,
  QPS limits and the cost of `num > 10` are not on that page. <https://serper.dev/> — MUSHIN records **USD 0.001 per
  search** (conservative vs the advertised entry price) and uses `num = 10`; **owner should confirm actual plan pricing in
  the Serper console** before any economics claim.
- **[G]** Apify `ActorStartOptions`: `maxTotalChargeUsd` ("maximum cost of the Actor run", pay-per-event Actors),
  `maxItems` (pay-per-result billing cap), `runTimeoutSecs`, `memory`, `build`, `waitForFinish` (≤ 60 s per call),
  `webhooks`. <https://docs.apify.com/api/client/js/reference/next/interface/ActorStartOptions>
- **[G]** Apify Instagram Profile Scraper: pay-per-event; "from USD 1.60 / 1,000 profiles"; Free plan USD 2.60 / 1,000;
  latest 12 posts with details. <https://apify.com/apify/instagram-profile-scraper>
- **[G]** Groq rate limits: HTTP 429 with `retry-after`; per-model RPM/RPD/TPM limits depend on plan.
  <https://console.groq.com/docs/rate-limits>

**Conclusion.** MUSHIN does not use `maxTotalChargeUsd`, `maxItems` or `runTimeoutSecs` and does not persist run IDs:
SRCH-04. The measured MUSHIN cost of USD 0.0026 per Instagram profile matches Apify's Free-plan rate, so moving to a
paid Apify plan lowers COGS.

## 6. Platform policies (→ DIS-23, legal questions in H §7)

- **[R]** YouTube API Services Developer Policies: III.E.4.c — authorised data may be stored "for no longer than 30
  calendar days. After 30 calendar days, the API Client must either delete or refresh the stored data"; III.E.4.d —
  non-authorised data "not longer than 30 calendar days"; III.E.4.h — must not "access or use API Data to create new or
  derived data or metrics"; III.L — derived-metric permissions apply only to audited analytics developers. **No
  exception for channel identifiers is listed.** <https://developers.google.com/youtube/terms/developer-policies>
- **[R]** YouTube derived-metrics policy (last updated 2026-09-14): requires accepting a policy amendment via a YouTube
  form with an "Analytics & Reporting" use case. <https://developers.google.com/youtube/terms/derived-metrics-policy>
- **[S]** Open Terms Archive memo (Nov 2021): Instagram's terms prohibit creating or using accounts to retrieve
  information without permission, "especially in an automated way."
  <https://opentermsarchive.org/en/memos/instagram-blocks-data-retrieval-and-clarifies-what-information-it-retrieves/>
  (Meta's and TikTok's terms pages refused automated retrieval during this audit; the owner's lawyer must read the
  current originals.)

**Conclusion.** (a) Keeping YouTube handles/URLs beyond 30 days "because they were obtained outside the API" is a legal
interpretation, not a policy exception — confirm with counsel. (b) Using YouTube API data for Campaign Fit inside the
30-day window is plausibly "derived metrics" under III.E.4.h — counsel or the amendment process must settle it. (c)
Instagram and TikTok data come through third-party Apify Actors; the platforms' terms restrict automated collection.
MUSHIN's exposure (contractual, not only data-protection) needs qualified advice before paid launch.

## 7. Data protection law (→ H §7)

- **[S]** Chambers Data Protection & Privacy 2026 — Pakistan (updated 10 Mar 2026): the Personal Data Protection Bill 2023
  is **not enacted**; no operative general data-protection law; relevant today: Constitution Art. 14, PECA 2016, sectoral
  laws; the draft bill would add cross-border and "critical data" localisation rules.
  <https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/pakistan>

**Conclusion.** Design for the draft bill's principles (consent, purpose limitation, data-subject rights, breach
handling) and for GDPR-style expectations of foreign customers and processors (Supabase, Apify, Groq are foreign
processors). MUSHIN's removal-request and deletion features are a good base; a privacy policy, processor list and
transfer assessment are missing (UX-01).

## 8. Security standards (→ H §2)

- **[R/G]** OWASP API Security Top 10 2023: API1 BOLA, API2 Broken Authentication, API3 Object Property Level
  Authorization, API4 Unrestricted Resource Consumption, API5 Function Level Authorization, API6 Sensitive Business
  Flows, API7 SSRF, API8 Security Misconfiguration, API9 Inventory Management, API10 Unsafe Consumption of APIs.
  <https://api-security.owasp.org/editions/2023/en/0x11-t10/>
- **[R]** NIST SP 800-63B-4: AAL2 verifiers "SHALL offer at least one phishing-resistant authentication option"; AAL3
  requires phishing resistance with a non-exportable key; "OTP authentication is not phishing-resistant."
  <https://pages.nist.gov/800-63-4/sp800-63b.html>
- **[G]** Fastify `trustProxy`: default `false`; forwarded headers "may be easily spoofed" and must be treated as
  untrusted unless the proxy chain is explicitly trusted; hop-count trust is unsafe.
  <https://fastify.dev/docs/latest/Reference/Server/#trustproxy>

MUSHIN mapping is in `H_…` §2 (one row per OWASP category with evidence).

## 9. Frontend hosting and email (→ SEC-14, OPS-03)

- **[G]** Cloudflare Pages Free: 500 builds/month, one concurrent build, unlimited static requests and bandwidth, 100
  custom domains per project. <https://pages.cloudflare.com/>
- **[G]** Resend API: 10 requests/second per team by default; daily quota on Free, monthly quota on all plans;
  `ratelimit-*` and `retry-after` headers. <https://resend.com/docs/api-reference/rate-limit>

## 10. Search evaluation methodology (→ SRCH-13, F §6)

- **[E]** NIST publication record, *Reliable Information Retrieval Evaluation with Incomplete and Biased Judgements* —
  pooled relevance judgements are incomplete and biased towards the systems that contributed to the pool, which affects
  measured recall and comparisons (authors/venue not re-checked in this session; read the record before citing further).
  <https://www.nist.gov/publications/reliable-information-retrieval-evaluation-incomplete-and-biased-judgements>
- **[E]** Feinstein & Cicchetti (1990), *High agreement but low kappa* I and II — kappa depends on category prevalence;
  report observed agreement and prevalence alongside kappa.
  <https://scholarhub.vn/publication/:slug/99d46fd7-7674-4728-9c1a-4edb5f5f85c5>

**Conclusion.** The kappa ≥ 0.6 gate is reasonable but, with a 3-point ordinal scale and skewed prevalence, report
**weighted kappa and raw agreement** too; with MUSHIN-built pools, coverage/recall are upper-bounded by what MUSHIN's own
variants surfaced. These are **proposals**; the thresholds stay as approved (F §6).

## 11. Technology-specific recommendations (summary)

| Technology | Keep / change | Why |
|---|---|---|
| PostgreSQL (Supabase-hosted) | Keep | System of record; RLS design is solid (28/28 forced) |
| Supabase Auth | Keep as customer identity; fix SEC-03; custom SMTP | Official guidance on metadata and SMTP |
| Fastify API + pg-boss worker | Keep (recommendation, D-01) | Tested; Edge limits do not fit long provider waits |
| Upstash Redis | Remove (after SEC-06) | Postgres counters exist; fewer vendors and secrets |
| Meilisearch (Cloud or self-hosted) | Do not deploy; keep adapter only until ratings compare it | Pack rule; no measured need |
| Serper | Keep; confirm plan price in console | Works; cheap |
| Apify | Keep; add `maxTotalChargeUsd`, `runTimeoutSecs`, persisted run IDs; pin builds | SRCH-04 |
| Groq + Ollama Cloud LLM | Keep, capped at USD 5; keep deterministic fallbacks | Owner decision |
| Paddle | Keep pending seller confirmation; otherwise local gateway behind the same interface | OD-009 |
| Resend | Adopt for Supabase custom SMTP and invitations once approved | Needed for auth emails |
| Static SPA host | Cloudflare Pages (or the container host) with security headers | Cheap, immutable asset caching |
| Error tracking / uptime | Add one service (e.g. Sentry free tier) + uptime ping | OPS-03 |
