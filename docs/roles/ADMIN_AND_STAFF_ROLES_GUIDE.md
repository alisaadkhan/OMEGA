# Admin and Super Admin guide

Who this is for: MUSHIN staff with the **Admin** (operations) or **Super Admin** (platform owner) role. Both can do
everything Support can (see SUPPORT_ROLE_GUIDE.md). MUSHIN has no separate "Reviewer" role: creator review and catalogue
decisions are Admin work.

## Sign in and the security key

- Sign in at `#/staff/login` with password and authenticator code. Admins land on the **Overview**.
- Every Admin and Super Admin action needs a **hardware security key** (WebAuthn) confirmed in the current session;
  TOTP alone is never enough. Register the key in **Security** with the one-time enrolment code issued with the
  account, then use **Confirm with security key** when an admin section asks. Without it, admin sections show no data
  and the API answers `403 hardware_key_required`.

## Admin sections

| Section | Admin work |
|---|---|
| **Overview, Jobs** | Retry or cancel a discovery job (with a reason); read provider health. |
| **Providers** | Status and spend against each cap; pause or resume a provider (audited). |
| **Catalogue review** | Decide a creator's **country** (with evidence), clear a wrongly flagged **organisation** (a person, back in search), clear a wrong **possible-minor** flag (with a reason). |
| **Creator flags** | Customer reports from search and Live Discovery (below). |
| **Removal requests** | Review creators' data-removal requests: remove and add to the do-not-re-add list, or reject with a reason. |
| **Approvals** | Request or approve high-impact actions that need a second person (credit grants, role changes); you never approve your own request. |
| **Reviews, Usage** | Product feedback and usage analytics. |
| **Staff, Audit log** | Read the staff directory; search the tamper-evident audit log of every staff action. |
| **Support queue** | Everything Support does, plus assigning tickets to anyone. |

## Creator flags (customer reports)

Each open flag shows the creator, the reason, the customer's note, where it was reported (database search or Live
Discovery), how many open flags and confirmations the creator has, and never who reported it. Write a short note (what
was done or why), then:

- **Resolve:** the problem is fixed (for example the country was set in Catalogue review).
- **Exclude as…** a celebrity, brand, shop, media outlet, fan page or company: the creator gets a staff account type,
  leaves search after re-indexing, and neither the rules nor the AI review ever change it back.
- **Dismiss:** the report was wrong.

Every decision is recorded in the audit log (`catalogue.flag_resolve`, `catalogue.flag_exclude`,
`catalogue.flag_dismiss`).

## Super Admin only

- **Staff management:** create staff accounts (one-time password and authenticator secret shown once for a hand-over),
  change roles and suspend accounts, through approvals where a second person is required.
- **Trials:** approve, reject and look up founder-assisted trials; read trial feedback.
- **Support performance:** response and resolution times per staff member.

## Catalogue operations (run by the operations owner, not from the console)

These run as scripts against the local catalogue and, after approval, staging:

- **Order of a full re-verification:** evidence backfill → reassessment → AI account-type review
  (`scripts/catalog/backfill-evidence.ts`, `reassess-catalogue.ts`, `ai-review.ts`). The reassessment can be rerun at
  any time without undoing AI or staff decisions.
- **Owner account-type decisions:** `docs/completion/seed/owner-account-types-2026-11-15.json`, applied as staff
  decisions by the reassessment.
- **Catalogue sync to staging:** `scripts/catalog/load-staging.ts` then `sync-avatars.ts` (dry run first; staging only).
  The dry run executes everything and rolls back, so its counts are exact. Rules (`live-sync.ts`): fresher data wins,
  staff decisions and confirmed countries on staging are kept, local staff account types always apply, identity merges
  are replayed with `platform.merge_creator`, no YouTube API data older than 30 days is copied (and the retention function
  runs in the same transaction), contacts are never copied. A new creator is held back while its AI assessment (and so
  its minor check) is pending, and a new 100K+ account of undecided type waits for the AI account check.
- **Growing the catalogue:** `build.ts discover` (Live Discovery grid), `build.ts expand` (Instagram profiles that
  Pakistani creators link to or mention), `youtube-candidates.ts` then `build.ts seed --manifest` (YouTube channel search
  through the official API, region PK; known and under-10K channels skipped). Then `build.ts reassess` completes AI
  assessments left pending by rate limits (would-be-searchable creators first), `reassess-catalogue.ts --apply` applies
  the rules, and `ai-review.ts` checks 100K+ accounts.
- **YouTube 20-day refresh without a worker:** `scripts/catalog/youtube-refresh.ts` (about 3 quota units per channel),
  then the staging sync. The worker does this daily once it runs.
- **Retention:** YouTube API data older than 30 days is cleared daily by the worker (`platform.expire_youtube_api_data`);
  raw provider answers expire on their own schedule.
- **Exports for the owner:** `scripts/catalog/export-catalogue.ts` (qualified and disqualified accounts; contact details
  and YouTube data: never committed).
