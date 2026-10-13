import type { AudienceRunner } from "../../api/src/modules/audience/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

export function audienceHandlers(o: { runner: Pick<AudienceRunner, "run" | "sweepStuck"> }): HandlerRegistry {
  return {
    "audience.estimate_requested": async (data: JobData) => {
      const jobId = data.payload["jobId"];
      if (!data.workspaceId || typeof jobId !== "string") throw new Error(`${data.eventType} without a workspace or job`);
      await o.runner.run(jobId, data.workspaceId);
    },
    "system.audience_sweep": async (_d, { logger }) => {
      const n = await o.runner.sweepStuck();
      if (n > 0) logger.warn({ swept: n }, "stuck audience estimates failed and refunded");
    },
  };
}
