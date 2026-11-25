# Approval required

Tasks parked because they need the owner's permission, credentials, payment or a production change. Each is
self-contained: what is blocked, why, exactly what is needed, and whether a safe alternative exists.
Statuses: AWAITING APPROVAL / BLOCKED. Newest at the bottom of each section.

## Production changes (push, deploy, live database)

| ID | Task | Why blocked | What is needed | Safe alternative |
|---|---|---|---|---|
| AP-01 (DONE 25 Nov: pushed 184ad7f..b12d136) | Push local commit `0f52c35` (notifications, support conversations, Data Sources history) to `github/feat/internal-completion-and-search-acceptance` (production deploys from it) | Mission rule: no push/deploy without explicit authorisation | Owner: "push 0f52c35" | Everything is tested locally (see test matrix) |
| AP-02 (DONE 25 Nov: 0100 applied live on owner instruction) | Apply migration `0100_notifications.sql` to the live database (must precede AP-01, or the bell and ticket routes fail on live) | Production database change; my run was refused by the permission classifier on 23 Nov | Owner runs `DATABASE_SSL_CA_FILE=prod-ca-2021.crt npm run db:migrate`, or authorises me | Validated in a rolled-back transaction and on the test database |
| AP-03 | Turn on notification emails in production: `NOTIFY_EMAIL_MODE=resend`, `NOTIFY_EMAIL_FROM`, `RESEND_API_KEY` on Vercel | Secrets / production configuration (I cannot read or set Vercel env) | Owner sets the three variables, with a verified sending domain in Resend | Without them the bell still shows every notification; emails wait (dropped after 7 days) |
| AP-04 (DONE 24 Nov) | Copy the 23 Nov catalogue cleanup to live (87 trashed and banned, 5 merges, 180 restored; owner decided 23 Nov to keep the 176 restored) | Live data write | Owner: "sync the catalogue cleanup to live" | Dry run of the live sync can be prepared and shown first |
| AP-05 (DONE 24 Nov) | Live contact correction (111 `+0` phones to `+92`, 6 repeats, 3 typo emails) | Live data write of personal data | Owner approval; I will dry-run first | Done locally already |

## Infrastructure and spend

| ID | Task | Why blocked | What is needed | Safe alternative |
|---|---|---|---|---|
| AP-06 | Production runs no background worker: outbox events, live discovery runs, YouTube 30-day refresh and reassessment never execute on live (only the daily Vercel cron) | Choosing and paying for a worker host is an owner decision | Owner picks a host (e.g. Railway/Fly/Render running `Dockerfile.worker`) | API now sends notification emails itself; daily cron covers billing jobs |
| AP-07 | Paid Apify plan to unmask Contact-button emails (39 qualifying business accounts) | Paid spend | Owner approves plan and budget | Free bio-link crawler already used |

## Compliance and data deletion

| ID | Task | Why blocked | What is needed | Safe alternative |
|---|---|---|---|---|
| AP-08 (DONE 24 Nov) | Delete the YouTube evaluation corpus database `mushin_eval_disposable` (owner deadline 2026-11-12, YouTube API 30-day rule; `scripts/search-eval/retention.test.ts` fails until done). Also move another session's `eval-data/tmp-1122/` (IG/TikTok run logs, not YouTube) out of `eval-data/` | Irreversible deletion; the folder belongs to another session | Owner: "purge the eval data", then `PG_BIN=... node --import tsx scripts/search-eval/purge-eval-data.ts --confirm` | Dry run done: it would drop only that database and that folder |
