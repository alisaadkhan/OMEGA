# Release readiness

Status words (mandate v3 §11): **Implemented** (code exists) · **Locally verified** (exercised by tests or local runs
actually executed here) · **Integration verified** (against the real dependency) · **Acceptance verified** (defined
acceptance passed, incl. human ratings for Search) · **Production ready** (acceptance + hosting, monitoring,
backups/recovery, legal review, security operations, owner go/no-go).

**Verdict: MUSHIN is not production ready and no module is Acceptance verified.** Nothing is deployed. The highest status
anywhere is Locally verified; Search is NOT ACCEPTED.

## Modules

| Module | Status | Evidence | What blocks the next status |
|---|---|---|---|
| Identity, workspaces, tenant isolation | Locally verified | RLS and isolation tests; E2E `isolation`, `roles`, `team` | Hosted Supabase project (D-01) |
| Customer sign-in, sign-up, recovery, confirmation | Locally verified (local Supabase stack for Auth; E2E with a stub) | auth-check 17/17, recovery-check 10/10, E2E `auth` | Hosted project with SMTP |
| Catalogue search (Brain 1) | Locally verified (software correctness only) | E2E `search`, `eligibility`, `pricing`; freeze check | Human ratings (raters, adjudicator) — **NOT ACCEPTED** |
| Live Discovery (Brain 2) | Locally verified (refund/failure paths; delivery via recorded replay in integration tests) | E2E `discovery`; `live-runner.int`, `provider-runs.int` | Paid pilot (D-09) and ratings — **NOT ACCEPTED** |
| Creator profiles, eligibility, contact reveal | Locally verified | E2E `profile`, `eligibility` | SEC-08 bio policy (D-11) |
| Lists | Locally verified | E2E `lists` | — (acceptance criteria not defined beyond tests) |
| Campaigns and outreach log | Locally verified | E2E `campaigns`, `plans` | — |
| Outreach email | Locally verified (test mode only; nothing delivered) | E2E `plans`; `outreach.int` | Resend account and authorisation |
| Credits, plans, billing | Locally verified (mock payment provider) | E2E `billing`, `plans`; `engine.int`, `entitlements.int` | Paddle sandbox, seller eligibility (BIL-03), refund policy, D-05/D-06 |
| Settings, export, deletion | Locally verified | E2E `settings`, `privacy`; `team.int` | Billing-record retention (OD-013) |
| Support, activity, analytics | Locally verified | E2E `support`, `activity`, `dashboard` | — |
| Staff console (roles, step-up, enrolment codes, approvals, audit chain) | Locally verified (virtual authenticator) | staff E2E 31/31; `webauthn.int`, `staffops.int`, `staff-audit-chain.int` | Real hardware keys; D-09s staff identity decision |
| Legal pages and consent | Implemented (drafts) / Locally verified (consent recording) | E2E `legal` | Counsel review |
| Global states (404, error boundary, offline, degraded) | Locally verified (error boundary: Implemented) | E2E `states` | — |
| Alerts and operations | Locally verified | alert drill (critical in 289 s), restore drill, rotation drill | Alert channel, error tracker, uptime check, host |
| Security headers | Locally verified | csp-check 7/7 | Check on the chosen host |

## Integrations

| Integration | Status | Note |
|---|---|---|
| Supabase Auth / DB / Storage (hosted `yknp…`) | **Partly verified against the real hosted service (2026-10-19)**: Auth settings and JWKS (ES256) reached with the project's public key; DB reached read-only through both poolers; Data API exposure 0 problems; self-signed, wrong-issuer, expired and malformed tokens refused by the API verifier using the live JWKS | **BLOCKED:** database empty (HOST-01), genuine-token acceptance (needs a real sign-in), TLS CA (CA-01), SMTP (SMTP-01), Security Advisor (CLI login) |
| Paddle | Implemented — not integration verified | mock provider only; signature tests are unit tests |
| Resend | Implemented — not integration verified | test mode only |
| Serper, Apify, YouTube Data API | Implemented — not integration verified in this work | providers blank in all runs; recorded replays only |
| Groq / Ollama (LLM) | Implemented — not integration verified in this work | "AI unavailable" path tested |
| Meilisearch | Implemented, Locally verified (optional backend) | PostgreSQL is the default |

