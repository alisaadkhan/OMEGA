import { sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { CallContext, WebResult, WebSearch, YouTubeSearch } from "@mushin/integrations";
import * as repo from "../repository";
import type { PlannedQuery } from "./queries";

const MINUTE_MS = 60_000;

/** Fresh live search results are shared for 15 minutes; a cache hit costs nothing and is not counted. */
export function createCachedSearch(o: { db: Db; web: WebSearch; youtube?: YouTubeSearch; now?: () => Date; ttlMinutes?: number }) {
  const now = o.now ?? (() => new Date());
  const ttl = (o.ttlMinutes ?? 15) * MINUTE_MS;
  return {
    async search(q: PlannedQuery, ctx?: CallContext): Promise<WebResult[]> {
      const hash = sha256Hex(`${q.country}|${q.hl}|${q.num}|${q.query}`);
      const hit = await o.db.withSystem((tx) => repo.cachedSearch(tx, hash, new Date(now().getTime() - ttl)));
      if (hit) return hit;
      const results = await o.web.search({ query: q.query, country: q.country, hl: q.hl, num: q.num, autocorrect: false, ...(ctx ? { ctx } : {}) });
      await o.db.withSystem((tx) => repo.storeSearch(tx, hash, q.query, results));
      return results;
    },
    /** YouTube Data API video search (quota only, $0), cached like web searches; absent when not configured. */
    ...(o.youtube
      ? {
          async searchYouTube(q: { query: string; lang?: string }, ctx?: CallContext): Promise<WebResult[]> {
            const hash = sha256Hex(`youtube|video|${q.lang ?? ""}|${q.query}`);
            const hit = await o.db.withSystem((tx) => repo.cachedSearch(tx, hash, new Date(now().getTime() - ttl)));
            if (hit) return hit;
            const results = await (o.youtube as YouTubeSearch).search({ query: q.query, type: "video", regionCode: "PK", ...(q.lang ? { relevanceLanguage: q.lang } : {}), max: 25, ...(ctx ? { ctx } : {}) });
            await o.db.withSystem((tx) => repo.storeSearch(tx, hash, `youtube: ${q.query}`, results));
            return results;
          },
        }
      : {}),
    purge: (): Promise<number> => o.db.withSystem((tx) => repo.purgeSearches(tx, new Date(now().getTime() - ttl))),
  };
}

export type CachedSearch = ReturnType<typeof createCachedSearch>;
