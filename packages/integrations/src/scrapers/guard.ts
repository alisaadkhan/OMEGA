import { ProviderError, type SpendGuard } from "./types";

/** Worst case for one run as configured (a TikTok profile with 6 videos is about $0.02; Instagram $0.0026). */
const DEFAULT_PER_RUN_USD = 0.05;

/**
 * Spec §4: before each Apify run, this calendar month's recorded Apify spend must be below the budget. A run's cost is
 * recorded only when it ends, so runs still in progress count at their worst case: jobs starting together cannot all
 * pass just under the budget. The count is per process; MUSHIN runs one worker, and Apify's own monthly usage limit is
 * the hard stop behind this.
 */
export function createBudgetGuard(o: { spentSince: (since: Date) => Promise<number>; budgetUsd: number; perRunUsd?: number; now?: () => Date }): SpendGuard {
  const perRun = o.perRunUsd ?? DEFAULT_PER_RUN_USD;
  let inFlight = 0;
  return {
    async begin(units = 1) {
      const t = (o.now ?? (() => new Date()))();
      const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const spent = await o.spentSince(monthStart);
      // Checked and counted together after the read, so simultaneous callers each see the others' runs.
      // The new work counts too: a batch is admitted only if all of it fits under the budget.
      const committed = spent + (inFlight + units) * perRun;
      if (committed > o.budgetUsd + 1e-9) {
        throw new ProviderError(false, "spend_cap", `Monthly Apify budget of $${o.budgetUsd} reached ($${spent.toFixed(4)} spent, ${inFlight} run(s) in progress)`);
      }
      inFlight += units;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= units;
      };
    },
  };
}

/**
 * Where reservations live (audit SRCH-05): checked and written atomically for all processes (PostgreSQL in production,
 * packages/db createDbReservationLedger). `reserve` admits the amount only if this month's recorded use plus every open
 * reservation plus the amount stays within `limit`, and returns a release function; otherwise null.
 */
export type ReservationLedger = {
  reserve(r: { provider: "apify" | "serper"; amount: number; limit: number; measure: "cost_usd" | "calls"; since: Date; leaseMs: number }): Promise<
    { release: () => Promise<void> } | { refused: { used: number; open: number } }
  >;
};

/** Leases outlive the longest run (180 s wait + abort) by a wide margin; a crashed process frees its share after this. */
export const RESERVATION_LEASE_MS = 30 * 60_000;

/**
 * Monthly provider cap shared by every process (audit SRCH-05): Apify in USD (worst case per run, as before) or Serper
 * in searches. Same contract as the per-process guards it replaces; fails closed when the ledger cannot be reached.
 */
export function createSharedSpendGuard(o: { ledger: ReservationLedger; provider: "apify" | "serper"; limit: number; perUnit: number; label: string; now?: () => Date }): SpendGuard {
  return {
    async begin(units = 1) {
      const t = (o.now ?? (() => new Date()))();
      const since = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const r = await o.ledger.reserve({ provider: o.provider, amount: units * o.perUnit, limit: o.limit, measure: o.provider === "apify" ? "cost_usd" : "calls", since, leaseMs: RESERVATION_LEASE_MS });
      if ("refused" in r) {
        throw new ProviderError(false, "spend_cap", `Monthly ${o.label} limit of ${o.limit} reached (${r.refused.used} used, ${r.refused.open} in progress)`);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        void r.release();
      };
    },
  };
}
