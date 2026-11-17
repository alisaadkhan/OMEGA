import { readFileSync } from "node:fs";
import type { z } from "zod";
import { apiSchema, checkGemini, LLM_KEYS, sharedObject, workerSchema, type SharedValues } from "./config-schema";
import { llmFrom, type LlmProviderConfig } from "./llm-config";
import { SUPABASE_ROOT_2021_PEM } from "./supabase-ca";

export type { LlmValues } from "./config-schema";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Reads the database CA certificate (PEM). Returns null when no path is configured. */
export function readCaFile(path: string | undefined): string | null {
  if (!path) return null;
  // A file path is not bundled with a serverless function; the Supabase root is built in (security audit 2026-11-17).
  if (path === "builtin:supabase-root-2021") return SUPABASE_ROOT_2021_PEM;
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new ConfigError([`DATABASE_SSL_CA_FILE: cannot read ${path}`]);
  }
}

function clean(env: Env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === undefined || v.trim() === "" ? undefined : v.trim();
  return out;
}

function parse<S extends z.ZodType>(schema: S, env: Env): z.output<S> {
  const result = schema.safeParse(clean(env));
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

/**
 * Proxies trusted for the client address (audit SEC-05). On Vercel (VERCEL_ENV set by the platform) every request comes
 * through Vercel's edge, which overwrites X-Forwarded-For with the caller's address, so the header is trusted there when
 * nothing else is configured; otherwise every visitor would share the edge's address and one rate-limit bucket
 * (security audit 2026-11-17).
 */
export function trustedProxiesFrom(configured: string, vercelEnv: string | undefined): string[] {
  const list = configured.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 && vercelEnv) return ["0.0.0.0/0", "::/0"];
  return list.filter((s) => s !== "none");
}

export type PaymentsConfig =
  | { mode: "mock"; webhookSecret: string; appUrl: string; publicApiUrl: string }
  | {
      mode: "paddle";
      apiKey: string;
      clientToken: string;
      webhookSecret: string;
      environment: "sandbox" | "production";
      appUrl: string;
      publicApiUrl: string;
    };

function paymentsFrom(v: SharedValues): PaymentsConfig {
  const appUrl = new URL(v.APP_URL).origin;
  const publicApiUrl = v.PUBLIC_API_URL.replace(/\/+$/, "");
  if (v.PADDLE_API_KEY && v.PADDLE_CLIENT_TOKEN && v.PADDLE_WEBHOOK_SECRET) {
    return {
      mode: "paddle",
      apiKey: v.PADDLE_API_KEY,
      clientToken: v.PADDLE_CLIENT_TOKEN,
      webhookSecret: v.PADDLE_WEBHOOK_SECRET,
      environment: v.PADDLE_ENVIRONMENT,
      appUrl,
      publicApiUrl,
    };
  }
  // checkShared guarantees the mock secret outside production.
  return { mode: "mock", webhookSecret: v.MOCK_PADDLE_WEBHOOK_SECRET ?? "", appUrl, publicApiUrl };
}



/** Enrichment policy (owner instruction 2026-10-26), independent of SEARCH_PROFILE. */
export type EnrichmentPolicy = { attributePolicy: "evidence" | "legacy"; youtubeContentEvidence: boolean; youtubeDescriptionContacts: boolean; semanticNiche: boolean };

export type SearchConfig = { host: string; apiKey: string; indexPrefix: string } | null;
export type { LlmProviderConfig } from "./llm-config";

function searchFrom(v: SharedValues, key: string | undefined): SearchConfig {
  if (!v.MEILISEARCH_HOST || !key) return null;
  return { host: v.MEILISEARCH_HOST.replace(/\/+$/, ""), apiKey: key, indexPrefix: v.MEILISEARCH_INDEX_PREFIX };
}


