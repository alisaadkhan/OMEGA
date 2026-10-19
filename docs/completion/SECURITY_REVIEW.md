# Security review (mandate v3)

Scope: the repository at the commits listed in PROGRESS.md, run locally. Every "verified" below names a test or drill
that was actually run in this work; nothing was tested against hosted Supabase, Paddle, Resend or a production host.

## Findings addressed

| Area | Finding (audit ID) | Fix | Evidence (executed) |
|---|---|---|---|
| Secrets | Shared archive held `.env` and start secrets (SEC-01) | Rotation is the owner's; tooling: committed-source secret scan, safe `git archive` packaging, staff session revoke-all, `DATA_ENCRYPTION_KEY` rotation (SEC-09) | `scripts/package-source.test.ts`; rotation drill (10 values re-encrypted); bundle secret scan on every build |
| Staff auth | Step-up trusted a token claim (SEC-02) | Server-side step-up rows, **5-minute** validity, checked per privileged request | `webauthn.int` (forged hwk token refused; 4 min ok / 6 min refused; revoked key; revoke-all) |
| Staff auth | First key enrolable with password + TOTP only (SEC-07) | One-time CLI enrolment code, hashed, single use, audited, alert on enrolment | `webauthn.int`; staff E2E with a virtual authenticator |
| Staff audit | Log editable by the DB owner (SEC-10) | Hash chain + verifier + daily digest | `staff-audit-chain.int` (edit, delete, rewritten head detected) |
| Identity | Invitation trusted editable `user_metadata` (SEC-03) | Confirmed email from the Auth server (admin API, server-side) | `team.int`; `auth-check` 17/17 on local Supabase |
| Tenancy | Unknown workspace header silently fell back (SEC-04) | 403 `workspace_access_denied`; per-tab selection | identity tests; customer E2E `isolation`, `team` (removed member gets 403, never redirected) |
| Rate limits | Proxy headers trusted / fail-open store (SEC-05/06, ARCH-03) | No proxy trusted by default; production must state `TRUSTED_PROXIES`; PostgreSQL counters only; Upstash removed | `app.test` (spoofed X-Forwarded-For ignored), `config.test` |
| Account deletion | Auth user survived (SEC-13) | Supabase Auth user deleted server-side after the DB scrub; outcome reported; failures alerted | `team.int`; `auth-check` (re-sign-up with the same address) |
| Data API | `public` schema exposed pg_trgm functions to the anon key (SEC-11) | 0048 moves the extension to `extensions` on Supabase | `exposure-check` 0 problems (DB and live local API); full suite on Supabase cluster DB 920 passed |
| Browser | No CSP / security headers (SEC-14) | `dist/_headers`: CSP (self scripts, no eval), frame-ancestors none, HSTS, nosniff, referrer and permissions policies; Google Fonts and dev-React leaks removed | `security-headers.test`; `csp-check` 7/7 in Chrome |
| Config | Mixed Supabase projects (ARCH-07) | API refuses JWT issuer/JWKS from another project | `config.test` |
| Money | Ledger cascade, top-up expiry, parallel live runs, spend caps (BIL-05/04/06, SRCH-04/05) | Restrict deletes; constraint; one open run per workspace; DB-backed reservations and paid-run records | `billing-schema.int`, `service.int`, `live-service.int` (concurrent confirmations), `provider-runs.int` |
| E2E hygiene | Browser sent token refreshes to the hosted Supabase project during E2E (found in this work) | Vite in E2E points at the local stub; stub answers Auth calls | customer suite passes with the stub only |
| Dependencies | `react-router` high advisory (found in this work) | Unused dependency removed | `npm audit --omit=dev`: 0 in root and frontend (2026-10-19) |
| Dead code | Unused components with false claims (fake monitoring, AI audience label), 22 links to pages that do not exist | Deleted / replaced | E2E: no `href="#"` on the landing page |

## Tests that guard security (run on every verify)

Cross-workspace 404s and empty reads (`isolation`, RLS tests in every module), mass-assignment and injection tests,
request-id and error-envelope tests (500s never leak internals: `app.test`), log redaction at any depth including the
authorization header (`logger.test`), bundle secret scan, committed-source secret scan, CSP header unit tests, webhook
signature verification for Paddle (mock and HMAC tests), SSRF-safe avatar fetching tests, test-database guard (refuses
names without `test` and `mushin_eval*`).

## Remaining risk

| Risk | Why it remains | Owner / next step |
|---|---|---|
| Exposed credentials still valid | Rotation needs provider access | Owner rotates (SEC-01), then runs `rotate-encryption-key` and `revoke-staff-sessions.ts` |
| Nothing verified against hosted services | No authorised hosted project, Paddle sandbox, Resend, real hardware keys | Hosted staging (D-01), then re-run auth-check, recovery-check, exposure-check there |
| Contact strings inside public bios (SEC-08) | Owner decision D-11 + Search freeze | Decide; implement after ratings |
| No external penetration test | Out of scope here | Commission before open sign-up |
| Error tracker / uptime monitor not chosen | Vendor decision | Owner (OPS-03 delivers alerts to a webhook already) |
| Admins can purchase (D-06) | Owner decision | Decide; restrict and test |
| Developer `.env` mixes two Supabase projects | Owner's file; the API now refuses it | Owner fixes `.env` (ENV-01) |

## Unverified environments

Supabase (hosted), Paddle, Resend, Serper, Apify, YouTube Data API, Groq/Ollama: **not integration verified**. Local
Supabase stack (Docker) was used for Auth, recovery and exposure checks: that is local verification, not hosted.