## Production gates

| Gate | State |
|---|---|
| Hosting and staging | Staging database and Auth: hosted Supabase `yknp…` (migrations 0001–0051 applied 2026-10-19). No API, worker or web host yet (D-01) |
| CI on a hosted remote | Not possible — no remote (owner) |
| Monitoring and alerts | Alert delivery built; channel, error tracker, uptime: owner |
| Backups and recovery | Local drills pass; hosted backups/PITR, RPO/RTO: D-12 |
| Credential rotation (SEC-01) | Owner |
| Legal review | Owner / counsel |
| Search acceptance | Raters and adjudicator (owner) |
| Owner go/no-go | Not requested |

## Release gates (mandate v4 addendum D), 2026-10-19 at `b593612`

Levels: L = local, I = isolated integration (disposable local PostgreSQL), H = real hosted service (staging `yknp…`),
P = production-like rehearsal, X = authorised production.

| # | Gate | Status | Evidence (level) | Blocker |
|---|---|---|---|---|
| 1 | Architecture and environment configuration | **PASS** (staging) | One project in `.env` (align-env); API and worker config valid; topology recorded in SYSTEM_BASELINE session 3 (H) | ADR-0001 approval and production project (D-01) |
| 2 | Supabase Auth and database connection | **PASS with one BLOCKED stage** | connect-check 13 PASS / 0 FAIL: DNS, Auth with the public key, JWKS ES256, read-only DB through both poolers, 51/51 migrations; forged, wrong-issuer, expired and malformed tokens refused; the API started against staging with readiness `database: ok` (H) | A genuine token from a real sign-in (`CHECK_ACCESS_TOKEN`); TLS CA file (CA-01) |
| 3 | Schema, permissions, isolation | **PASS (I)**, partial (H) | RLS and isolation tests in verify (I); Data API exposure 0 problems with all tables present (H) | Cross-tenant tests against the hosted DB not run (would create users there) |
| 4 | Critical workflows end to end | **PASS (L)** | Browser suites, see TEST_EXECUTION_REPORT session 3 (L) | Live Discovery delivery in the browser (providers blank) |
| 5 | Credit and billing invariants | **PASS (I)** | engine, partial-commit, entitlements, service integration tests (I) | Paddle sandbox (BIL-03) |
| 6 | Search acceptance | **NOT ACCEPTED** | No human ratings | Two raters and an adjudicator (owner) |
| 7 | Trial: permissions, activation, expiry, credits, no surprise billing | **PASS (I)** | trials.int 7/7 three runs in a row; config default `approval`; E2E trial page checks (L) | Extension policy, retention, consent wording (TRIAL-01..03); reminder delivery channel |
| 8 | Security and data recovery | **BLOCKED** | Local restore and key-rotation drills (L); exposure check (H) | Hosted backup/PITR and a restore exercise (D-12); credential rotation confirmation; Security Advisor (CLI login) |
| 9 | Builds, migrations, worker, monitoring, rollback | **Partial** | Clean-clone verify; frontend build; migrations from scratch twice (I) and on staging (H); API and worker each started against staging (worker with every provider key blanked: 0 errors, queue schema created, start-up jobs ran) (H) | No host, alert channel or uptime check; rollback of a hosted deployment not rehearsed |
| 10 | Provider, legal, business approvals | **BLOCKED** | — | D-09 pilot, Paddle, Resend, counsel review |
| 11 | Authorised deployment and smoke tests | **NOT TESTED** | Nothing deployed | D-01, host choice, authorisation |

**Verdict: ready for isolated testing.** Not ready for a controlled trial with real customers. That needs:
- hosted sign-in proven with a real token;
- SMTP for confirmations (SMTP-01);
- the API, worker and web app hosted on staging;
- a backup and restore exercise;
- the open trial policies (TRIAL-01..03).

Search stays NOT ACCEPTED. Nothing is production-verified.