export type ScrapingConfig = {
  apifyToken: string | null;
  instagramActor: string;
  instagramBuild: string | null;
  tiktokActor: string;
  tiktokBuild: string | null;
  /** Live discovery resolves Instagram post/reel authors with this actor; null disables it. */
  instagramPostActor: string | null;
  instagramPostBuild: string | null;
  /** Most post links resolved per live run (0 disables). */
  contentResolutionMax: number;
  /** Live discovery also searches YouTube videos through the Data API. */
  youtubeSearch: boolean;
  /** Per platform: profiles fetched per live run as a multiple of the run size while it is not filled (1 = the size). */
  extractionMultiplier: { instagram: number; youtube: number; tiktok: number };
  /** Profiles a live run processes at the same time. */
  profileConcurrency: number;
  /** Before every batch: a run's provider cost may not pass quoted max credits × revenuePerCreditUsd ÷ costToPriceRatio. */
  jobCostCap: { revenuePerCreditUsd: number; costToPriceRatio: number; profileUsd: { instagram: number; tiktok: number; youtube: number } };
  /** Before every extraction batch: no new batch once this many milliseconds have passed since the job was created. */
  jobDeadlineMs: number;
  apifyMonthlyBudgetUsd: number;
  youtubeApiKey: string | null;
  serperApiKey: string | null;
  serperMonthlySearchLimit: number;
};
export type StorageConfig = { url: string; serviceKey: string } | null;

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: LogLevel;
  port: number;
  appUrl: string;
  /** Public mount path of the API ("" or e.g. "/api"); see API_PATH_PREFIX. */
  pathPrefix: string;
  allowedOrigins: string[];
  databaseUrl: string;
  auth: { issuer: string; audience: string; jwksUri: string };
  staffJwtSecret: string;
  /** Staff hardware keys: bound to the app's own origin (the admin console is served there, never from previews). */
  webauthn: { rpId: string; rpName: string; origins: string[] };
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; store: "postgres" | "memory" };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
  payments: PaymentsConfig;
  catalogSearchBackend: "postgres" | "meilisearch";
  searchProfile: "v1" | "v2";
  trialActivation: "approval" | "automatic";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  audienceSources: "youtube"[];
  outreachEmail: OutreachEmailConfig;
  /** Incoming-webhook URL for alerts (audit OPS-03); null = logged only. */
  alertWebhookUrl: string | null;
  /** Proxies trusted for X-Forwarded-For (audit SEC-05); empty = none. */
  trustedProxies: string[];
  /** Supabase Auth admin access for trusted email checks (audit SEC-03); null when not configured. */
  authAdmin: { url: string; serviceKey: string } | null;
  /**
   * Whether customers can buy (security audit 2026-11-17): false on the live Vercel deployment while only the mock payment
   * provider is configured, so nobody can take a paid plan without paying.
   */
  paymentsOpen: boolean;
  /** Secret for the daily maintenance route (Vercel Cron); null = no route. */
  cronSecret: string | null;
  /** Private file storage for support ticket attachments (0076); null when the service key is not set. */
  storage: StorageConfig;
};

export type OutreachEmailConfig =
  | { mode: "off" }
  | { mode: "test"; from: string; postalAddress: string | null }
  | { mode: "resend"; from: string; apiKey: string; webhookSecret: string; postalAddress: string };

/** Only the hosted-LLM providers (for the manual smoke test): no database URL or other secret is read. */
export function loadLlmConfig(env: Env): LlmProviderConfig[] {
  return llmFrom(parse(sharedObject.pick(LLM_KEYS).superRefine(checkGemini), env));
}

export function loadApiConfig(env: Env): ApiConfig {
  const v = parse(apiSchema, env);
  const previews = v.ALLOWED_PREVIEW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const appUrl = new URL(v.APP_URL).origin;
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    port: v.PORT,
    appUrl,
    pathPrefix: v.API_PATH_PREFIX,
    allowedOrigins: [appUrl, ...previews],
    databaseUrl: v.DATABASE_URL,
    auth: { issuer: v.JWT_ISSUER, audience: v.JWT_AUDIENCE, jwksUri: v.JWKS_URI },
    staffJwtSecret: v.STAFF_JWT_SECRET,
    webauthn: { rpId: new URL(appUrl).hostname, rpName: "MUSHIN staff", origins: [appUrl] },
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: { windowMs: v.RATE_LIMIT_WINDOW_MS, maxRequests: v.RATE_LIMIT_MAX_REQUESTS, store: v.RATE_LIMIT_STORE ?? "postgres" },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    payments: paymentsFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    searchProfile: v.SEARCH_PROFILE,
    trialActivation: v.TRIAL_ACTIVATION,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_SEARCH_KEY),
    llm: llmFrom(v),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    outreachEmail:
      v.OUTREACH_EMAIL_MODE === "resend" && v.RESEND_API_KEY && v.RESEND_WEBHOOK_SECRET && v.OUTREACH_EMAIL_FROM && v.OUTREACH_POSTAL_ADDRESS
        ? { mode: "resend", from: v.OUTREACH_EMAIL_FROM, apiKey: v.RESEND_API_KEY, webhookSecret: v.RESEND_WEBHOOK_SECRET, postalAddress: v.OUTREACH_POSTAL_ADDRESS }
        : v.OUTREACH_EMAIL_MODE === "test"
          ? { mode: "test", from: v.OUTREACH_EMAIL_FROM ?? "MUSHIN test <outreach@test.mushin.invalid>", postalAddress: v.OUTREACH_POSTAL_ADDRESS ?? null }
          : { mode: "off" },
    alertWebhookUrl: v.ALERT_WEBHOOK_URL ?? null,
    trustedProxies: trustedProxiesFrom(v.TRUSTED_PROXIES, v.VERCEL_ENV),
    cronSecret: v.CRON_SECRET ?? null,
    paymentsOpen: paymentsFrom(v).mode === "paddle" || (v.VERCEL_ENV !== "production" && v.NODE_ENV !== "production"),
    authAdmin: v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
    storage: v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
  };
}

