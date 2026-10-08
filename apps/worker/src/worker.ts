import type { PgBoss } from "pg-boss";
import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import { createDispatcher, type HandlerRegistry, type JobData } from "./dispatcher";
import { QUEUES } from "./queues";
import { createOutboxRelay } from "./relay";
import { SCHEDULES } from "./schedules";

export async function startWorker(o: { db: Db; boss: PgBoss; logger: Logger; handlers: HandlerRegistry }) {
  const dispatch = createDispatcher(o.handlers, o.logger);
  for (const q of QUEUES) {
    await o.boss.work<JobData>(q.name, { localConcurrency: q.concurrency, batchSize: 1 }, async (jobs) => {
      await dispatch(jobs.map((j) => ({ id: j.id, data: j.data })));
    });
  }
  // Older builds created a key-less schedule on "system"; keyed schedules replace it.
  await o.boss.unschedule("system");
  for (const s of SCHEDULES) await o.boss.schedule(s.queue, s.cron, s.data, { key: s.key });

  const relay = createOutboxRelay({
    db: o.db,
    logger: o.logger,
    publish: async (queue, data, id) => {
      await o.boss.send(queue, data, { id });
    },
  });
  await relay.start();

  return {
    async stop() {
      await relay.stop();
      for (const q of QUEUES) await o.boss.offWork(q.name);
    },
  };
}
