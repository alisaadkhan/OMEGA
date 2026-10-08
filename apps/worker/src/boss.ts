import { PgBoss } from "pg-boss";
import type { Logger } from "@mushin/core";
import { tlsOptions } from "@mushin/db";
import { DEAD_LETTER_QUEUE, QUEUE_OPTIONS, QUEUES } from "./queues";

export async function startBoss(url: string, logger: Logger, caPem: string | null): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: url,
    schema: "pgboss",
    application_name: "mushin-worker",
    ssl: tlsOptions(caPem),
    max: 3,
  });
  boss.on("error", (err: unknown) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  if (!(await boss.getQueue(DEAD_LETTER_QUEUE))) await boss.createQueue(DEAD_LETTER_QUEUE);
  for (const q of QUEUES) {
    if (!(await boss.getQueue(q.name))) await boss.createQueue(q.name, { ...QUEUE_OPTIONS });
  }
  return boss;
}
