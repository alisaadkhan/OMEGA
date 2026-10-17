# Verification log — what was actually executed

Audit date: 2026-10-16 (Asia/Karachi). Auditor: Claude (independent audit session). Every claim in this pack that is
marked **[ran]** traces to an entry here. **[code]** = source read; **[doc]** = a written record not re-executed;
**[web]** = external source (see `D_RESEARCH_REPORT.md`).

## 1. Repository state [ran]

| Item | Value |
|---|---|
| Archive | `MUSHIN_1.zip` (198 MB), extracted read-only; analysis on a sanitised copy |
| Branch / HEAD | `master` @ `1398cee` (2026-10-16 16:23 +05:00), 224 commits |
| Remote | `origin` is a **local git bundle file** (`D:/New folder (2)/New folder/mushin.bundle`), not a hosted repository. `origin/master` @ `1b0cffc` (2026-10-10); local master is **84 commits ahead**. There is no hosted remote: the full history exists only on the developer's machine and in this archive |
| Other branch | `team-privacy` @ `12302d0` — already contained in master (merged via `a9f7581`/fast-forward) |
| Working tree | Untracked only: `docs/readiness/MUSHIN_ACTUAL_IMPLEMENTATION_AND_READINESS_REPORT.md` (14 Oct, audits `19ec505`, now stale), `supabase/` (CLI state incl. `.temp/start-secrets`), `.claude-flow/`. No stash. No modified tracked files. |
| Ignored but present in archive | `.env` (populated), `.env.meilisearch`, `frontend.zip` (75 MB, 68,393 files, 12 Oct snapshot), Windows `node_modules` |
| Migrations | 37 forward-only SQL files `0001_foundation` … `0037_creator_eligibility` |
| Tracked files | 639 |
| API routes | 116 route registrations in non-test source (customer `/v1/**`, staff `/admin/v1/**`, `/webhooks/paddle`, health, mock checkout) |

**Does the archive match the reported tested commit?** The progress record (`docs/readiness/progress.md`, last commit
`1398cee`) reports "verify 847 passed, 7 skipped" on master. HEAD is `1398cee`, a docs-only commit on top of `fa8c437`
(staff eligibility card) — the reported verification and this archive are the same code. The 14 Oct untracked report
audits `19ec505` and is **stale**: 45 commits later (team/privacy, Super Admin, WebAuthn, approvals, Postgres rate limits,
eligibility, deadline, LLM cap) supersede many of its "absent" findings.

## 2. Environment used for re-execution [ran]

- Sanitised copy: `.env`, `.env.meilisearch`, `supabase/`, `frontend.zip`, `.claude-flow`, `node_modules` excluded, so no
  credential could be loaded and no remote service could be reached.
- Node v22.22.0, npm 10.9.4 (repo requires ≥ 22.12; CI uses 24).
- PostgreSQL **16.15** local disposable cluster on `localhost:54330`, database `mushin_test` (repo/CI target is 17 — a
  version difference worth noting; all migrations applied cleanly on 16).
- Meilisearch 1.55.0 local binary on `127.0.0.1:7700` (throwaway master key, test indexes only).
- `LLM_MONTHLY_BUDGET_USD=0` (blocks every hosted-LLM call), no provider keys set.
- Fresh `npm ci` (root) and `npm ci --prefix frontend`.

## 3. Commands and results [ran]

| # | Command | Result | Time |
|---|---|---|---|
| 1 | `npm run lint` | **pass** (exit 0) | 14 s |
| 2 | `npm run typecheck` | **pass** | 21 s |
| 3 | `npm run boundaries` | **pass** — "no dependency violations found (366 modules, 1512 dependencies cruised)" | 4 s |
| 4 | `npx vitest run` (unit + int) with `TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_test`, local Meilisearch | **847 passed, 4 skipped, 1 suite FAILED** (113 files: 108 passed, 4 skipped, 1 failed) — unit 426 passed; integration 421 passed + 4 skipped | 5 m 03 s |
| 5 | `npx tsc --noEmit -p frontend/tsconfig.json` | **pass** | 24 s |
| 6 | `npm --prefix frontend run build` (placeholder `VITE_*`) | **pass** — one JS chunk 1,127 kB (311 kB gzip), CSS 145 kB; Rollup chunk-size warning | 11 s |
| 7 | `node --import tsx scripts/check-bundle-secrets.ts frontend/dist` | **pass** — "no server setting names, secret key formats, privileged JWTs or source maps" | <1 s |
| 8 | SQL catalogue checks on the migrated DB (RLS, roles, grants, FK actions) | see §5 | — |
| 9 | Evaluation packet analysis (`audit-scripts/eval_stats.py`, read-only) | see `F_SEARCH_QUALITY_AND_EVALUATION.md` §4 | — |

### The failing suite (finding OPS-01)

`packages/integrations/src/scrapers/scrapers.live.int.test.ts` is meant to be skipped unless `LIVE_SCRAPE_TESTS=1`, but it
calls `loadWorkerConfig(process.env)` inside the `describe.skipIf(...)` callback, which runs at collection time. Without
`DATABASE_URL`, `DIRECT_URL` and `DATA_ENCRYPTION_KEY` the suite throws `ConfigError` and vitest exits 1. The developer's
"847 passed, 7 skipped" was produced with a populated `.env` (the 3 tests of this suite were then collected and skipped:
847 + 4 + 3 = the same 854). **`.github/workflows/ci.yml` sets none of those variables, so the prepared CI would fail on
its first run.** No product behaviour is affected; release engineering is.

