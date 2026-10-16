# ADR-0001: Target architecture for the API and background worker

Status: **Proposed**. The owner decides (audit D-01). Date: 2026-10-17. Supersedes the open conflict between "port everything to
Edge Functions + pgmq" (migration map) and "keep Node" (audit D §2).

## Decision (recommended)

Use **Supabase for what it is good at, and keep the two Node processes**:

| Concern | Choice |
|---|---|
| Database | Supabase PostgreSQL (all 44 migrations; stage 1 parity proven) |
| Sign-in | Supabase Auth (stage 3 proven locally; staff stay on the hardened custom sign-in until D-07) |
| Files | Supabase Storage (already used for raw payloads and avatars) |
| Customer/staff API | The existing Fastify API, as one container (≥ 2 instances behind the host's proxy) |
| Background work | The existing worker (pg-boss on the same PostgreSQL) as one long-running container |
| Scheduled jobs | pg-boss schedules in the worker (as today). pg_cron is not needed while the worker runs |
| Edge Functions | Not used for the API or jobs. They may later serve small webhook receivers if useful |

Simplest architecture that meets the requirements: no new runtime, nothing rewritten, and the database, Auth and Storage on a managed platform.

## Requirements that decide it (measured or specified, not assumed)

| Requirement | Evidence | Fits Edge Functions? |
|---|---|---|
| A Live Discovery job runs up to 20 minutes and spans many provider batches | Owner decision 2026-10-15 (20-min deadline); measured live run 138 s (13 Oct) | **No as one call**: wall clock is 150 s (Free) or 400 s (paid). It would need a rewrite into checkpointed steps chained through a queue |
| One Apify batch waits up to 180 s plus abort and cost read | `apify.ts` maxWait 180 s, Apify run timeout 300 s (SRCH-04) | **No**: a single wait already exceeds 150 s. On paid plans it fits only with polling split across invocations |
| CPU-heavy parsing and ranking of provider datasets and LLM output per batch | live runner, enrichment pipeline | **Risky**: CPU time is 2 s per request. It has not been measured per batch |
| Durable retries, dead letters, stuck-job sweeps, per-job deadlines, cancellation | pg-boss + outbox + sweeper + deadline (tested) | Would have to be rebuilt on pgmq (delivery inside a visibility window). Parity tests would have to be rewritten too |
| Provider spend caps and paid-run reconciliation that hold across processes | 0043 reservations + provider_runs (SRCH-04/05, tested) | Works either way: it lives in PostgreSQL |
| Tenant isolation and credit invariants | RLS + role switch, 875+ tests | Works either way; proven on Supabase PostgreSQL (stage 1: 873 passed) |
| Auth with JWKS and trusted email checks | auth-check.sh 13/13 on local Supabase | Works either way |

Official limits used: [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits) (150 s wall
clock Free / 400 s paid, 2 s CPU per request, 256 MB memory, 150 s request idle timeout) and
[Supabase Queues](https://supabase.com/docs/guides/queues) (pgmq, exactly once within a visibility window).
Checked 2026-10-17.

## Alternatives considered

1. **Port the API and worker to Edge Functions + pgmq + pg_cron.** One vendor and no containers. It means rewriting the
   live runner, enrichment, billing jobs and erasure into ≤ 150/400 s, ≤ 2 s CPU checkpointed steps. All their tests
   would be re-proven, and the current engine kept until parity. Weeks of work, with the highest risk on the
   most important flow (Brain 2) while Search is frozen for rating. **Rejected for the pilot.** It can be revisited
   per job type once a measured need exists.
2. **Everything self-hosted (PostgreSQL, Auth) on one VM.** Cheapest on paper. But MUSHIN would then run backups, point-in-time
   recovery, Auth email and security patching itself, which is the operational load the owner wants to avoid. **Rejected.**
3. **Recommended:** Supabase (DB, Auth, Storage) + two Node containers on a container host. Hosting options and cost
   estimates are in [README §hosting](README.md) and must be re-checked against vendor pricing before purchase.

## Consequences

- Migration map stages 4 (API to Edge Functions) and 5 (pg-boss to pgmq) are **closed as not planned**. Stages 1–3 are done.
  Remaining Supabase work is a hosted dev/staging project: Auth emails and SMTP, backups/PITR, network restrictions and
  the exposed-schema check (SEC-11).
- Two runtimes must be operated: the API (stateless, horizontally scalable; rate limits and spend caps are already shared
  through PostgreSQL) and the worker (one or more replicas; pg-boss and the shared caps make this safe).
- Needed before a pilot, independent of this choice: alert delivery (OPS-03), hosted backups and a restore drill
  (OPS-04), trusted proxy configuration (SEC-05), security headers on the SPA host (SEC-14).

## What would change this decision

Edge Function limits rising far above a 20-minute job; a measured need to scale the worker to zero; or the owner
preferring a single vendor over rewrite risk. Any of these reopens alternative 1 for specific job types, never all at once.
