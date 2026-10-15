import { Redis } from "@upstash/redis";
import { createLogger, loadApiConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, providerPaused, providerSpendSince, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createLlm, createPayments, createSearchIndex, pausableLlm } from "@mushin/integrations";
import { buildApp } from "./app";
import { createCustomerGuard } from "./auth/customer-guard";
import { createCustomerTokenVerifier, remoteJwks } from "./auth/customer-token";
import type { Guards, ReadinessCheck } from "./http/types";
import { createAudienceModule, createAudienceService } from "./modules/audience";
import { createBillingModule, createBillingService, createRedisAccessCache, noAccessCache } from "./modules/billing";
import { createCreatorsModule, createCreatorsService, createPostgresCatalogSearch, createRemovalService } from "./modules/creators";
import { createDiscoveryModule, createDiscoveryService } from "./modules/discovery";
import { createActivityModule, createActivityService } from "./modules/activity";
import { createOpsModule } from "./modules/ops";
import { createSupportModule, createSupportService } from "./modules/support";
import { createAnalyticsModule, createAnalyticsService } from "./modules/analytics";
import { createCampaignsModule, createCampaignsService } from "./modules/campaigns";
import { createIdentityModule } from "./modules/identity";
import { createListsModule, createListsService } from "./modules/lists";
import { createPlatformModule } from "./modules/platform";
import { createStaffModule, createStaffTokens, recordStaffAudit } from "./modules/staff";
import { createStaffOpsModule } from "./modules/staffops";
import { MemoryRateLimiter } from "./rate-limit/memory";
import { ipRateLimitHook } from "./rate-limit/plugin";
import { PostgresRateLimiter } from "./rate-limit/postgres";
import { bucketsFromConfig, type RateLimiter } from "./rate-limit/types";
import { createUpstashRateLimiter } from "./rate-limit/upstash";

const config = loadApiConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "api" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 10, applicationName: "mushin-api", caPem: config.databaseCaPem });

const buckets = bucketsFromConfig(config.rateLimit);
const readiness: ReadinessCheck[] = [{ name: "database", check: () => db.ping() }];
let limiter: RateLimiter;
if (config.rateLimit.store === "upstash" && config.rateLimit.upstash) {
  const upstash = createUpstashRateLimiter(config.rateLimit.upstash, buckets, logger);
  limiter = upstash.limiter;
  readiness.push({ name: "redis", check: () => upstash.ping() });
} else if (config.rateLimit.store === "memory") {
  logger.warn("RATE_LIMIT_STORE=memory: rate limits are counted per process (development only)");
  limiter = new MemoryRateLimiter(buckets);
  readiness.push({ name: "redis", check: async () => "skipped" });
} else {
  // PostgreSQL counters (the Supabase target): shared by every API process; covered by the database readiness check.
  limiter = new PostgresRateLimiter(db, buckets);
  readiness.push({ name: "redis", check: async () => "skipped" });
}

const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const accessCache = config.rateLimit.upstash
  ? createRedisAccessCache(new Redis({ url: config.rateLimit.upstash.url, token: config.rateLimit.upstash.token }), logger)
  : noAccessCache;
const billing = createBillingService({ db, payments, cache: accessCache, logger });
const searchIndex = createSearchIndex(config.search, logger);
const nativeSearch = createPostgresCatalogSearch(db);
if (config.catalogSearchBackend === "meilisearch") readiness.push({ name: "search", check: config.search ? () => searchIndex.ping() : async () => "skipped" });
// Every hosted-LLM call is checked against the monthly LLM budget (recorded Groq + Ollama spend).
const llmSpentSince = async (since: Date) => (await providerSpendSince(db, "groq", since)) + (await providerSpendSince(db, "ollama", since));
const llm = pausableLlm(createLlm(config.llm, { sink: createDbProviderCallSink(db), logger, budget: { budgetUsd: config.llmMonthlyBudgetUsd, spentSince: llmSpentSince } }), () => providerPaused(db, "llm"));
const creators = createCreatorsService({
  db,
  index: searchIndex,
  ...(config.catalogSearchBackend === "postgres" ? { nativeSearch } : { fallbackSearch: nativeSearch }),
  llm,
  billing,
  encryptionKey: config.dataEncryptionKey,
  logger,
  sourcePolicy: config.sourcePolicy,
});
const identity = createIdentityModule({ db, startTrial: billing.startTrial });
const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey, webauthn: config.webauthn });
const removals = createRemovalService({ db, encryptionKey: config.dataEncryptionKey, audit: recordStaffAudit });
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
  modules: [
    platform.module,
    identity.module,
    staff.module,
    createBillingModule({ service: billing, payments, appUrl: config.appUrl }),
    createCreatorsModule({ service: creators, limiter, removals, requireStaff: staff.requireStaff }),
    createDiscoveryModule({ service: createDiscoveryService({ db, billing, sourcePolicy: config.sourcePolicy }), limiter }),
    createListsModule({ service: createListsService({ db, sourcePolicy: config.sourcePolicy }) }),
    createCampaignsModule({ service: createCampaignsService({ db, planLimits: billing.getAccess, sourcePolicy: config.sourcePolicy }) }),
    createAnalyticsModule({ service: createAnalyticsService({ db }) }),
    createActivityModule({ service: createActivityService({ db }) }),
    createSupportModule({ service: createSupportService({ db }) }),
    createOpsModule({ db, requireStaff: staff.requireStaff }),
    createStaffOpsModule({ db, billing, requireStaff: staff.requireStaff, createStaffAccount: staff.createStaffAccount }),
    createAudienceModule({ service: createAudienceService({ db, billing, sources: config.audienceSources }), limiter }),
  ],
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
