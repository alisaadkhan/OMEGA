# B — Documentation inventory and discrepancy register

## 1. Inventory of supplied material

| # | Material | Date / version | Size | Status in this audit | Authority |
|---|---|---|---|---|---|
| 1 | Original brief (`attachment.txt`) | 2026-10-16 | 230 lines | Read in full | Defines this audit |
| 2 | Authorisation brief (second `attachment.txt`) | 2026-10-16 | 426 lines | Read in full | Defines this audit |
| 3 | `MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE.zip` | "Reconciliation pass 1", 2026-10-14 | 118 files | All 25 numbered/front-matter docs read in full; contracts, CSVs, diagrams, reference SQL indexed and sampled | Candidate (not owner-approved); **older than the repository by 2 days and ~45 commits** |
| 3a | — `contracts/customer-openapi.yaml`, `staff-openapi.yaml` | 14 Oct | 42 + 16 paths | Compared at path level with the 116 implemented routes | Proposed target, not implemented shape |
| 3b | — `contracts/requirements.csv`, `traceability_matrix.csv` | 14 Oct | 68 + 68 rows | Indexed | Proposed |
| 3c | — `testing/*` (62 acceptance tests, 52 inherited, 35 unlabelled queries, 24 live-discovery matrix rows, actor checklist) | 13–14 Oct | — | Indexed; queries compared with the rating packets | Proposed |
| 3d | — `frontend/*` (24 page groups, 162 screen-state rows, page/staff specs, Figma prompt) | 14 Oct | — | Indexed; used for K | Proposed |
| 3e | — `database/*` (reference DDL 32 + 18 tables, data dictionary 466 rows, gap register) | 14 Oct | — | Indexed; **not** treated as applied schema | Proposed reference only |
| 3f | — `source_evidence/*` (original SRS v1.0, diagrams, ERD PDF, earlier Claude blueprint, 17 ADRs) | ≤ 12 Oct | 5 PDFs, 26 md | Indexed | Historical |
| 4 | `MUSHIN_1.zip` (repository) | HEAD `1398cee`, 2026-10-16 16:23 | 639 tracked files | Code read module by module; checks re-run (see `evidence/VERIFICATION_LOG.md`) | **Implementation truth** |
| 4a | — `README.md` | 14 Oct | — | Read | Partly stale (see DIS-04, -05, -12, -14) |
| 4b | — `docs/readiness/progress.md` | 16 Oct | 21 KB | Read in full | Newest owner-decision record |
| 4c | — `docs/readiness/README.md` (§0 16 Oct, §1–7 14 Oct) | mixed | 16 KB | Read in full | §1–7 stale |
| 4d | — `search-quality.md`, `youtube-eval-data-inventory.md`, `credit-economics.md`, `supabase-migration-map.md`, `customer-e2e-report.md`, `acceptance-matrix.md`, `local-setup.md`, `search-backends.md`, `traceability.csv` (65 rows) | 14–16 Oct | — | Read (key sections) | Dated records |
| 4e | — Untracked `MUSHIN_ACTUAL_IMPLEMENTATION_AND_READINESS_REPORT.md` | audits `19ec505`, 14 Oct | 40 KB | Read (sections A–C) | **Stale** (DIS-22) |
| 4f | — `docs/superpowers/specs/*` (6 design specs) and `plans/*` (5 plans, 1.3 MB) | 6–13 Oct | — | Specs sampled; plans indexed only | Historical design intent |
| 4g | — `reference_files/` SRS "Final v2" PDF (28 pp) and System Diagrams PDF (16 pp) | — | — | Indexed | Historical |
| 4h | — `eval-data/` packets, kits, recordings | 14–16 Oct | 1,050 files, 38 MB | Counted read-only | Retention-bound (delete by 12 Nov) |
| 4i | — `frontend.zip` | 12 Oct | 68,393 files | Not analysed (superseded by `frontend/`) | Historical snapshot; delete after confirming nothing unique |

**Missing material that the audit would have used:** the standalone `MUSHIN_MASTER_DOCUMENTATION_PACK` (referenced by both
the pack and the repo, never supplied); any Supabase project export, deployment evidence, Paddle/Apify account
evidence, returned ratings, or screenshots.

## 2. Source-of-truth rule used

1. Git history and executable checks establish **what exists**.
2. The newest dated owner decision (`progress.md`, 14–16 Oct) establishes **approved intent**, unless it conflicts with
   a later owner decision.
3. The reconciled pack establishes intent only where neither of the above speaks, and is otherwise **stale**.
4. Nothing is silently resolved: conflicts between owner decisions are listed as decisions (C, `I_…` §decisions).

## 3. Discrepancy register

Machine-readable copy: `registers/discrepancy_register.csv`. "Owner decision exists" = recorded in `progress.md`.

