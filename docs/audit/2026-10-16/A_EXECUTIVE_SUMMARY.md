# A — Executive summary and verified project status

**Audit of:** MUSHIN repository `master` @ `1398cee` (2026-10-16 16:23 +05:00) plus the reconciled documentation
candidate (14 Oct). **Method:** module-by-module code reading, schema/grant inspection, re-execution of the full local test
suite and frontend build on a sanitised copy (no secrets, no remote services), read-only analysis of the evaluation
packets, and targeted research into official sources. Nothing was modified, deployed, purchased, sent or deleted.

## Bottom line

MUSHIN is a well-engineered **local** MVP with unusually strong data-integrity foundations: forced row-level security on
all 28 workspace tables, an append-only, idempotent credit ledger, a transactional quote → reserve → job flow for Live
Discovery, careful handling of hostile scraped content, and honest outcome states. **It is not production-ready and Search
is NOT ACCEPTED.** The blockers are concentrated in five places:

1. **Exposed credentials (Critical, SEC-01).** The shared archive contains a populated `.env` with live remote-database,
   service-role, encryption, staff-signing and provider keys. With the staff signing secret, WebAuthn step-up can be
   bypassed by forging a token (SEC-02). Containment is the owner's first job (H §3).
2. **Search is unproven (Critical, SRCH-01).** No human rating exists. Of 35 catalogue panel queries only 11 return
   anything and only 10 have rateable results; TikTok has 5 (Brain 1) and 13 (Brain 2) rows; every Brain 2 figure since
   13 Oct is replay, not live.
3. **The catalogue empties itself (Critical, SRCH-02).** Creators drop out after 90 days without a fresh follower count
   (30 days for YouTube API data), and nothing refreshes them automatically.
4. **No hosted environment (Critical, OPS-03; ARCH-01).** No staging, no CI that has ever run (and the prepared CI would
   fail), no alert delivery, no hosted backups, and two contradictory target architectures on record.
5. **Customer-facing trust gaps (Critical/High).** No Terms or Privacy Policy although sign-up says users agree to them
   (UX-01); the pricing copy for Live Discovery contradicts the charging rule (BIL-01); invitation acceptance trusts a
   user-editable metadata field (SEC-03); a stale workspace header silently redirects writes to another workspace
   (SEC-04).

## Reported claims versus what this audit could verify

