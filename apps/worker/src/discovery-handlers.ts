import type { EnrichmentPipeline } from "../../api/src/modules/creators/index";
import type { CachedSearch, DiscoveryRunner, LiveRunner } from "../../api/src/modules/discovery/index";
import type { HandlerRegistry, JobData } from "./dispatcher";

function str(data: JobData, key: string): string {
  const v = data.payload[key];
  if (typeof v !== "string") throw new Error(`${data.eventType} without ${key}`);
  return v;
}

export function discoveryHandlers(o: {
  runner: Pick<DiscoveryRunner, "run" | "sweepStuck">;
  liveRunner: Pick<LiveRunner, "run">;
  searchCache: Pick<CachedSearch, "purge">;
  pipeline: Pick<EnrichmentPipeline, "reassess" | "purgeExpiredPayloads">;
}): HandlerRegistry {
  const runJob = (r: { run(jobId: string, workspaceId: string): Promise<void> }) => async (data: JobData) => {
    if (!data.workspaceId) throw new Error(`${data.eventType} without a workspace`);
    await r.run(str(data, "jobId"), data.workspaceId);
  };
  return {
    "discovery.requested": runJob(o.runner),
    "refresh.requested": runJob(o.runner),
    "discovery.live_requested": runJob(o.liveRunner),
    "system.purge_search_cache": async (_d, { logger }) => {
      logger.info({ purged: await o.searchCache.purge() }, "expired Google results purged");
    },
    "creator.assessment_requested": async (data, { logger }) => {
      const creatorId = str(data, "creatorId");
      logger.info({ creatorId, result: await o.pipeline.reassess(creatorId) }, "creator reassessed");
    },
    "system.discovery_sweep": async (_d, { logger }) => {
      const n = await o.runner.sweepStuck();
      if (n > 0) logger.warn({ swept: n }, "stuck creator data jobs failed and refunded");
    },
    "system.purge_raw_payloads": async (_d, { logger }) => {
      logger.info({ purged: await o.pipeline.purgeExpiredPayloads() }, "expired raw payloads purged");
    },
  };
}
