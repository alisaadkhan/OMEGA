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
| Hosting and staging | Not started — D-01 |
| CI on a hosted remote | Not possible — no remote (owner) |
| Monitoring and alerts | Alert delivery built; channel, error tracker, uptime: owner |
| Backups and recovery | Local drills pass; hosted backups/PITR, RPO/RTO: D-12 |
| Credential rotation (SEC-01) | Owner |
| Legal review | Owner / counsel |
| Search acceptance | Raters and adjudicator (owner) |
| Owner go/no-go | Not requested |
