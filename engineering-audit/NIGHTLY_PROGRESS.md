# Progress (living log, newest last)

| ID | Task | Workstream | Priority | Status | Evidence |
|---|---|---|---|---|---|
| T-001 | Baseline: typecheck, lint, unit, frontend, npm audit | QA | P0 | COMPLETED | NIGHTLY_BASELINE.md |
| T-002 | Key rotation missed `staff.staff_users.totp_pending_encrypted` (a rotation would leave a pending authenticator undecryptable) | Security | P1 | COMPLETED | commit 2de201f; key-rotation.int 3/3 |
| T-003 | Shared test database polluted by the staff pricing test (Growth 13,000, reveal 7) causing false billing failures | QA reliability | P1 | COMPLETED | commit 2de201f; ops+billing int 91/91 together |
| T-004 | Migration-number assertion failed at 0100 | QA | P2 | COMPLETED | commit 2de201f |
| T-005 | Lint error | Code quality | P3 | COMPLETED | commit 2de201f; `eslint .` clean |
| T-006 | Bio-link crawler accepted special-purpose address ranges (SSRF hardening) | Security | P2 | COMPLETED | commit d5a967a |
| T-007 | `.catalog-storage/` (raw payloads, contact cache) ignored only locally, not by the repo | Privacy | P2 | COMPLETED | commit d5a967a |
| T-008 | YouTube evaluation data past the 12 Nov deletion deadline (`mushin_eval_disposable`) | Compliance | P1 | AWAITING APPROVAL | APPROVAL_REQUIRED AP-08 |
| T-009 | Crawler DNS rebinding (check and connect resolve separately) | Security | P3 | ACCEPTED RISK | operator-only script; documented in NIGHTLY_DECISIONS.md |
| T-010 | Full integration suite on a fresh database: 42 failures found | QA | P0 | COMPLETED | 39 = acceptance briefs under 3 words (owner rule 22 Nov), 1 privacy gap, 2 follow-ons; 6 search tests need Meilisearch (not running: stopped for low memory) |
| T-011 | Account erasure did not erase the new notifications (personal data left after "delete my account") | Privacy | P1 | COMPLETED | commit 51c1cce; privacy.int passes |
| T-012 | Acceptance suites updated to 3+ word live briefs | QA | P2 | COMPLETED | commit 51c1cce; acceptance 158+36 pass |
| T-013 | Production security headers and CORS | Security | P1 | COMPLETED (VERIFIED) | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy on page and API; foreign origin gets no CORS allow |
| T-014 | Meilisearch-backed search tests (6) | QA | P2 | BLOCKED | local Meilisearch stopped by the host for low memory; restart only when the machine has memory |
| T-015 | Production auth boundaries: customer, staff and cron endpoints without or with a forged token | Security | P0 | COMPLETED (VERIFIED) | /v1/me, support, featured: 401; /admin/v1/* (overview, subscriptions, catalogue, audit): 401; forged staff token 401; cron without secret 404; public showcase and plans 200 |
| T-016 | Live landing page in a real browser at 390 px: overflow, console, showcase images | UX | P2 | COMPLETED (VERIFIED) | no page overflow, 0 console errors/warnings, 24 creators x2 loop, 0 broken images; evidence/landing-mobile.png |
