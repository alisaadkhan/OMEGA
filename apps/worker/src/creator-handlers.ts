import type { CreatorIndexer, SummaryWriter } from "../../api/src/modules/creators/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

function creatorIdOf(data: JobData): string {
  const id = data.payload["creatorId"];
  if (typeof id !== "string") throw new Error(`${data.eventType} without creatorId`);
  return id;
}

export function creatorHandlers(o: { indexer: Pick<CreatorIndexer, "sync" | "reconcile">; summaries: Pick<SummaryWriter, "generate">; expireYoutube?: () => Promise<string[]>; sweep?: () => Promise<unknown> }): HandlerRegistry {
  return {
    "creator.changed": async (data) => {
      await o.indexer.sync([creatorIdOf(data)]);
    },
    "creator.summary_requested": async (data, { logger }) => {
      const creatorId = creatorIdOf(data);
      logger.info({ creatorId, result: await o.summaries.generate(creatorId) }, "creator summary");
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