The reproduced pass count (847) equals the reported one: the claim "847 passed" is **verified**; "7 skipped" is
explained; "0 failed" is **true only with a developer `.env`**.

## 4. What could not be executed, and why

| Check | Reason | What would unblock it |
|---|---|---|
| Customer browser E2E (`scripts/e2e-customer/run.sh`, reported 3 × 102/102) | Rebuilds its DB from `mushin_e2e_template`, cloned from the developer's local `mushin_local` catalogue (21 real creators), which is **not in the repository** | A committed, licence-safe fixture catalogue + a seed script; or the template as a dump (not containing YouTube API data older than 30 days) |
| Staff browser E2E (reported 3 × 31/31) | Same template dependency | Same |
| `scripts/search-eval/freeze-check.ts` | Requires loading the evaluation corpus (YouTube API data) into another database — would create a further copy of retention-bound data. Deliberately not run | Run by the owner's machine where the copy already exists |
| Real Supabase Auth, Paddle, Resend, Serper, Apify, YouTube, Groq/Ollama | Prohibited (paid/remote/external state) and no credentials used | Owner authorisation + test accounts |
| Load test at staging scale, restore drill on hosted DB, penetration test | No hosted environment exists | Staging environment |
| Manual keyboard / screen-reader review | No browser session against a running app with data (template missing) | As E2E |

## 5. Database catalogue checks [ran]

- `wp` schema: **28 tables, 28 with RLS enabled and forced**. Policies key on `platform.current_workspace_id()` (set
  per transaction with `set_config(..., true)` after `set local role mushin_app|mushin_worker`).
- `gcp` schema (shared creator plane): 11 tables, no RLS; `mushin_app` has **SELECT only** on 7 of them and **no grant at
  all on `gcp.creator_contacts`** (contacts reachable only via security-definer reveal path) — consistent with CONTACT-001.
- `staff` schema: no grants to `mushin_app`. `mushin_worker`: `staff.audit_log` INSERT/SELECT only (append-only by grant),
  `staff.approvals` INSERT/SELECT/UPDATE, `staff.staff_users` INSERT/SELECT/UPDATE.
- `wp.credit_ledger`: INSERT/SELECT only for runtime roles (append-only by grant).
- Roles `mushin_app`, `mushin_worker`: not superuser, no BYPASSRLS, no login (assumed via `SET ROLE`).
- FK delete actions: `wp.credit_ledger`, `wp.credit_lots`, `wp.payments`, `wp.subscriptions` → `wp.workspaces` are all
  **ON DELETE CASCADE** (finding BIL-05: a hard delete of a workspace row would destroy financial history; the app's
  erase path soft-deletes, but nothing in the schema prevents a hard delete).
- `wp.contact_reveals` columns: `workspace_id, creator_id, revealed_by, ledger_reservation_id, created_at` — no contact
  value, so the workspace export does not leak revealed values (claim verified).

## 6. Secret-bearing files in the uploaded archive [ran — names only, values never printed]

`.env` (populated): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, **`SUPABASE_SERVICE_ROLE_KEY`**, **`DATABASE_URL`**, **`DIRECT_URL`**
(remote Supabase host and pooler), `TEST_DATABASE_URL` (remote pooler — refused by the test guard, good),
`JWT_ISSUER/AUDIENCE/JWKS_URI`, `MEILISEARCH_HOST/API_KEY/SEARCH_KEY` (Meilisearch Cloud), **`SERPER_API_KEY`**,
**`APIFY_TOKEN`**, **`YOUTUBE_API_KEY`**, **`UPSTASH_REDIS_REST_URL/TOKEN`**, **`HUGGINGFACE_API_KEY`**, `WORKER_SECRET`,
**`GROQ_API_KEY`**, **`OLLAMA_API_KEY`**, `RESEND_API_KEY`, **`DATA_ENCRYPTION_KEY`**, **`STAFF_JWT_SECRET`**,
`MOCK_PADDLE_WEBHOOK_SECRET`, `SEED_TEST_EMAIL/PASSWORD`, `MEILISEARCH_TEST_KEY`, `VITE_SUPABASE_*`.
Paddle, Sentry, AWS/SQS, Vercel, PostHog: empty.

`supabase/.temp/start-secrets/supabase_edge_runtime_MUSHIN/env/docker.env`: Supabase local-stack variables including
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_INTERNAL_JWT_SECRET`, `SUPABASE_INTERNAL_SECRET_KEY` (local-stack values; lower
risk if the local stack is never exposed, but still secrets).

Configuration inconsistency observed: `SUPABASE_URL` and `JWKS_URI` name **two different Supabase project references**,
so tokens from one project would be verified against the other project's keys (finding ARCH-07).

## 7. Evaluation data handling

Read-only counting of CSV rows in `eval-data/packets` and `eval-data/kits`. Nothing was modified, regenerated or
deleted. Note for the owner's deletion inventory: **the uploaded `MUSHIN_1.zip` and its extraction in this audit session
are additional copies of the YouTube API evaluation data** and must be listed in `youtube-eval-data-inventory.md`
(this session's container is ephemeral and is reclaimed after inactivity; the zip upload itself must be removed by the
owner from wherever else it was shared).
