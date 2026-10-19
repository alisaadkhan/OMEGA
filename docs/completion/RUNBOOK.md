# Runbook (local; mandate v3 Phase 5)

Every command here exists in the repository and was run during this work unless marked *not run here*. No step
contacts a paid provider, a hosted Supabase project, Paddle or Resend. Never print secret values; refer to variables by
name.

## 1. Start locally

| Step | Command | Notes |
|---|---|---|
| PostgreSQL 17 | `pg_ctl -D <data dir> -l <log> start` (portable binaries: `tmp/pg-test-runtime/pgsql-portable/bin`) | listens on `localhost:54330`; after an unclean stop it recovers for a few seconds (`pg_isready` says "rejecting connections") |
| Migrate | `DIRECT_URL=postgres://postgres@localhost:54330/<db> DATABASE_SSL_CA_FILE= npm run db:migrate` | forward-only; next new migration is 0050 (see PROGRESS.md) |
| Meilisearch (optional) | `npm run meili:start` | PostgreSQL search is the default (`CATALOG_SEARCH_BACKEND=postgres`) |
| API | `npm run dev:api` | refuses to start on unsafe configuration (see §6) |
| Worker | `npm run dev:worker` | logs `reconciled at start-up` once the search documents are rebuilt |
| Frontend | `npm run dev:web` (Vite, `:5173`, proxies `/api` to the API port) | |
| Health | `curl localhost:4000/health/live` (process up) · `curl localhost:4000/health/ready` (database and search reachable) | ready answers 503 with `degraded` when a dependency is down |

## 2. Tests

| What | Command |
|---|---|
| Everything (lint, typecheck, boundaries, unit, integration) | `TEST_DATABASE_URL=postgres://postgres@localhost:54330/<name containing test> TEST_DATABASE_SSL_CA_FILE= npm run verify` |
| Customer browser suite | `PG_BIN=<pg bin> npm run e2e:customer -- <runs>` |
| Staff browser suite | `PG_BIN=<pg bin> npm run e2e:staff -- <runs>` |
| E2E template only | `PG_BIN=<pg bin> npm run e2e:template` (synthetic, fictional creators) |
| Frontend build + bundle scan | `npm --prefix frontend run build && node --import tsx scripts/check-bundle-secrets.ts frontend/dist` |
| Security headers in Chrome | `node scripts/e2e-customer/csp-check.mjs` (after the build) |
| Search freeze | `node --import tsx scripts/search-eval/freeze-check.ts ../MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/testing/search_eval_queries_unlabeled.csv` (never set `TEST_DATABASE_URL` to the evaluation database) |
| Local Supabase checks (Docker) | `npx supabase start`; `bash scripts/supabase/auth-check.sh`; `bash scripts/e2e-customer/recovery-check.sh`; `node --import tsx scripts/supabase/exposure-check.ts <db url> --api <url> --key <publishable key>` |

The test-database guard refuses any `TEST_DATABASE_URL` whose name lacks `test` or starts with `mushin_eval`.

## 3. Backup and restore (local drill)

- Drill: `PG_BIN=<pg bin> bash scripts/ops/restore-drill.sh`: backup, an erasure after the backup, restore, re-apply,
  checks. Last result: all PASS, restore + re-apply 2 s.
