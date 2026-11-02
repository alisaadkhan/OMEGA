import { sql } from "drizzle-orm";
import { recordWorkerHeartbeat, type Db } from "@mushin/db";
import type { HandlerRegistry } from "./dispatcher";

export function defaultHandlers(db: Db, o: { reconcileProviderRuns?: () => Promise<void>; checkProviders?: () => Promise<unknown> } = {}): HandlerRegistry {
  return {
    // Audit SRCH-04: paid provider runs left open by a crash or deploy are settled (and aborted past their deadline).
    "system.reconcile_provider_runs": async () => {
      await o.reconcileProviderRuns?.();
    },
    // Hourly: what is configured and the quota providers report (migration 0055); shown and alerted in the staff console.
    "system.provider_status": async () => {
      await o.checkProviders?.();
    },
    "system.heartbeat": async () => {
      await db.withSystem((tx) => recordWorkerHeartbeat(tx));
    },
    "system.ping": async (data, { logger }) => {
      logger.info({ payload: data.payload }, "system.ping handled");
    },
    "system.purge_expired": async (_data, { logger }) => {
      const deleted = await db.withSystem((tx) =>
        tx.execute<{ n: number }>(sql`with d as (delete from platform.idempotency_keys where expires_at < now() returning 1) select count(*)::int as n from d`),
      );
      logger.info({ deleted: deleted[0]?.n ?? 0 }, "purged expired idempotency keys");
      const counters = await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select platform.rate_limit_purge() as n`));
      logger.info({ deleted: counters[0]?.n ?? 0 }, "purged old rate-limit windows");
      const exports = await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select platform.purge_expired_exports() as n`));
      logger.info({ purged: exports[0]?.n ?? 0 }, "removed expired data export files");
    },
  };
}
