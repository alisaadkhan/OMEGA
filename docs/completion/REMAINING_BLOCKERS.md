# Remaining blockers (external dependencies and owner decisions)

Updated 2026-10-21. Internal defects are tracked separately in `GAP_REGISTER.md`; an internal defect is never listed
here as an external blocker.

**Blocks:**
- **T:** isolated testing.
- **C:** a controlled customer trial.
- **P:** production.

| # | What is required (exact) | Why | Internal work already done | How it is verified later | Who | Blocks |
|---|---|---|---|---|---|---|
| 1 | Two independent Search raters and one adjudicator | Search acceptance needs human relevance ratings; none may be fabricated | Frozen v1 packets (`eval-data/packets/*-elig1`), separate v1/v2 catalogue packets (`eval-v2/packets/`, manifest), scoring and kappa tooling (`scripts/search-eval/score.ts`) | `score.ts` on the returned sheets; adjudication record; acceptance report update | Owner | C, P |
| 2 | Delete the YouTube evaluation data and copies by **2026-11-12** | YouTube API terms (cached data) | Purge script `scripts/search-eval/purge-eval-data.ts`; data kept only in git-ignored folders | The purge script's report | Owner | P (compliance) |
| 3 | Rotate the credentials exposed in the shared archive (SEC-01) | They were shared outside the team | Rotation tooling (`npm run rotate-encryption-key`, `scripts/revoke-staff-sessions.ts`); no secret appears in git history (scan 2026-10-21: 297 commits, 0 `.env` secret values) | Old keys refused by each provider; `connect-check` with the new ones | Owner | C, P |
| 5 | Host the worker (pg-boss) on a container host (Railway, Fly.io or Render), against the staging database | Live Discovery runs, search indexing, scheduled billing jobs and notifications are long-running: they cannot run as Vercel functions | Frontend and API configured for Vercel (`vercel.json` services; project `omega-api`, Root Directory = repo root; staging variables in Preview and Production with NODE_ENV=development) | Worker heartbeat in the staff console; a live run completing end to end | Owner | C, P |
| 6 | Staging TLS certificate file (CA-01) | Staging database traffic is encrypted but the server certificate is not verified | `DATABASE_SSL_CA_FILE` support; production refuses to start without it | `connect-check` with verification on | Owner | C, P |
| 7 | SMTP for Supabase Auth emails (SMTP-01) | Sign-up confirmation and password recovery emails from hosted Auth | Auth flows complete and E2E-tested locally with a stub | Hosted recovery check (`scripts/e2e-customer/recovery-check.mjs`) and a genuine token check (`CHECK_ACCESS_TOKEN`) | Owner | C, P |
| 8 | Paddle sandbox, then seller onboarding (BIL-03) and the refund policy (OD-009) | Real payments | Billing engine, ledger, webhooks, idempotency, mock checkout end to end | Sandbox checkout → webhook → credits granted, refunded; then a live test charge | Owner | P (C can run on founder-approved trials) |
| 9 | Authorise real outreach email (`OUTREACH_EMAIL_MODE=resend`, Resend key, webhook secret, from address) | Real delivery to creators | Off / test / Resend modes; test mode never delivers and says so; production refuses test mode | One authorised send to an owned address; delivery webhook recorded | Owner | C (optional), P |
| 10 | Apify top-up or the 2026-11-01 monthly reset; Serper credits (628 left) | Instagram/TikTok extraction needs Apify (account at its USD 5 limit); Serper funds web search | Combined spend gate; Apify account-room check before every paid scrape; YouTube-only discovery works | Next discovery batch: Instagram cells complete | Owner | C (catalogue growth), P |
| 11 | Meilisearch Cloud reachability (only if Meilisearch is to be the backend) | The Cloud project is unreachable from this network | Integration complete; PostgreSQL is the default and needs nothing; fallback and readiness tested | `npm run meili:health` and the `meilisearch.int` suite against Cloud (throwaway index) | Owner | — (only if switching backend) |
| 12 | Backups/PITR, RPO/RTO and retention (D-12) | Recovery from data loss | Restore drill and audit-verify scripts, tested locally | A hosted restore exercise | Owner | P |
| 13 | Counsel review of Terms, Privacy, Refunds and Creator Data; the legal entity name | Legal | Draft pages with a "draft" banner | Approved texts replace the drafts | Owner / counsel | C, P |
| 14 | Manual screen-reader accessibility review (UX-05) | Needs a person with NVDA/VoiceOver | Automated a11y checks in the E2E suite | Review notes, fixes | Owner / tester | P |
| 15 | Product decisions: D-04, D-05, D-06, D-08, D-09, D-10, D-11, D-16, D-18, D-09s, TRIAL-01, TRIAL-02 | They change charges, access or disclosure | Each current behaviour is implemented and tested; see `DECISION_LOG.md` | The decided behaviour plus its tests | Owner | C or P per item |

## Resolved since 2026-10-19

| Was | Now |
|---|---|
| Staging migrations (HOST-01) | Applied to 0052 |
| Staging catalogue | Loaded on 2026-10-20: 2,181 creators |
| Live Discovery never run live since 13 Oct (SRCH-10, D-09) | Run under the USD 25 authorisation, ≈ USD 1.7 spent by 2026-10-21 |
| Additive `supabase/migrations/` copies (SUP-01) | Made for 0050–0052 |
| Hosting choice (D-01) | Vercel for the frontend and the API (2026-10-21); the worker on a separate container host (open, #5) |
| No remote (part of OPS-01) | Branch `feat/internal-completion-and-search-acceptance` pushed to https://github.com/alisaadkhan/OMEGA (2026-10-21) |

## Next actions, in order

1. Name the raters and adjudicator (#1), before the 12 November deletion deadline (#2).
2. Rotate the exposed credentials (#3).
3. Check the first hosted CI run on GitHub (Actions tab) for the pushed branch.
