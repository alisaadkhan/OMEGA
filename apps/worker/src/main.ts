import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { startBoss } from "./boss";
import { defaultHandlers } from "./handlers";
import { startWorker } from "./worker";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "worker" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.directUrl, { max: 5, applicationName: "mushin-worker", caPem: config.databaseCaPem });
const boss = await startBoss(config.directUrl, logger, config.databaseCaPem);
const worker = await startWorker({ db, boss, logger, handlers: defaultHandlers(db) });
logger.info("worker started");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  await worker.stop();
  await boss.stop({ graceful: true, close: true });
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
