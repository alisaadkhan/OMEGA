# H — Security, privacy, performance, reliability, scalability and operational-readiness audits

## 1. Threat model (summary)

Assets: creator contact data (encrypted), workspace CRM data, credits and payments, staff privileges, provider budgets,
YouTube API data under retention rules. Adversaries: an outsider with the public anon key; a customer attacking another
tenant; a malicious or compromised member; a phished staff member; anyone holding the leaked archive; hostile content in
scraped bios/snippets; a misbehaving provider. Trust boundaries: browser ↔ API; API ↔ database (role switch + RLS);
worker ↔ providers; staff console ↔ staff API; Paddle ↔ webhook.

## 2. Security findings register

| ID | Sev | Finding | Evidence | Fix (short) |
|---|---|---|---|---|
| SEC-01 | Critical | Populated secrets in the shared archive | [ran] VERIFICATION_LOG §6 | Containment runbook §3 |
| SEC-02 | High | WebAuthn step-up proven only by an `amr` claim in an HS256 token | [code] staff/tokens.ts, permissions.ts | Server-side step-up rows; rotate secret |
| SEC-03 | High | Invitation "verified email" from user-editable metadata | [code] customer-token.ts; [web] Supabase RLS guide | app_metadata via hook or Auth admin lookup |
| SEC-04 | High | Silent workspace fallback | [code] identity/repository.ts | 403 on non-member header |
| SEC-05 | High | No trustProxy policy; IP buckets wrong behind proxies | [code] app.ts; [web] Fastify | Trusted CIDRs per host |
| SEC-06 | Medium | Upstash fail-open limiter auto-selected | [code] config.ts, upstash.ts | Postgres default |
| SEC-07 | Medium | First hardware key enrollable from TOTP session | [code] webauthn.ts | Approval/out-of-band code |
| SEC-08 | Medium | Contact strings in bios bypass reveal | [code] creators/service.ts | Redact in payloads |
| SEC-09 | Medium | No encryption key versioning | [code] core/crypto.ts | Key ids + re-encrypt tool |
| SEC-10 | Medium | Audit log not tamper-evident | [ran] grants | Hash chain + export |
| SEC-11 | Medium | Supabase Data API exposure unverified | — | Exposed schemas = public; revoke grants |
| SEC-13 | Medium | IdP account survives deletion | [code] privacy.ts | auth.admin.deleteUser |
| SEC-14 | Medium | No CSP/security headers for SPA host | [code] | Host headers |
| SEC-16 | Medium | LLM text shown as result reason | [code] relevance.ts | Deterministic reasons |
| SEC-15 | Low | Fabricated testimonials in dead components | [code] landing/* | Delete |
| SEC-12 | Low | Staff console shipped in public bundle | [ran] build | Separate entry |

### What is genuinely strong (evidence-backed)
- Tenant isolation in the database: 28/28 `wp` tables FORCE RLS; runtime roles without BYPASSRLS; transaction-scoped
  context compatible with the transaction pooler ([ran]); cross-tenant tests in every module ([ran] 847 tests).
- Contacts: encrypted (AES-256-GCM), no direct grant, reveal is audited, charged, idempotent ([code][ran]).
- Credit engine: integer amounts, sign CHECKs, append-only grants, RLS policy restricting reservation amounts to approved
  prices, per-workspace advisory lock, idempotent settlement ([code][ran]).
- Staff sign-in: argon2, lockout, constant-work failures, TOTP replay protection, refresh-token rotation with reuse
  detection, deny-by-default permissions, two-person approvals ([code][ran]).
- Hostile content: SSRF-safe avatar fetch (HTTPS, host allow-list, no redirects, type/size limits); snippets fenced and
  contact-redacted before LLM; user text can never become Google operators ([code]).
- Webhooks: raw-body HMAC, multiple `h1`, constant-time compare, `(provider, event_id)` unique ([code]; [web] Paddle).
- No secrets in the frontend bundle ([ran] scan).

### OWASP API Security Top 10 2023 mapping

| Category | MUSHIN status | Evidence / gap |
|---|---|---|
| API1 BOLA | Mostly controlled | RLS + per-resource workspace checks; SEC-04 fallback is the exception |
| API2 Broken authentication | Partial | Customer JWT verification sound; SEC-02, SEC-03, SEC-07 |
| API3 Object property level | Partial | Zod response schemas; bios leak contacts (SEC-08); unknown request keys stripped silently (SRCH-07) |
| API4 Unrestricted resource consumption | Partial | Per-user/IP/job limits, body limit 1 MB, spend caps; SEC-05, SEC-06, SRCH-05, BIL-06 |
| API5 Function level authorization | Controlled | Separate staff guard; permission table; role re-check per request |
| API6 Sensitive business flows | Partial | Paid starts limited; trial once per identity; Admin can purchase (DIS-26) |
| API7 SSRF | Controlled | Avatar allow-list; providers called with fixed hosts |
| API8 Misconfiguration | Gap | SEC-01, SEC-14, ARCH-07, CI not running |
| API9 Inventory | Partial | 116 routes vs 58 OpenAPI paths unreconciled (OD-012); test-only routes confined to tests |
| API10 Unsafe consumption of APIs | Partial | Zod parsing of Serper/LLM output; Apify run handling (SRCH-04) |

## 3. Credential containment runbook (owner executes; nothing here was performed)

1. **Contain distribution:** delete `MUSHIN_1.zip` from every chat, drive, email and device it reached except one
   offline copy for the evaluation inventory; record where it went.
2. **Database first:** reset the Supabase database password; rotate the service-role/secret keys and, if the project uses
   the legacy JWT secret, rotate the JWT signing key (this invalidates sessions); update local `.env` only.
3. **Review access:** Supabase logs (auth, API, Postgres) since 2026-10-16 for unknown IPs; table row counts vs last known.
4. **App secrets:** new `STAFF_JWT_SECRET` (all staff re-sign-in); new `DATA_ENCRYPTION_KEY` **only after** SEC-09
   tooling exists — until then, protect the old key and re-encrypt immediately when the tool lands; new `WORKER_SECRET`,
   `MOCK_PADDLE_WEBHOOK_SECRET`; change `SEED_TEST_PASSWORD` account.
5. **Providers:** revoke and reissue Serper, Apify, YouTube (restrict key by API and IP), Groq, Ollama, Upstash,
   HuggingFace (then delete — unused), Resend, Meilisearch Cloud (then delete the project). Check each provider's usage
   for spend since 16 Oct.
6. **Local stack:** `supabase stop --no-backup`, delete `supabase/.temp/start-secrets`.
7. **Prevent recurrence:** a `scripts/package-source.sh` that uses `git archive HEAD` (tracked files only) plus the
   bundle-secret scanner over the archive; pre-commit secret scan (e.g. gitleaks) in CI.
8. **Verify:** each old key fails; record rotation date per key.

## 4. Privacy audit

| Topic | State | Gap |
|---|---|---|
| Public creator data vs workspace CRM | Separated by schema and grants ([ran]) | Bios carry contacts (SEC-08) |
| Minors | Possible minors flagged and hidden; not sent to the LLM ([code]) | Detection method accuracy unmeasured |
| Removal requests | Public form, immediate hiding, audited approval, tombstone + URL-hash suppression ([code]) | Owner-only CLI review; no SLA stated publicly |
| Retention | YouTube 30-day expiry; raw payload purge; search-cache purge; removal-email purge ([code]) | Backups retain data (OPS-04); identifiers kept (DIS-23) |
| Customer rights | Export, workspace and account deletion ([code]) | IdP deletion (SEC-13); 50k truncation (DATA-03); retention period for billing records (owner) |
| Processors / transfers | Supabase, Apify, Groq, Ollama, Serper, Meilisearch Cloud, Upstash | No processor list or privacy notice (UX-01) |
| Evaluation data | Inventory + purge tooling ([doc]) | Archive copies added by this upload |

## 5. Legal and compliance questions needing qualified advice (not answered here)

1. Lawful basis and terms exposure for collecting Instagram/TikTok public profile data through third-party Apify Actors,
   given the platforms' terms restrict automated collection ([S] Open Terms Archive; originals to be read by counsel).
2. YouTube API: may handles/canonical URLs be kept beyond 30 days; is Campaign Fit using API data a "derived metric"
   under III.E.4.h; should MUSHIN apply for the derived-metrics amendment ([R] YouTube policies).
3. Displaying and selling access to creator contact details published in bios (consent, PECA, platform terms).
4. Privacy notices for creators (who did not sign up) and for customers; cross-border processing (draft PDP Bill 2023).
5. Consumer-law requirements for credit packs that never expire, monthly credits that expire, and refunds.
6. Tax/invoicing and seller-of-record arrangements with Paddle for a Pakistan-based seller.

## 6. Performance and scalability

| Path | Measured (reported, local, small data) | Risk at scale | Proposed target (to measure on staging) |
|---|---|---|---|
| Brain 1 search | p50/p95/p99 81/95/231 ms (200 req, c=10); 100k synthetic common word 89 ms p95 | Ranking pulls up to `candidatePool` rows then pages in memory; offset re-runs | p95 ≤ 800 ms, p99 ≤ 2 s at 2× pilot peak (pack) |
| Lists / campaigns / profile / billing | p95 46–64 ms | Low | p95 ≤ 300 ms (repo proposal) |
| Rate limiting | 2 DB transactions per request | Pool contention (OPS-05) | ≤ 5 ms added p95 |
| Live Discovery | Replay; measured live run 138 s (13 Oct, reported) | Provider latency dominates; 3 concurrent jobs per worker queue | ≤ 20-min deadline; median ≤ 5 min (proposed) |
| Worker throughput | 9 queues, fixed concurrency, one process | Spend guards assume one worker (SRCH-05) | Scale only after DB-backed guards |
| DB connections | API pool 10, worker 5 + pg-boss 3 + LISTEN | Supabase session pooler client limits on small compute | Measure with staging; keep API on 6543 |
| Frontend | 311 kB gzip single bundle | Slow on mobile 3G/4G | Landing ≤ 250 kB gzip (UX-04) |

Cost per completed workflow (reported, `credit-economics.md`): catalogue search ≈ USD 0.00006 (LLM interpretation only);
Instagram profile ≈ USD 0.0026; live run Instagram size 5 ≈ USD 0.017; TikTok run ≈ USD 0.065 (fails the 3× rule for 1–4
creators, hence the 100-credit minimum). These are single-run measurements; re-measure in the capped pilot.

## 7. Reliability

- **Strong:** transactional outbox; pg-boss retries with backoff and dead-letter queue; idempotent settlement; stuck-job
  sweeper refunds; reservation expiry; archive-based resume; per-job deadline and cost cap; provider pause switches;
  start-up and nightly search reconcile ([code][ran]).
- **Gaps:** orphaned Apify runs (SRCH-04); per-process guards (SRCH-05); no alert delivery (OPS-03); no hosted backups or
  restore procedure that re-applies erasures (OPS-04); catalogue decay (SRCH-02); single Supabase dependency.

## 8. Operational readiness — how would an operator detect…

| Event | Detection today | Needed |
|---|---|---|
| Incorrect Search output | Staff job inspector trail; nothing proactive | Weekly sampled rating + zero-result-rate metric with alert |
| Stalled queue | Staff overview "oldest outbox", stuck jobs thresholds (logged) | Alert delivery (OPS-03) |
| Credit discrepancy | Nightly `reconcile` job writes mismatches | Alert + kill switch runbook |
| Webhook failures | `webhook_events.error` rows | Alert on unprocessed > 0 for 15 min |
| Stale metrics | Eligibility coverage endpoint (counts) | Trend + alert (SRCH-02) |
| Compromised credentials | None | Provider spend alerts, Supabase log review, staff login anomaly audit |
| Failed deletions | Erasure job failures in logs; purge `--verify` for eval data | Alert on erasure job DLQ |
