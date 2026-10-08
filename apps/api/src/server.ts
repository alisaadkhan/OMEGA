import { Redis } from "@upstash/redis";
import { createLogger, loadApiConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createPayments } from "@mushin/integrations";
import { buildApp } from "./app";
import { createCustomerGuard } from "./auth/customer-guard";
import { createCustomerTokenVerifier, remoteJwks } from "./auth/customer-token";
import type { Guards, ReadinessCheck } from "./http/types";
import { createBillingModule, createBillingService, createRedisAccessCache, noAccessCache } from "./modules/billing";
import { createIdentityModule } from "./modules/identity";
import { createPlatformModule } from "./modules/platform";
import { createStaffModule, createStaffTokens } from "./modules/staff";
import { MemoryRateLimiter } from "./rate-limit/memory";
import { ipRateLimitHook } from "./rate-limit/plugin";
import { bucketsFromConfig, type RateLimiter } from "./rate-limit/types";
import { createUpstashRateLimiter } from "./rate-limit/upstash";

const config = loadApiConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "api" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 10, applicationName: "mushin-api", caPem: config.databaseCaPem });

const buckets = bucketsFromConfig(config.rateLimit);
const readiness: ReadinessCheck[] = [{ name: "database", check: () => db.ping() }];
let limiter: RateLimiter;
if (config.rateLimit.upstash) {
  const upstash = createUpstashRateLimiter(config.rateLimit.upstash, buckets, logger);
  limiter = upstash.limiter;
  readiness.push({ name: "redis", check: () => upstash.ping() });
} else {
  logger.warn("UPSTASH_REDIS_REST_URL/TOKEN not set: using the in-memory rate limiter");
  limiter = new MemoryRateLimiter(buckets);
  readiness.push({ name: "redis", check: async () => "skipped" });
}

const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const accessCache = config.rateLimit.upstash
  ? createRedisAccessCache(new Redis({ url: config.rateLimit.upstash.url, token: config.rateLimit.upstash.token }), logger)
  : noAccessCache;
const billing = createBillingService({ db, payments, cache: accessCache, logger });
const identity = createIdentityModule({ db, startTrial: billing.startTrial });
const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey });
const platform = createPlatformModule({ db, ttlHours: config.idempotencyTtlHours });
const guards: Guards = {
  customer: createCustomerGuard({
    verify: createCustomerTokenVerifier({ issuer: config.auth.issuer, audience: config.auth.audience, keys: remoteJwks(config.auth.jwksUri) }),
    resolveTenant: identity.resolveTenant,
    limiter,
  }),
  idempotent: platform.requireIdempotencyKey,
};

const app = await buildApp({
  logger,
  allowedOrigins: config.allowedOrigins,
  guards,
  modules: [platform.module, identity.module, staff.module, createBillingModule({ service: billing, payments, appUrl: config.appUrl })],
  readiness,
  onRequestHooks: [ipRateLimitHook(limiter)],
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  await app.close();
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: "0.0.0.0" });
