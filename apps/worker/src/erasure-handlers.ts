import type { Eraser } from "../../api/src/modules/creators/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

function str(data: JobData, key: string): string {
  const v = data.payload[key];
  if (typeof v !== "string") throw new Error(`${data.eventType} without ${key}`);
  return v;
}

export function erasureHandlers(o: { eraser: Pick<Eraser, "erase" | "clearOldEmails"> }): HandlerRegistry {
  return {
    "erasure.creator_requested": async (data, { logger }) => {
      const id = str(data, "removalRequestId");
      await o.eraser.erase(id);
      logger.info({ removalRequestId: id }, "creator erased");
    },
    "system.purge_removal_emails": async (_d, { logger }) => {
      logger.info({ cleared: await o.eraser.clearOldEmails() }, "old removal-request emails cleared");
    },
  };
}