- Real procedure after restoring any backup, before taking traffic:
  1. `npm run ops:erasure-journal -- <file>` is run **daily** and kept outside the database (hashes only).
  2. Restore the backup (host tooling; hosted backups/PITR are the owner's decision D-12, not configured here).
  3. `npm run db:migrate` if the backup predates migrations.
  4. `npm run ops:after-restore -- <latest journal>`: re-applies erasures, clears YouTube API data past 30 days, checks
     migrations and every workspace's credits; non-zero exit on any failure.
  5. Start the worker (its start-up reconcile rebuilds search documents), then the API.

## 4. Key rotation (`DATA_ENCRYPTION_KEY`)

1. New key: `npm run env:secrets` or `openssl rand -base64 32`. Keep the old key until step 5.
2. Stop the API and the worker.
3. Dry run: `DATA_ENCRYPTION_KEY=<new> DATA_ENCRYPTION_KEY_PREVIOUS=<old> npm run rotate-encryption-key` → must report
   0 undecryptable values.
4. Apply: same with `-- --apply --operator "<name>" --reason "<why>"` (audited, `platform.encryption_key_rotated`).
5. Configure the services with the new key, start them, check a staff TOTP sign-in and a contact reveal; destroy the
   old key. Drill result (disposable copy): 10 v1 values re-encrypted, a second run changed nothing.

Other credentials (SEC-01): rotate at each provider (owner), then `node --import tsx scripts/revoke-staff-sessions.ts`.

## 5. Provider pause and incidents

- Pause/resume a provider family: staff console › Operations › Provider controls (Admin, security key, reason
  required, audited). While paused, the worker refuses its calls and affected jobs refund.
- Job retry/cancel: staff console › Jobs (Admin, audited).
- Alerts: `ALERT_WEBHOOK_URL` (required in production). Test from the console (Send test alert). Drill:
  `PG_BIN=<pg bin> bash scripts/ops/alert-drill.sh` (stopped worker → critical within 5 minutes; last 289 s).
- Staff audit integrity: `npm run ops:verify-audit -- [--digest <seq>:<hash>]` daily; store the printed digest outside
  the database.
- Revoke every staff session: `node --import tsx scripts/revoke-staff-sessions.ts` (or `select staff.revoke_all_sessions('<reason>')`).
- New staff key after a loss: revoke the old keys, then `npm run issue-enrolment-code -- --email … --operator … --reason …`.

## 6. Diagnosis

| Symptom | Likely cause | Check |
|---|---|---|
| API exits at start with a config error | the message names the variable; production needs `TRUSTED_PROXIES`, `ALERT_WEBHOOK_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Paddle keys, `DATABASE_SSL_CA_FILE`, an LLM cap; `JWT_ISSUER`/`JWKS_URI` must be on the `SUPABASE_URL` project | read the first lines of the log |
| `/health/ready` degraded | database or Meilisearch unreachable | `pg_isready`; `npm run meili:health` |
| Staff admin actions refused with "security key" | step-up older than 5 minutes, key revoked, or sessions revoked | confirm with the key again |
| Customer request 403 `workspace_access_denied` | the tab's selected workspace is not a membership (removed, deleted) | the app clears the selection and says so |
| Search results missing after a restore | search documents not rebuilt | restart the worker (start-up reconcile) or `npm run search:reindex` |
| Worker alert "never reported"/stale heartbeat | worker stopped or its queue is stuck | worker log; `platform.process_heartbeats` |
| Credit mismatch alert | lots and ledger differ for a workspace | worker log entry "credit lots do not match the ledger"; do not edit ledger rows by hand |
| E2E refuses to start | a port (4000/4999/5173 or 4100/4998/5174) is busy | stop the other process; the script never stops processes it did not start |

## 7. Hosted Supabase (staging `yknp…`, region ap-northeast-2)

| Task | Command | Notes |
|---|---|---|
| Point `.env` at one project | `node --import tsx scripts/supabase/align-env.ts [--pooler-host aws-1-ap-northeast-2.pooler.supabase.com] [--write]` | Dry run by default; prints refs only; `--write` keeps `.env.bak-<time>` |
| Prove the connection, stage by stage | `node --env-file=.env --import tsx scripts/supabase/connect-check.ts` | Read-only. Set `CHECK_ACCESS_TOKEN` to a token from a real sign-in to prove acceptance |
| Apply migrations | `npm run db:migrate` | Uses `DIRECT_URL` (session pooler 5432). The direct `db.<ref>` host is IPv6-only and unreachable from IPv4 networks |
| Data API exposure | `node --import tsx scripts/supabase/exposure-check.ts "$DATABASE_URL" --api "$SUPABASE_URL" --key "$VITE_SUPABASE_PUBLISHABLE_KEY"` | Expect `problems: 0` |

## 8. Founder-assisted trial

| Setting | Meaning |
|---|---|
| `TRIAL_ACTIVATION` (API) | `approval` (default; owner decision 2026-10-19): sign-up starts no trial, and a Super Admin approves each one in the staff console (Trial requests). `automatic` gives the trial at first sign-in (E2E harnesses only) |
| `VITE_TRIAL_PHONE` (web build) | The business number for "Call us for a free 14-day trial", international format (`+92…`). Unset or invalid: the page shows only the callback form |
| `platform.billing_settings.trial_days / trial_credits` | 14 / 2,500 (migration 0050). Changing them is a new migration |

Approving a trial:
1. Staff console → Trial requests.
2. Call the person back and press "Mark as called".
3. The person signs up with their email.
4. A Super Admin, with a security-key step-up, enters that email and approves.

Approval is refused for these cases:
- the person already had a trial;
- the workspace already has a trial or plan;
- the request was rejected;
- no account uses that email.