| ID | Topic | Files | What each source says | What code / git establish | Owner decision exists? | Corrective action (decider) | Priority · verification |
|---|---|---|---|---|---|---|---|
| DIS-01 | **Top-up expiry** | pack 01 §B, 11, 20 OD-001; 0005; 0030; plans.ts | Pack: unresolved, "code expires after 12 months". Repo: "top-ups never expire" | `0030_topup_credits_never_expire.sql`: expires_at nullable, top-ups granted without expiry; constraint only half-enforces (BIL-04) | **Yes** (14 Oct #4) | Mark OD-001 closed in pack; tighten constraint (dev) | P2 · engine.int + new constraint test |
| DIS-02 | **Target architecture** | pack 00, 01, 03, 19; `supabase-migration-map.md`; readiness README §0 hosting table | Pack: keep Fastify/pg-boss, do not move to Edge Functions. Migration map: "Owner direction 2026-10-14: Supabase becomes the backend (Edge Functions, pgmq, pg_cron)" | Fastify API + pg-boss worker + PostgreSQL; nothing ported | **Conflicting** owner directions on the same day | ADR choosing one (owner) — see ARCH-01 and D §2 | P1 · ADR exists, other doc marked superseded |
| DIS-03 | **Rate limiting store** | pack 01 ("keep Upstash"), pack 08 ("Postgres counters, no Redis"), progress (Postgres default, fail closed), README | Three different statements | Upstash is auto-selected whenever its variables exist; Postgres otherwise; the supplied `.env` sets Upstash | Yes (Supabase map §5: Postgres) | Make Postgres default regardless of variables; remove Upstash (dev) | P2 · config.test (SEC-06) |
| DIS-04 | **Live search (Serper) cache TTL** | pack 01/08/09 (15 min), README §4B ("7 days"), 0012 comment ("7 days (SRS §3.4)") | 15 min vs 7 days | `live/cache.ts` default `ttlMinutes = 15` | Pack rule | Fix README and add a migration comment note (dev) | P3 · grep |
| DIS-05 | **Meilisearch** | pack 01 ("no Meilisearch Cloud; optional self-hosted"), README §3 ("Meilisearch Cloud … also production"), readiness hosting ("not deployed") | Cloud vs self-hosted vs none | PostgreSQL is the default backend; `.env` points at a Meilisearch Cloud project | Pack rule + readiness | Remove Cloud project and keys; fix README (owner rotates keys) | P3 · config |
| DIS-06 | **Invitations** | pack 01, 02 §4 S2, 20 OD-011 ("absent") | Not built | Built: 0035, `identity/team.ts`, accept page; E2E reported | Yes (16 Oct: merge team-privacy) | Update pack status; fix SEC-03 | P0 (SEC-03) · team.int |
| DIS-07 | **Export / account deletion** | pack 02 §7, 13, OD-013 ("absent") | Not built | Built (0035, `identity/privacy.ts`); IdP account not deleted | Yes (merge) | Update pack; SEC-13 | P2 · staging test |
| DIS-08 | **Staff console and Super Admin** | pack 01 §C, 18 M6 ("later phase; don't build staff screens during customer E2E; Super Admin disabled") | Deferred | Built: 0033 Super Admin, approvals, provider pause, job retry/cancel, consented support access, staff E2E | Yes (15–16 Oct; parallel session) | Pack updated to "built, under review"; SEC-02/07 | P0 · new tests |
| DIS-09 | **Staff authentication** | pack 01, 13, OD-005 ("replace custom staff auth; do not extend"); progress 15 Oct #6 ("Supabase Auth target; keep hardware key") | Replace vs keep | Custom auth extended (password + TOTP + WebAuthn + approvals) | Partial: target named, timing not | Decide: keep custom with SEC-02/07 fixes for pilot, or migrate before external staff access (owner) | P0/P2 |
| DIS-10 | **Search status** | readiness README §1/§4 ("Catalog search: Complete"; "Live discovery: Complete"), progress ("Search is not accepted") | Complete vs not accepted | No ratings exist | Yes (not accepted) | Rewrite README §4 status words (dev) | P1 · doc check |
| DIS-11 | **Test totals** | README §1 661; pack/E2E 664 + 7 skipped; progress 732, 751, 775, 784, 792, 804, 826, 836, 846, 847; README §0 "835" | 12 different numbers | **Reproduced 847 passed, 4 skipped, 1 suite failed (needs .env)** at `1398cee` | — | Report totals only with commit SHA + CI run URL (dev) | P0 (OPS-01) |
| DIS-12 | **Live Discovery price** | pack 11 ("150+ credits"), README §4B ("find_new 12 + 10/30 per creator; sizes 5/10/20"), 0027 (50 base + 10/creator; sizes 5/10/15), plans.ts copy ("pay only for new creators…; nothing if none is found"), live-runner (base fee for known-only; TikTok minimum 100) | Four different rules | Code = 0027 + TikTok minimum + base fee on any visible result | Yes (14 Oct #1, #3) | Fix public copy (owner approves wording) — BIL-01 | P0 |
| DIS-13 | **Catalogue search price** | 0005 seed 0; pack 50; 0027 50; README omits | 0 vs 50 | 50 per logical search, charged on empty results | Yes (price); empty-result charging not discussed | Owner decision BIL-02 | P1 |
| DIS-14 | **Live run sizes** | README "5, 10 or 20"; 0027 "5, 10, 15 (20 kept for old quotes)" | 20 vs 15 | 5/10/15 | Yes | Fix README | P3 |
| DIS-15 | **Plan names and entitlements** | pack OD-002 ("owner decision required"); 0027 renames Explorer → Starter; plans.ts Scale 35,000 credits, Rs 24,900 | Open vs done | Starter/Growth/Scale displayed; campaign limit enforced; export/outreach not offered | Prices "owner-approved (14 Oct)"; names: not explicit | Owner confirms names and the Scale credit count in writing | P1 |
| DIS-16 | **Paid-start / add-by-URL limits** | pack 08 (50/h user, 100/h workspace for add-by-URL); readiness C5; code (20/h per user for all paid starts, 100/h workspace) | Different values and scopes | Code values | No (C5 "owner to confirm") | Owner confirms | P2 |
| DIS-17 | **Catalogue pagination** | pack 01, 08 ("cursor-only, stable") | Cursor | Opaque cursor wrapping an offset (≤ 1,000) | Pack rule | SRCH-08 | P3 |
| DIS-18 | **API path model** | OpenAPI `/workspaces/{workspaceId}/…`; code `/v1/…` + `X-Workspace-Id` header | Path vs header | Header with silent fallback (SEC-04) | No (OD-012 open) | Owner: approve header model formally (recommended, with SEC-04 fix) or plan migration | P1 |
| DIS-19 | **Audience estimates** | pack 01/10 ("disabled, never AI-estimated percentages"); README §4A ("asks the AI to … estimate the audience") | Off vs on | Audience module present, disabled unless `AUDIENCE_SOURCES`; frontend refuses `audienceCountry` filter | Yes (disabled) | Fix README sentence | P3 |
| DIS-20 | **Creator eligibility (10k)** | pack requirements: absent; repo `traceability.csv` ELIG-001 "owner to confirm 90-day count age" | Absent / pending | elig-1 enforced everywhere; 90-day rule confirmed 16 Oct | Yes | Add ELIG requirement to pack; mark confirmed in traceability | P2 |
| DIS-21 | **Repo traceability rows stale** | `docs/readiness/traceability.csv` | CREDIT-003 blocked, OPS-001 "add pause/retry/cancel", STAFF-001 "WebAuthn not built", PLAN-001 "campaign limit not built", PERF-002 "check Vercel headers" | All five superseded by code (0030; staffops actions; webauthn.ts; campaigns/service.ts:104; no host chosen) | — | Regenerate traceability from code + tests (dev) | P2 |
| DIS-22 | **Untracked 14 Oct report** | `docs/readiness/MUSHIN_ACTUAL_IMPLEMENTATION_AND_READINESS_REPORT.md` | "No Super Admin, no invitations, no LLM cap, no deadline, campaign limit not enforced" | All built since | — | Move to `docs/history/` with a "superseded by" banner, or delete (owner) | P3 |
| DIS-23 | **YouTube identifiers beyond 30 days** | pack 09/13 (30-day refresh-or-delete); progress (keep handle + URL because "obtained outside the API") | Delete vs keep | Handle/URL kept; metrics, names, avatars cleared | Legal review pending | Qualified legal review; [web] the policy lists no identifier exception | P1 (legal) |
| DIS-24 | **Rating workload numbers** | progress/README ("273 Brain 1, 207 Brain 2 rows"); search-quality §elig-1 (222 / 131; 413 per rater); "Brain 1 queries with results: 11" | Old vs new | **[ran]** current kits: 222 + 35 + 131 + 25 = 413; 273/207 are the superseded pre-eligibility packets; 11 queries return results, of which 10 have rated result rows (Q024's 204 results are behaviour-only) | — | Use only elig-1 numbers in every record | P1 · this audit F §4 |
| DIS-26 | **Who may buy / manage billing** | pack 02 §2 ("admin … subject to owner-only billing actions"), pack 01 (ledger Owner/Admin) | Owner only | `BILLING_ROLES = {owner, admin}`: Admins can purchase plans and top-ups | No | Owner confirms Admin purchasing, or restrict purchases to Owner | P1 · billing-api.int |
| DIS-25 | **Remote / CI claims** | readiness §0 ("no GitHub remote") | — | True: `origin` is a local bundle file; 84 commits only local | — | Create a private hosted remote after SEC-01 (owner) | P0 (OPS-01) |

## 4. Historical material that should be labelled, not deleted

- `source_evidence/` and `earlier_ADRs_read_only/` in the pack — already labelled read-only; keep.
- Repo `docs/superpowers/plans/*` (1.3 MB) — implementation plans of 6–9 Oct; add a one-line banner "historical plan;
  see progress.md for current state".
- `frontend/plans/*` (three planning files) — same banner.
- `frontend.zip` — delete once the owner confirms it holds nothing absent from `frontend/` (it is 75 MB of 12 Oct
  snapshot and invites confusion).
- `eval-data/kits-pre-elig1` and `packets/blind-b1`, `blind-b2` — superseded; delete in the 10 Nov purge (they are
  YouTube-retention bound).
