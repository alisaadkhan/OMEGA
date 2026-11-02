import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import type { EnrichResult } from "./enrichment/pipeline";
import type { CreatorPlatform } from "./rules";

/**
 * Scheduled YouTube refresh (owner design: a 20-day target inside the 30-day YouTube API Services limit, Developer
 * Policies III.E.4). Runs daily before the retention job:
 *   - due: YouTube profiles whose stored API data is REFRESH_AFTER_DAYS or more old (oldest first, at most `batch`), still
 *     inside the 30-day limit, whatever their eligibility (retention applies to every row).
 *   - a successful refresh saves new data and moves last_scraped_at, which resets the clock; a failure moves nothing, so
 *     the profile is due again the next day (up to ten daily attempts before day 30).
 *   - what is still unrefreshed on day 30 is cleared by the retention job (platform.expire_youtube_api_data), and the
 *     search projection follows (creator.changed after a refresh, indexer.sync after retention).
 * It never runs without YouTube API access (YOUTUBE_API_CALLS=on and a key): the worker then skips it.
 */
export const REFRESH_AFTER_DAYS = 20;
export const RETENTION_DAYS = 30;
/** Profiles this close to the 30-day limit are reported so staff can act before data is cleared. */
export const DEADLINE_WARNING_DAYS = 3;

export type RefreshKnown = (target: { platform: CreatorPlatform; handle: string; canonicalUrl: string }) => Promise<EnrichResult>;
export type YoutubeRefreshReport = { due: number; attempted: number; refreshed: number; failed: number; unavailable: number; nearDeadline: number };

export async function refreshDueYoutube(o: { db: Db; refresh: RefreshKnown; batch?: number; now?: () => Date; onError?: (err: unknown, canonicalUrl: string) => void }): Promise<YoutubeRefreshReport> {
  const now = (o.now ?? (() => new Date()))();
  const due = await o.db.withSystem((tx) =>
    tx.execute<{ canonical_url: string }>(sql`
      select p.canonical_url from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
      where p.platform = 'youtube' and c.status = 'active'
        and coalesce(p.last_scraped_at, p.created_at) <= ${now.toISOString()}::timestamptz - make_interval(days => ${REFRESH_AFTER_DAYS})
        and coalesce(p.last_scraped_at, p.created_at) > ${now.toISOString()}::timestamptz - make_interval(days => ${RETENTION_DAYS})
        and p.followers is not null
      order by coalesce(p.last_scraped_at, p.created_at)
      limit ${o.batch ?? 500}`),
  );
  const report: YoutubeRefreshReport = { due: due.length, attempted: 0, refreshed: 0, failed: 0, unavailable: 0, nearDeadline: 0 };
  for (const r of due) {
    report.attempted++;
    try {
      const handle = decodeURIComponent(new URL(r.canonical_url).pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/^@/, "");
      const out = await o.refresh({ platform: "youtube", handle, canonicalUrl: r.canonical_url });
      if (out.kind === "saved" || out.kind === "reused") report.refreshed++;
      else report.unavailable++;
    } catch (err) {
      report.failed++;
      o.onError?.(err, r.canonical_url);
    }
  }
  const [near] = await o.db.withSystem((tx) =>
    tx.execute<{ n: number }>(sql`
      select count(*)::int n from gcp.creator_profiles p
      where p.platform = 'youtube' and p.followers is not null
        and coalesce(p.last_scraped_at, p.created_at) <= ${now.toISOString()}::timestamptz - make_interval(days => ${RETENTION_DAYS - DEADLINE_WARNING_DAYS})`),
  );
  report.nearDeadline = near?.n ?? 0;
  return report;
}