export type WorkerConfig = {
  nodeEnv: ApiConfig["nodeEnv"];
  logLevel: LogLevel;
  /** Transaction pooler: the worker's queries, like the API's. */
  databaseUrl: string;
  /** Session pooler: pg-boss and LISTEN need a connection they keep. */
  directUrl: string;
  databaseCaPem: string | null;
  appUrl: string;
  payments: PaymentsConfig;
  catalogSearchBackend: "postgres" | "meilisearch";
  searchProfile: "v1" | "v2";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  enrichment: EnrichmentPolicy;
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  scraping: ScrapingConfig;
  storage: StorageConfig;
  dataEncryptionKey: Buffer;
  audienceSources: "youtube"[];
  notifyEmail: { mode: "off" } | { mode: "test"; from: string } | { mode: "resend"; from: string; apiKey: string };
};

export function loadWorkerConfig(env: Env): WorkerConfig {
  const v = parse(workerSchema, env);
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    directUrl: v.DIRECT_URL,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    appUrl: new URL(v.APP_URL).origin,
    payments: paymentsFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    searchProfile: v.SEARCH_PROFILE,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    enrichment: {
      attributePolicy: v.ENRICHMENT_ATTRIBUTE_POLICY,
      youtubeContentEvidence: v.YOUTUBE_CONTENT_EVIDENCE === "on",
      youtubeDescriptionContacts: v.YOUTUBE_DESCRIPTION_CONTACTS === "on",
      semanticNiche: v.NICHE_SEMANTIC === "on",
    },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_API_KEY),
    llm: llmFrom(v),
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    scraping: {
      apifyToken: v.APIFY_TOKEN ?? null,
      instagramActor: v.APIFY_INSTAGRAM_ACTOR_ID,
      // Re-pinned 2026-11-14: the publishers removed 0.0.634 and 0.99.2065 (Apify answered 403 build-not-found). The new
      // builds were checked on live profiles (sajalaly; jannatmirza, ghanaaliraza, tastebykamal) through the full pipeline.
      instagramBuild: v.APIFY_INSTAGRAM_BUILD ?? (v.APIFY_INSTAGRAM_ACTOR_ID === "apify/instagram-profile-scraper" ? "0.0.689" : null),
      tiktokActor: v.APIFY_TIKTOK_ACTOR_ID,
      tiktokBuild: v.APIFY_TIKTOK_BUILD ?? (v.APIFY_TIKTOK_ACTOR_ID === "clockworks/tiktok-profile-scraper" ? "0.0.522" : null),
      instagramPostActor: v.APIFY_INSTAGRAM_POST_ACTOR_ID === "off" ? null : v.APIFY_INSTAGRAM_POST_ACTOR_ID,
      instagramPostBuild: v.APIFY_INSTAGRAM_POST_BUILD ?? (v.APIFY_INSTAGRAM_POST_ACTOR_ID === "apify/instagram-scraper" ? "0.0.812" : null),
      contentResolutionMax: v.LIVE_CONTENT_RESOLUTION_MAX,
      youtubeSearch: v.LIVE_YOUTUBE_SEARCH === "video" && v.YOUTUBE_API_CALLS === "on" && Boolean(v.YOUTUBE_API_KEY),
      extractionMultiplier: { instagram: v.LIVE_EXTRACTION_MULTIPLIER_INSTAGRAM, youtube: v.LIVE_EXTRACTION_MULTIPLIER_YOUTUBE, tiktok: v.LIVE_EXTRACTION_MULTIPLIER_TIKTOK },
      profileConcurrency: v.LIVE_PROFILE_CONCURRENCY,
      jobCostCap: {
        revenuePerCreditUsd: v.LIVE_REVENUE_PER_CREDIT_USD,
        costToPriceRatio: v.LIVE_COST_TO_PRICE_RATIO,
        profileUsd: { instagram: v.LIVE_PROFILE_USD_INSTAGRAM, tiktok: v.LIVE_PROFILE_USD_TIKTOK, youtube: v.LIVE_PROFILE_USD_YOUTUBE },
      },
      jobDeadlineMs: v.LIVE_JOB_DEADLINE_MINUTES * 60_000,
      apifyMonthlyBudgetUsd: v.APIFY_MONTHLY_BUDGET_USD,
      youtubeApiKey: v.YOUTUBE_API_CALLS === "on" ? (v.YOUTUBE_API_KEY ?? null) : null,
      serperApiKey: v.SERPER_API_KEY ?? null,
      serperMonthlySearchLimit: v.SERPER_MONTHLY_SEARCH_LIMIT,
    },
    storage: v.SUPABASE_URL && v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
    notifyEmail:
      v.NOTIFY_EMAIL_MODE === "resend" && v.RESEND_API_KEY && v.NOTIFY_EMAIL_FROM
        ? { mode: "resend", from: v.NOTIFY_EMAIL_FROM, apiKey: v.RESEND_API_KEY }
        : v.NOTIFY_EMAIL_MODE === "test"
          ? { mode: "test", from: v.NOTIFY_EMAIL_FROM ?? "MUSHIN test <notify@test.mushin.invalid>" }
          : { mode: "off" },
  };
}
