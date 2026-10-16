import { sql } from "drizzle-orm";
import type { Db } from "./database";

/**
 * PostgreSQL side of provider safety (migration 0043; audit SRCH-04/05). Worker role only. The shapes match
 * @mushin/integrations ReservationLedger and ProviderRunStore (structural types; db does not depend on integrations).
 */
type RunStatus = "starting" | "running" | "succeeded" | "failed" | "aborted" | "unknown";
type RunRow = { run_key: string; external_run_id: string | null; status: RunStatus; cost_recorded: boolean; actor: string; job_id: string | null; workspace_id: string | null; started_at: Date };
const toRecord = (r: RunRow) => ({ runKey: r.run_key, externalRunId: r.external_run_id, status: r.status, costRecorded: r.cost_recorded });

/**
 * Monthly provider budget shared by every process: under one lock per provider, admits an amount only if recorded use
 * this month plus every open (unreleased, unexpired) reservation plus the amount fits the limit.
 */
export function createDbReservationLedger(db: Db) {
  return {
    async reserve(r: { provider: "apify" | "serper"; amount: number; limit: number; measure: "cost_usd" | "calls"; since: Date; leaseMs: number }): Promise<
      { release: () => Promise<void> } | { refused: { used: number; open: number } }
    > {
      const outcome = await db.withSystem(async (tx): Promise<{ refused: { used: number; open: number } } | { id: string }> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`provider-budget:${r.provider}`}, 0))`);
        const [used] = await tx.execute<{ v: string }>(
          r.measure === "cost_usd"
            ? sql`select coalesce(sum(cost_usd), 0)::text v from platform.provider_calls where provider = ${r.provider} and created_at >= ${r.since.toISOString()}::timestamptz`
            : sql`select count(*)::text v from platform.provider_calls where provider = ${r.provider} and created_at >= ${r.since.toISOString()}::timestamptz`,
        );
        const [open] = await tx.execute<{ v: string }>(
          sql`select coalesce(sum(amount), 0)::text v from platform.provider_reservations where provider = ${r.provider} and released_at is null and expires_at > now()`,
        );
        const u = Number(used?.v ?? 0);
        const o = Number(open?.v ?? 0);
        if (u + o + r.amount > r.limit + 1e-9) return { refused: { used: Math.round(u * 1e4) / 1e4, open: Math.round(o * 1e4) / 1e4 } };
        const [row] = await tx.execute<{ id: string }>(
          sql`insert into platform.provider_reservations (provider, amount, expires_at) values (${r.provider}, ${r.amount}, now() + make_interval(secs => ${r.leaseMs / 1000})) returning id`,
        );
        return { id: row?.id ?? "" };
      });
      if ("refused" in outcome) return outcome;
      return {
        release: async () => {
          await db.withSystem((tx) => tx.execute(sql`update platform.provider_reservations set released_at = now() where id = ${outcome.id} and released_at is null`));
        },
      };
    },
  };
}

/** Durable paid-run records: claimed before the provider is called, given the provider's run id before waiting. */
export function createDbProviderRunStore(db: Db) {
  return {
    async claim(r: { runKey: string; actor: string; jobId: string | null; workspaceId: string | null }) {
      return db.withSystem(async (tx) => {
        const inserted = await tx.execute<RunRow>(sql`
          insert into platform.provider_runs (provider, run_key, actor, job_id, workspace_id)
          values ('apify', ${r.runKey}, ${r.actor}, ${r.jobId}, ${r.workspaceId})
          on conflict (run_key) do nothing
          returning run_key, external_run_id, status, cost_recorded, actor, job_id, workspace_id, started_at`);
        if (inserted[0]) return { run: toRecord(inserted[0]), created: true };
        const [existing] = await tx.execute<RunRow>(sql`select run_key, external_run_id, status, cost_recorded, actor, job_id, workspace_id, started_at from platform.provider_runs where run_key = ${r.runKey}`);
        if (!existing) throw new Error("provider run vanished while being claimed");
        return { run: toRecord(existing), created: false };
      });
    },
    async attach(runKey: string, externalRunId: string) {
      await db.withSystem((tx) => tx.execute(sql`update platform.provider_runs set external_run_id = ${externalRunId}, status = 'running' where run_key = ${runKey} and status in ('starting', 'running')`));
    },
    async finish(runKey: string, status: "succeeded" | "failed" | "aborted" | "unknown", costUsd: number | null) {
      await db.withSystem((tx) =>
        tx.execute(sql`update platform.provider_runs set status = ${status}, finished_at = now(), cost_usd = ${costUsd}, cost_recorded = ${costUsd !== null}
          where run_key = ${runKey} and status in ('starting', 'running')`),
      );
    },
    async open(before: Date) {
      const rows = await db.withSystem((tx) =>
        tx.execute<RunRow>(sql`select run_key, external_run_id, status, cost_recorded, actor, job_id, workspace_id, started_at from platform.provider_runs
          where status in ('starting', 'running') and started_at < ${before.toISOString()}::timestamptz order by started_at limit 200`),
      );
      return rows.map((r) => ({ ...toRecord(r), actor: r.actor, jobId: r.job_id, workspaceId: r.workspace_id, startedAt: new Date(r.started_at) }));
    },
  };
}
