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
    async begin() {
      const t = (o.now ?? (() => new Date()))();
      const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const spent = await o.spentSince(monthStart);
      // Checked and counted together after the read, so simultaneous callers each see the others' runs.
      const committed = spent + inFlight * perRun;
      if (committed >= o.budgetUsd) {
        throw new ProviderError(false, "spend_cap", `Monthly Apify budget of $${o.budgetUsd} reached ($${spent.toFixed(4)} spent, ${inFlight} run(s) in progress)`);
      }
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= 1;
      };
    },
  };
}
