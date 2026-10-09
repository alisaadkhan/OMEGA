import { ProviderError, type SpendGuard } from "./types";

/** Spec §4: before each Apify run, this calendar month's recorded Apify spend must be below the budget. */
export function createBudgetGuard(o: { spentSince: (since: Date) => Promise<number>; budgetUsd: number; now?: () => Date }): SpendGuard {
  return {
    async assertWithinBudget() {
      const t = (o.now ?? (() => new Date()))();
      const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const spent = await o.spentSince(monthStart);
      if (spent >= o.budgetUsd) throw new ProviderError(false, "spend_cap", `Monthly Apify budget of $${o.budgetUsd} reached ($${spent.toFixed(4)} spent)`);
    },
  };
}
