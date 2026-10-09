import type { CreatorIndexer, SummaryWriter } from "../../api/src/modules/creators/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

function creatorIdOf(data: JobData): string {
  const id = data.payload["creatorId"];
  if (typeof id !== "string") throw new Error(`${data.eventType} without creatorId`);
  return id;
}

export function creatorHandlers(o: { indexer: Pick<CreatorIndexer, "sync" | "reconcile">; summaries: Pick<SummaryWriter, "generate"> }): HandlerRegistry {
  return {
    "creator.changed": async (data) => {
      await o.indexer.sync([creatorIdOf(data)]);
    },
    "creator.summary_requested": async (data, { logger }) => {
      const creatorId = creatorIdOf(data);
      logger.info({ creatorId, result: await o.summaries.generate(creatorId) }, "creator summary");
    },
    "creator.reindex_all": async (_data, { logger }) => {
      logger.info(await o.indexer.reconcile(), "search index reconciled");
    },
  };
}
