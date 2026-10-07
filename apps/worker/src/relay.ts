import type { Logger } from "@mushin/core";
import { claimUnpublished, markFailed, markPublished, type Db, type OutboxRow } from "@mushin/db";
import type { JobData } from "./dispatcher";
import { queueFor, type QueueName } from "./queues";

export type Publish = (queue: QueueName, data: JobData, id: string) => Promise<void>;

const toJobData = (r: OutboxRow): JobData => ({
  eventId: r.id,
  eventType: r.eventType,
  aggregateType: r.aggregateType,
  aggregateId: r.aggregateId,
  workspaceId: r.workspaceId,
  requestId: r.requestId,
  payload: r.payload,
});

export function createOutboxRelay(o: { db: Db; publish: Publish; logger: Logger; batchSize?: number }) {
  const batchSize = o.batchSize ?? 50;
  let draining = false;
  let timer: NodeJS.Timeout | undefined;
  let unlisten: (() => Promise<void>) | undefined;

  async function drainOnce(): Promise<number> {
    if (draining) return 0;
    draining = true;
    try {
      return await o.db.withSystem(async (tx) => {
        const rows = await claimUnpublished(tx, batchSize);
        for (const row of rows) {
          try {
            await o.publish(queueFor(row.eventType), toJobData(row), row.id);
            await markPublished(tx, row.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await markFailed(tx, row.id, message);
            o.logger.error({ err, eventId: row.id, eventType: row.eventType }, "outbox publish failed");
          }
        }
        return rows.length;
      });
    } finally {
      draining = false;
    }
  }

  const tick = () => {
    drainOnce().catch((err: unknown) => o.logger.error({ err }, "outbox drain failed"));
  };

  return {
    drainOnce,
    async start() {
      unlisten = await o.db.listen("mushin_outbox", tick);
      timer = setInterval(tick, 1000);
      tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      await unlisten?.();
    },
  };
}
