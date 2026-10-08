import { Redis } from "@upstash/redis";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createPayments } from "@mushin/integrations";
import { createBillingService, createRedisAccessCache, noAccessCache } from "../../api/src/modules/billing/index";
import { billingHandlers, notifyHandlers } from "./billing-handlers";
import { startBoss } from "./boss";
import { defaultHandlers } from "./handlers";
import { startWorker } from "./worker";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "worker" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.directUrl, { max: 5, applicationName: "mushin-worker", caPem: config.databaseCaPem });
const boss = await startBoss(config.directUrl, logger, config.databaseCaPem);
const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const cache = config.upstash ? createRedisAccessCache(new Redis({ url: config.upstash.url, token: config.upstash.token }), logger) : noAccessCache;
const billing = createBillingService({ db, payments, cache, logger });
const worker = await startWorker({
  db,
  boss,
  logger,
  handlers: { ...defaultHandlers(db), ...billingHandlers(billing), ...notifyHandlers() },
});
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
