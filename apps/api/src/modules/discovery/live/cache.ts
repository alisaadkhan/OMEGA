import { sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { CallContext, WebResult, WebSearch } from "@mushin/integrations";
import * as repo from "../repository";
import type { PlannedQuery } from "./queries";

const DAY_MS = 86_400_000;

/** SRS §3.4: Google results are reused for 7 days, by every workspace; a cache hit costs nothing and is not counted. */
export function createCachedSearch(o: { db: Db; web: WebSearch; now?: () => Date; ttlDays?: number }) {
  const now = o.now ?? (() => new Date());
  const ttl = (o.ttlDays ?? 7) * DAY_MS;
  return {
    async search(q: PlannedQuery, ctx?: CallContext): Promise<WebResult[]> {
      const hash = sha256Hex(`${q.country}|${q.query}`);
      const hit = await o.db.withSystem((tx) => repo.cachedSearch(tx, hash, new Date(now().getTime() - ttl)));
      if (hit) return hit;
      const results = await o.web.search({ query: q.query, country: q.country, num: 10, ...(ctx ? { ctx } : {}) });
      await o.db.withSystem((tx) => repo.storeSearch(tx, hash, q.query, results));
      return results;
    },
    purge: (): Promise<number> => o.db.withSystem((tx) => repo.purgeSearches(tx, new Date(now().getTime() - ttl))),
  };
}

export type CachedSearch = ReturnType<typeof createCachedSearch>;
