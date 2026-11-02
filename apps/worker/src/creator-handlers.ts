import type { CreatorIndexer, SummaryWriter, YoutubeRefreshReport } from "../../api/src/modules/creators/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

function creatorIdOf(data: JobData): string {
  const id = data.payload["creatorId"];
  if (typeof id !== "string") throw new Error(`${data.eventType} without creatorId`);
  return id;
}

export function creatorHandlers(o: { indexer: Pick<CreatorIndexer, "sync" | "reconcile">; summaries: Pick<SummaryWriter, "generate">; expireYoutube?: () => Promise<string[]>; refreshYoutube?: (() => Promise<YoutubeRefreshReport>) | null; alert?: (e: { key: string; severity: "warning" | "critical"; message: string }) => Promise<void>; sweep?: () => Promise<unknown> }): HandlerRegistry {
  return {
    "creator.changed": async (data) => {
      await o.indexer.sync([creatorIdOf(data)]);
    },
    "creator.summary_requested": async (data, { logger }) => {
      const creatorId = creatorIdOf(data);
      logger.info({ creatorId, result: await o.summaries.generate(creatorId) }, "creator summary");
    },
    // YouTube data 20+ days old is fetched again (search follows through creator.changed); failures retry daily until
    // day 30. Off without YouTube API access: then only retention runs.
    "creator.youtube_refresh": async (_data, { logger }) => {
      if (!o.refreshYoutube) {
        logger.info("YouTube refresh skipped: YouTube API calls are off (YOUTUBE_API_CALLS) or no key is set");
        return;
      }
      const r = await o.refreshYoutube();
      logger.info({ report: r }, "YouTube refresh");
      if ((r.failed > 0 || r.nearDeadline > 0) && o.alert) {
        await o.alert({ key: "youtube_refresh", severity: r.nearDeadline > 0 ? "critical" : "warning", message: `YouTube refresh: ${r.refreshed} refreshed, ${r.failed} failed, ${r.unavailable} unavailable; ${r.nearDeadline} profiles within 3 days of the 30-day deletion. See the worker log.` });
      }
    },
    // YouTube API data not refreshed within 30 days is cleared (DATA-004); the affected search documents follow.
    "creator.youtube_retention": async (_data, { logger }) => {
      if (!o.expireYoutube) return;
      const ids = await o.expireYoutube();
      if (ids.length) await o.indexer.sync(ids);
      logger.info({ creators: ids.length }, "expired YouTube API data cleared");
    },
    // Daily lifecycle check (lifecycle.ts): reports refreshes due, unavailable profiles, removals waiting and location
    // states, and re-projects documents whose eligibility changed. It never deletes data or starts a paid refresh.
    "creator.lifecycle_sweep": async (_data, { logger }) => {
      if (o.sweep) logger.info({ report: await o.sweep() }, "lifecycle sweep");
    },
    "creator.reindex_all": async (_data, { logger }) => {
      logger.info(await o.indexer.reconcile(), "search index reconciled");
    },
  };
}
