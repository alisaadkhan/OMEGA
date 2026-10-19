# Remaining blockers

Each blocker: why it cannot be cleared in this environment, who must act, and the smallest next step. Ordered by impact.

| # | Blocker | Why not here | Who | Smallest next step |
|---|---|---|---|---|
| 1 | Exposed credentials (SEC-01) | Rotation needs access to each provider account; using the exposed values is forbidden | Owner | Rotate the database password, Supabase keys, `STAFF_JWT_SECRET` and every provider token; then `npm run rotate-encryption-key` (RUNBOOK §4) and `node --import tsx scripts/revoke-staff-sessions.ts` |
| 2 | Search not accepted (SRCH-01) | Needs two human raters and an adjudicator | Owner | Name them (requested by 2026-10-20); approve the protocol proposals (audit F §6); rating sheets are ready |
| 3 | No hosting, staging or hosted CI (ARCH-01, OPS-01) | No host chosen, no remote; deploying and pushing are forbidden without authorisation | Owner | Approve ADR-0001 (D-01), choose host/region, create a private remote |
| 4 | Evaluation data deadline | `eval-data/` must not be touched by this work | Owner | Delete the YouTube evaluation data and copies by **2026-11-12** (incl. old temp folders and the unused real-data `mushin_e2e_template` database) |
| 5 | Payments not verified (BIL-03) | No Paddle sandbox or seller confirmation | Owner | Paddle sandbox account; refund policy (OD-009) |
| 6 | Hosted Supabase not verified | No authorised hosted project | Owner | Create a dev/staging project; then run auth-check, recovery-check (with SMTP) and exposure-check against it |
| 7 | Developer `.env` mixes two Supabase projects (ARCH-07) | Owner's file; the API now refuses it | Owner | Point `SUPABASE_URL`, `JWKS_URI`, `JWT_ISSUER` at one project |
| 8 | `.env.example` unused variables (ARCH-02) | Reading `.env*` is denied by the owner's permission rule | Owner | Remove SQS/AWS, Sentry, PostHog, HuggingFace, Vercel, WORKER_SECRET, DATABASE_POOL_SIZE, UPSTASH_*; revoke the HuggingFace key |
| 9 | Live Discovery never run live since 13 Oct (SRCH-10) | Paid calls need authorisation | Owner | Approve the pilot envelope (D-09) |
| 10 | Catalogue empties over time (SRCH-02) | Needs a refresh budget (D-08) and Search unfrozen | Owner | Approve a budget; scheduler after ratings |
| 11 | Legal drafts | Counsel review | Owner | Send `#/terms`, `#/privacy`, `#/refunds`, `#/creator-data` drafts to counsel; name the legal entity |
| 12 | Manual accessibility review (UX-05) | Needs a person with NVDA/VoiceOver | Owner / tester | Run audit K §8's list |
| 13 | Pending product decisions | Change charges, access or disclosure | Owner | D-04, D-05, D-06, D-10, D-11, D-16, D-18, D-09s (DECISION_LOG.md) |
| 14 | `supabase/` folder rule vs migration sync (SUP-01) | A new migration needs a copy in `supabase/migrations/` | Owner | Confirm additive copies are allowed |
| 15 | Live Discovery delivered-results journey in the browser | Providers blank; a fixture provider mode for E2E would touch Brain 2 plumbing while Search is frozen | Engineering after ratings | Add a fixture provider mode for E2E once Search is unfrozen |

## Three most important next actions

1. Rotate the exposed credentials (blocker 1).
2. Name the raters and adjudicator so the rating round finishes before the 12 November deletion deadline (blockers 2, 4).
3. Approve ADR-0001 and create a private remote and a hosted staging project, so CI, hosted Auth and backups can be
   verified (blockers 3, 6).