| Claim (source) | Verdict | Evidence |
|---|---|---|
| Branch `master`, commit `1398cee`, 224 commits, 37 migrations | **Verified** | [ran] git; migrations 0001–0037 |
| Team/privacy merged | **Verified** | `team-privacy` contained in master |
| "847 passed, 7 skipped" | **Verified with a caveat** — 847 passed, 4 skipped, and **1 suite fails without a developer `.env`** (the 3 remaining skips) | [ran] vitest; OPS-01 |
| Customer E2E 3 × 102/102; staff E2E 3 × 31/31 | **Not reproducible from the repository** (needs the developer's local catalogue database) | OPS-02 |
| Frontend builds; no secrets in the bundle | **Verified** | [ran] build + scan |
| Search not accepted; packets exist | **Verified**; 413 judgements per rater = 222 + 35 + 131 + 25; 273/207 are superseded | [ran] F §4 |
| Archive contains evaluation data and secret-bearing files | **Verified** (names only, values never printed) | VERIFICATION_LOG §6 |
| "Postgres rate limiting is the default and fails closed" | **Conflicting** — Upstash (fail-open) is auto-selected whenever its variables exist, as in the supplied `.env` | SEC-06 |
| "Top-ups never expire (enforced by the database)" | **Partly** — enforced in code; the constraint does not forbid an expiry on a top-up | BIL-04 |
| Readiness README "Catalog search: Complete", "Live discovery: Complete" | **Stale / incorrect** | DIS-10 |

## Implementation matrix (headline)

Verified: workspace deletion, trial-once-per-identity, TOTP sign-in, credit engine, 90-day eligibility rule, database
tenant isolation. Implemented, not fully verified: invitations, export, Super Admin bootstrap, staff authorisation,
approvals, admin actions, Postgres limiter, Brain 1, Brain 2. Partial: membership/switching, account deletion, WebAuthn,
audit log, refunds. Conflicting: CRM privacy at payload level (bios), rate-limit store, pricing copy. Blocked: real
Supabase Auth, Paddle, live providers, Search ratings. Full matrix: `C_…` §3.

## Final completion statement

**Verified as complete (locally, by re-run tests and code inspection):** database tenant isolation; credit lots,
ledger, reservations and settlement; Live Discovery quote/confirm/reserve atomicity and terminal settlement; elig-1
eligibility enforcement in every customer path; workspace deletion with financial retention; one free trial per
identity; staff password + TOTP sign-in with lockout and replay protection; contact encryption and audited reveal;
SSRF-safe avatar fetching; Paddle signature verification logic; frontend build with no secrets in the bundle.

**Implemented but unverified:** invitations (SEC-03 defect), workspace export, Super Admin bootstrap, two-person
approvals, provider pause and job retry/cancel, Postgres rate limits under real proxies, catalogue search and Live
Discovery quality, every browser journey, real Supabase sign-in, recovery and email links, Paddle checkout and webhooks,
live provider behaviour, accessibility beyond automated checks.

**Incomplete or broken:** WebAuthn step-up bound only to a token claim (SEC-02); silent workspace fallback (SEC-04);
proxy IP handling (SEC-05); orphaned Apify runs and per-process spend guards (SRCH-04/05); public Live Discovery pricing
copy (BIL-01); empty searches charged (BIL-02, owner decision); no catalogue refresh (SRCH-02); no legal pages (UX-01);
no set-new-password flow (UX-02); CI fails without secrets (OPS-01); E2E not reproducible (OPS-02); bios leak contact
strings (SEC-08); identity-provider account survives deletion (SEC-13); ledger tables cascade on hard delete (BIL-05).

**Blocked by missing access or evidence:** human ratings (raters); paid provider pilot (spend authorisation); Supabase
Auth/SMTP (test project); Paddle (seller confirmation, sandbox); hosting, staging, backups, load tests (D-01); legal
review (counsel).

**Must be fixed before a real MVP release (closed pilot with real customers):** SEC-01, SEC-02, SEC-03, SEC-04, BIL-01,
BIL-05, SRCH-04, OPS-01 (all P0); Search accepted by the rating gate (SRCH-01) with an explicit scope (SRCH-03); UX-01,
UX-02; ARCH-01 decision with staging, SEC-05, SEC-11, SEC-14, OPS-03 (alert delivery), OPS-04 (backup + drill); a
refresh policy for the catalogue (SRCH-02) at least for creators customers have saved; DOC-01 records corrected.

**Must be completed before production launch (open sign-up, paid plans):** everything above plus BIL-03 Paddle
end-to-end; SRCH-10 live pilot; SEC-06/ARCH-03 Upstash removal; SRCH-05; BIL-06; SEC-07; SEC-09 key rotation tooling and
re-encryption; SEC-13; SEC-08 policy; OPS-02 CI-run E2E; OPS-05 load test; UX-05 manual accessibility; legal answers to
H §5.

**Can safely be deferred:** keyset pagination (SRCH-08), gazetteer (SRCH-12), code splitting (UX-04), audit hash chain
(SEC-10), streamed export (DATA-03), Meilisearch decisions, Edge Function experiments, email outreach automation,
audience demographics (kept disabled), creator marketplace features.

## Next three highest-priority actions

1. **Contain the credential exposure today** (H §3): withdraw the archive, rotate the database password and Supabase
   keys, `STAFF_JWT_SECRET` and every provider token; log each rotation.
2. **Name the two raters and the adjudicator by 20 October** and approve (or reject) the protocol proposals in F §6, so
   the rating round finishes before the 12 November deletion deadline.
3. **Authorise the P0 engineering batch** in `I_…` §3 (CI green without secrets on a private hosted remote, server-side
   step-up, no silent workspace fallback, verified-email fix, pricing copy, ledger delete protection, Apify run
   persistence) and record decision **D-01** on hosting so staging can be built.
