import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import type { HandlerRegistry } from "./dispatcher";

export function defaultHandlers(db: Db): HandlerRegistry {
  return {
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
    },
  };
}
