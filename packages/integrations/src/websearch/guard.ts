import { ProviderError, type SpendGuard } from "../scrapers/types";

/** Spec §4.4: Serper stops at a number of searches per calendar month (UTC); searches in progress count too. */
export function createSearchLimitGuard(o: { countSince: (since: Date) => Promise<number>; limit: number; now?: () => Date }): SpendGuard {
  let inFlight = 0;
  return {
    async begin() {
      const t = (o.now ?? (() => new Date()))();
      const used = await o.countSince(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
      if (used + inFlight >= o.limit) throw new ProviderError(false, "spend_cap", `Monthly Serper limit of ${o.limit} searches reached (${used} used)`);
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
