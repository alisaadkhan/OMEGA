/**
 * Combined provider budget for the catalogue build (owner authorisation 2026-10-20: USD 25 in total). Before every paid
 * request a worker reserves a worst-case cost; under one advisory lock the gate refuses when
 *   recorded spend of ALL providers since `since` (platform.provider_calls) + open reservations + this request > cap.
 * Every worker process shares the same database, so the cap is combined, not per worker, and a refused request is never
 * sent. Reservations are released once the call has been recorded; a crashed worker's reservation expires after its lease.
 * The ledger lives in its own `catalog_build` schema in the catalogue database (tooling state, never loaded to staging),
 * reached through the build's owner connection.
 */
import type postgres from "postgres";

export class BudgetExhausted extends Error {
  constructor(readonly detail: { cap: number; spent: number; open: number; requested: number }) {
    super(`catalogue build budget reached: spent ${detail.spent.toFixed(4)} + in flight ${detail.open.toFixed(4)} + ${detail.requested} > cap ${detail.cap} USD`);
    this.name = "BudgetExhausted";
  }
}

export type BudgetGate = {
  /** Runs `call` only if `estimateUsd` still fits under the cap; otherwise throws BudgetExhausted without calling. */
  guard<T>(estimateUsd: number, call: () => Promise<T>): Promise<T>;
  status(): Promise<{ cap: number; spent: number; open: number }>;
};

const LEASE_SECONDS = 15 * 60;

export async function createBudgetGate(sql: postgres.Sql, o: { capUsd: number; since: Date }): Promise<BudgetGate> {
  await sql`create schema if not exists catalog_build`;
  await sql`create table if not exists catalog_build.spend_reservations (
    id bigserial primary key, amount numeric(12, 6) not null check (amount >= 0),
    created_at timestamptz not null default now(), expires_at timestamptz not null, released_at timestamptz)`;
  const totals = async (tx: postgres.TransactionSql | postgres.Sql) => {
    const [s] = await tx<{ v: string }[]>`select coalesce(sum(cost_usd), 0)::text v from platform.provider_calls where created_at >= ${o.since.toISOString()}::timestamptz`;
    const [r] = await tx<{ v: string }[]>`select coalesce(sum(amount), 0)::text v from catalog_build.spend_reservations where released_at is null and expires_at > now()`;
    return { spent: Number(s?.v ?? 0), open: Number(r?.v ?? 0) };
  };
  return {
    async guard(estimateUsd, call) {
      if (estimateUsd <= 0) return call();
      const id = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('catalog-build-budget', 0))`;
        const t = await totals(tx);
        if (t.spent + t.open + estimateUsd > o.capUsd + 1e-9) throw new BudgetExhausted({ cap: o.capUsd, spent: t.spent, open: t.open, requested: estimateUsd });
        const [row] = await tx<{ id: string }[]>`insert into catalog_build.spend_reservations (amount, expires_at) values (${estimateUsd}, now() + make_interval(secs => ${LEASE_SECONDS})) returning id::text`;
        return row?.id ?? "";
      });
      try {
        return await call();
      } finally {
        // The call's real cost is in provider_calls by now (adapters record before returning); free the estimate.
        await sql`update catalog_build.spend_reservations set released_at = now() where id = ${id}::bigint`;
      }
    },
    async status() {
      return { cap: o.capUsd, ...(await totals(sql)) };
    },
  };
}
