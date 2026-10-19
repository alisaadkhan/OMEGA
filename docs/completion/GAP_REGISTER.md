# Gap register (mandate v3)

Source: `docs/audit/2026-10-16/E_GAP_REGISTER.md` and `registers/gap_register.csv` (audit at `1398cee`). This file maps
every audit ID to its current state and adds gaps found since, with the next free IDs. Status words follow mandate §11
(Implemented, Locally verified, Integration verified, Acceptance verified, Production ready) plus **Open**,
**Blocked (owner)** and **Waiting (Search freeze)**. Commits are on `master`.

## Audit IDs

| ID | P | Title (short) | Status | Commit(s) | Tests / evidence | Blocker or next action |
|---|---|---|---|---|---|---|
| SEC-01 | P0 | Exposed credentials in the shared archive | Blocked (owner) for rotation; tooling Locally verified | `5fc412f`, `4315e97` | package-source.test (source scan), revoke-staff-sessions, rotate-encryption-key drill | Owner rotates every credential, then runs `rotate-encryption-key` and `revoke-staff-sessions.ts` |
| SEC-02 | P0 | Step-up bound to a token claim | Locally verified | `5fc412f`; 5-minute validity this session | webauthn.int (forged hwk token refused, expired/revoked step-up) | — |
| SEC-03 | P0 | Invitation trusts editable metadata | Locally verified (local Supabase stack) | `b4dec75` | team.int; auth-check 17/17 | Integration verification needs the hosted project |
| SEC-04 | P0 | Silent workspace fallback | Locally verified | `d12e7ab` | identity tests (403 workspace_access_denied, 400 malformed), E2E | Two-tab browser journey: see E2E_COVERAGE_MATRIX |
| SEC-05 | P0 | Proxy/IP handling | Locally verified; production start rule this session | `aa7a03c` | app.test (spoofed X-Forwarded-For), config.test | — |
| BIL-01 | P0 | Live Discovery pricing copy | Locally verified | `c9af1b1` | plans.test, E2E quote text | D-04 wording (owner) |
| BIL-05 | P0 | Ledger cascades on hard delete | Locally verified | `35b0063` (0042) | billing-schema.int, privacy tests | — |
| SRCH-04 | P0 | Orphaned Apify runs | Locally verified (mocks) | `18d4c60` (0043) | provider-runs.int, scrapers/provider-runs.test | Integration verification needs a paid run (D-09) |
| OPS-01 | P0 | CI fails without `.env` | Locally verified (clean clone) | `8353f49`, `83c28e6` | clean-clone verify (TEST_EXECUTION_REPORT) | Hosted CI needs a remote (owner) |
| SRCH-01 | P1 | Search unproven | Blocked (owner: raters) | — | packets `blind-b1-elig1`, `blind-b2-elig1` | Two raters + adjudicator |
| SRCH-02 | P1 | Catalogue empties itself | Blocked (D-08) | — | — | Owner budget, then scheduler (after ratings) |
| SRCH-03 | P1 | Coverage too small | Blocked (D-10) | — | — | Launch scope per platform |
| SRCH-06 | P1 | Ignored query clauses not reported | Waiting (Search freeze) | — | — | After ratings |
| SRCH-07 | P1 | Loose filter schemas | Waiting (Search freeze) | — | — | After ratings |
| BIL-02 | P1 | Empty searches charged | Blocked (D-05) | — | E2E asserts the current charge | Owner decision |
| UX-01 | P1 | No legal pages / consent | Locally verified (drafts) | `663ca41` | contracts.test, E2E legal routes + consent | Counsel review (owner) |
| UX-02 | P1 | Recovery/confirmation links | Locally verified (local Supabase + Mailpit); confirmation result screen this session | `4f6d60c` | recovery-check 10/10 | Hosted SMTP (owner) |
| ARCH-01 | P1 | Contradictory target architecture | Implemented (ADR proposed) | `2741466` | — | D-01 (owner) |
| OPS-02 | P1 | E2E not reproducible | Locally verified | `329f7a0`; `npm run e2e:*` this session | E2E 3 × (91 + 40), 3 × 31 on the synthetic template | Hosted CI (owner) |
| OPS-03 | P2 | No alert delivery | Locally verified | `1bb12d7` (0046) | alert-notifier.int, alert drill (critical in 289 s) | Alert channel, error tracker, uptime check (owner) |
| OPS-04 | P2 | Backup/restore | Locally verified | `b45af22` | erasure.int, restore-drill.sh | D-12, hosted drill (owner) |
| SRCH-05 | P2 | Per-process spend guards | Locally verified | `18d4c60` | provider-runs.int | — |
| SEC-06 | P2 | Upstash fail-open | Locally verified | `aa7a03c`, `eefee21` | config.test | — |
| SEC-07 | P2 | First key enrolment | Locally verified | `de66cec` (0047) | webauthn.int, staff E2E | Real hardware keys untested |
| SEC-08 | P2 | Bios leak contact strings | Blocked (D-11) + Search freeze | — | — | Owner decision |
| SEC-09 | P2 | No key versioning | Locally verified | `4315e97` | crypto.test, key-rotation.int, drill | — |
| SEC-13 | P2 | IdP account survives deletion | Locally verified (local Supabase) | `c5a7aed` | team.int, auth-check | Hosted project |
| SEC-11 | P2 | Data API exposure | Locally verified (local Supabase) | `ae85459` (0048) | exposure-check.test; 0 problems; suite on Supabase 920 passed | Run exposure-check on the hosted project |
| OPS-05 | P2 | Two DB round trips per request | Locally verified (load check) | — | load-check: search p95 187 ms at concurrency 20 | Staging load test at 2× pilot peak (owner) |
| BIL-03 | P2 | Real payment path | Blocked (owner) | — | mock provider tests | Paddle sandbox + seller eligibility |
| SRCH-10 | P2 | No live pilot | Blocked (D-09) | — | — | Authorise the pilot envelope |
| UX-03 | P2 | Global workspace selection | Locally verified | `d12e7ab` | workspace.ts per-tab sessionStorage | — |
| BIL-06 | P2 | Parallel live runs | Locally verified | `c944d61` (0045) | live-service.int (concurrent confirmations) | — |
| SRCH-09 | P2 | Silent LLM batch failures | Waiting (Search freeze) | — | — | After ratings |
| SEC-16 | P2 | (Search-related) | Waiting (Search freeze) | — | — | After ratings |
| ARCH-07 | P2 | Mixed Supabase projects | Locally verified | `3551177` | config.test | ENV-01 (owner fixes `.env`) |
| SEC-14 | P2 | SPA security headers | Locally verified | `c743ecf` | security-headers.test, csp-check 7/7 | Check on the chosen host |
| SEC-10 | P2 | Audit log not tamper-evident | Locally verified | `5507768` (0049) | staff-audit-chain.int, verify drill | Store daily digests outside the DB (owner) |
| ARCH-03 | P2 | Upstash still wired | Locally verified | `eefee21` | config.test, rate-limit.test | — |
| DATA-03 | P2 | Export truncation | Locally verified | `c8d9ec3` | team.int (limit 1) | — |
| BIL-04 | P2 | Top-up expiry half-enforced | Locally verified | `c944d61` (0045) | service.int | — |
| SRCH-08 | P3 | Offset pagination | Waiting (Search freeze) | — | — | After ratings |
| SRCH-12 | P3 | Gazetteer | Waiting (Search freeze) | — | — | Deferred |
| UX-04 | P3 | Single 1.1 MB bundle | Locally verified | `b102a89` | build output: landing 243 kB gzip | — |
| SEC-15 | P3 | Fabricated testimonials | Locally verified | `37145b3` | deleted; grep | — |
| ARCH-02 | P3 | Unused env variables | Blocked (owner) | — | — | `.env*` access is denied by the owner's rule |
| ARCH-04 | P3 | Meilisearch Cloud in dev | Implemented (docs) | `d77e978` | README | Owner removes the Cloud key from `.env` |
| UX-05 | P3 | Manual a11y review | Open | — | axe in E2E | Keyboard-only pass recorded this mandate; screen reader needs a person |
| SRCH-13 | P1 | Evaluation design limits | Implemented (reporting additions this session) | — | metrics.test | Owner approves protocol proposals (F §6) |
| DOC-01 | P1 | Stale documentation | Locally verified | `d77e978` | DIS table in docs/readiness/progress.md | Owner items DIS-09/13/16/18/23/26 |

## New gaps (found after the audit)

| ID | Title | Status | Evidence | Next action |
|---|---|---|---|---|
| UX-06 | No 404 page: unknown routes silently showed the landing page | Open → this session | App.tsx `parse()` returned `initial` | Add `#/…` not-found screen + E2E |
| UX-07 | No error boundary or degraded-service banner | Open → this session | no ErrorBoundary in frontend | Add boundary with request id; banner from `/health/ready` |
| UX-08 | No email-confirmation result screen (mandate §3.2 UX-02) | Open → this session | sign-up redirect went to `#/dashboard` | Add `#/confirmed` result screen |
| OPS-06 | `npm run e2e:customer` / `e2e:staff` did not exist | Open → this session | package.json | Wrapper that starts the stub and Vite, builds the template, runs, stops |
| SRCH-14 | Reporting metrics: weighted kappa, raw agreement, bootstrap CIs, standard P@5 | Open → this session | metrics.ts had unweighted kappa only | Add with tests (no ranking change) |
| TEST-01 | Export test depended on the date (failed after midnight UTC) | Locally verified | `6849e83` | — |
