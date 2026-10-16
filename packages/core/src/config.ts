import { readFileSync } from "node:fs";
import { z } from "zod";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info");
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string")
  .refine((v) => !/@host:\d+\//.test(v), "is still the placeholder value; paste the real connection string");

/** Settings both the API and the worker need. */
const sharedObject = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  APP_URL: z.url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.url().default("http://localhost:4000"),
  DATABASE_SSL_CA_FILE: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_CLIENT_TOKEN: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MOCK_PADDLE_WEBHOOK_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  CATALOG_SEARCH_BACKEND: z.enum(["postgres", "meilisearch"]).default("postgres"),
  // MUSHIN-derived metrics from YouTube API data (DATA-004): off until the owner confirms policy eligibility.
  YOUTUBE_DERIVED_METRICS: z.enum(["on", "off"]).default("off"),
  // Audience estimate sources, comma-separated; empty (the default) turns the feature off. Only "youtube" exists, and it
  // may be enabled only once MUSHIN may derive metrics from YouTube API data (Developer Policies III.E.2, III.E.4.h, L).
  AUDIENCE_SOURCES: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.literal("youtube"))),
  MEILISEARCH_HOST: z.url().optional(),
  MEILISEARCH_API_KEY: z.string().min(1).optional(),
  MEILISEARCH_SEARCH_KEY: z.string().min(1).optional(),
  MEILISEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9_]*$/, "lowercase letters, digits and _ only").default(""),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  // Published USD prices per million tokens, checked 2026-10-14: Groq openai/gpt-oss-20b (console.groq.com model page)
  // and Ollama Cloud gpt-oss:20b pay-as-you-go (ollama.com/pricing). Ollama plans include usage credits, but usage is
  // still recorded at the per-token price so paid fallback traffic is never booked as free. Re-check on model changes.
  GROQ_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.075),
  GROQ_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0.3),
  OLLAMA_API_KEY: z.string().min(1).optional(),
  OLLAMA_BASE_URL: z.url().default("https://ollama.com/v1"),
  OLLAMA_MODEL: z.string().min(1).default("gpt-oss:20b"),
  OLLAMA_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.07),
  OLLAMA_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0.3),
  // Monthly cap on hosted-LLM spend across Groq and Ollama (USD). Required in production (owner decision 2026-10-14);
  // local and staging use USD 5 when unset. 0 refuses every AI call; no value disables the cap.
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),
});
type SharedValues = z.output<typeof sharedObject>;

const PADDLE_KEYS = ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET"] as const;

function checkShared(v: SharedValues, ctx: z.RefinementCtx) {
  if (v.NODE_ENV === "production" && v.LLM_MONTHLY_BUDGET_USD === undefined) {
    ctx.addIssue({ code: "custom", path: ["LLM_MONTHLY_BUDGET_USD"], message: "is required in production: set the monthly AI spend cap explicitly (USD)" });
  }
  if (v.NODE_ENV === "production" && !v.DATABASE_SSL_CA_FILE) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_SSL_CA_FILE"], message: "is required in production so database TLS certificates are verified" });
  }
  if (Boolean(v.UPSTASH_REDIS_REST_URL) !== Boolean(v.UPSTASH_REDIS_REST_TOKEN)) {
    const missing = v.UPSTASH_REDIS_REST_URL ? "UPSTASH_REDIS_REST_TOKEN" : "UPSTASH_REDIS_REST_URL";
    ctx.addIssue({ code: "custom", path: [missing], message: "set both Upstash values or neither" });
  }
  const missingPaddle = PADDLE_KEYS.filter((key) => !v[key]);
  if (missingPaddle.length > 0 && missingPaddle.length < PADDLE_KEYS.length) {
    for (const key of missingPaddle) {
      ctx.addIssue({ code: "custom", path: [key], message: "set all three Paddle values (PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_WEBHOOK_SECRET) or none" });
    }
  }
  if (missingPaddle.length === PADDLE_KEYS.length) {
    if (v.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["PADDLE_API_KEY"], message: "is required in production: the mock payment provider is for development only" });
    } else if (!v.MOCK_PADDLE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["MOCK_PADDLE_WEBHOOK_SECRET"], message: "is required while Paddle keys are not set (run npm run env:secrets)" });
    }
  }
  if (v.NODE_ENV === "production" && v.CATALOG_SEARCH_BACKEND === "meilisearch" && (!v.MEILISEARCH_HOST || !v.MEILISEARCH_API_KEY || !v.MEILISEARCH_SEARCH_KEY)) {
    ctx.addIssue({ code: "custom", path: ["MEILISEARCH_HOST"], message: "is required in production with MEILISEARCH_API_KEY and MEILISEARCH_SEARCH_KEY" });
  }
}

const encryptionKey = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded");

const apiSchema = sharedObject
  .extend({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    ALLOWED_PREVIEW_ORIGINS: z.string().default(""),
    DATABASE_URL: postgresUrl,
    SUPABASE_URL: z.url(),
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1).default("authenticated"),
    JWKS_URI: z.url(),
    STAFF_JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    DATA_ENCRYPTION_KEY: encryptionKey,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    // Where counters live. Unset: Upstash when configured (legacy), otherwise PostgreSQL (the Supabase target).
    RATE_LIMIT_STORE: z.enum(["postgres", "upstash", "memory"]).optional(),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
    // Outreach email (owner decision 2026-10-16): off by default. "test" records sends through a mock provider and
    // delivers nothing (never in production). "resend" sends for real and needs every key below plus
    // OUTREACH_EMAIL_SENDS_AUTHORIZED=yes, which the owner sets only after authorising real sends.
    OUTREACH_EMAIL_MODE: z.enum(["off", "test", "resend"]).default("off"),
    OUTREACH_EMAIL_FROM: z.string().min(3).max(200).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/, "must be the whsec_ signing secret").optional(),
    OUTREACH_EMAIL_SENDS_AUTHORIZED: z.enum(["yes", "no"]).default("no"),
  })
  .superRefine(checkShared)
  .superRefine((v, ctx) => {
    if (v.RATE_LIMIT_STORE === "upstash" && !v.UPSTASH_REDIS_REST_URL) {
      ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_STORE"], message: "upstash needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN" });
    }
    // The in-memory limiter is per process: several API instances would each allow the full limit.
    if (v.NODE_ENV === "production" && v.RATE_LIMIT_STORE === "memory") {
      ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_STORE"], message: "memory is for development and tests only" });
    }
    if (v.OUTREACH_EMAIL_MODE === "test" && v.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["OUTREACH_EMAIL_MODE"], message: "test mode delivers nothing and is for development only" });
    }
    if (v.OUTREACH_EMAIL_MODE === "resend") {
      for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "OUTREACH_EMAIL_FROM"] as const) {
        if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when OUTREACH_EMAIL_MODE=resend" });
      }
      if (v.OUTREACH_EMAIL_SENDS_AUTHORIZED !== "yes") {
        ctx.addIssue({ code: "custom", path: ["OUTREACH_EMAIL_SENDS_AUTHORIZED"], message: "real outreach email needs the owner's authorisation (set to yes)" });
      }
    }
  });

const workerSchema = sharedObject
  .extend({
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
    DATA_ENCRYPTION_KEY: encryptionKey,
    APIFY_TOKEN: z.string().min(1).optional(),
    APIFY_INSTAGRAM_ACTOR_ID: z.string().min(1).default("apify/instagram-profile-scraper"),
    APIFY_INSTAGRAM_BUILD: z.string().min(1).optional(),
    APIFY_TIKTOK_ACTOR_ID: z.string().min(1).default("clockworks/tiktok-profile-scraper"),
    APIFY_TIKTOK_BUILD: z.string().min(1).optional(),
    // Instagram post/reel → author for live discovery; set to "off" to disable. Pinned build reviewed 2026-10-13.
    APIFY_INSTAGRAM_POST_ACTOR_ID: z.string().min(1).default("apify/instagram-scraper"),
    APIFY_INSTAGRAM_POST_BUILD: z.string().min(1).optional(),
    // Off by default until the post actor's terms and permitted use are reviewed (2026-10-13); 10 was the tested setting.
    LIVE_CONTENT_RESOLUTION_MAX: z.coerce.number().int().min(0).max(20).default(0),
    // One YouTube Data API video search per live run with YouTube in scope (101 quota units, $0); "off" disables it.
    LIVE_YOUTUBE_SEARCH: z.enum(["video", "off"]).default("video"),
    // Fill-to-size, per platform: fetch up to this multiple of the run size while it is not filled. The customer charge
    // is unchanged (only delivered new creators, never above the quote); provider cost rises. 1 disables extra waves.
    // Defaults from the 2026-10-14 recorded-response replay study (25 briefs, size 5, 1×–4× per platform, cost cap on;
    // docs/readiness/search-quality.md): the smallest multiplier at each platform's yield plateau. Instagram 2× (33 → 45
    // delivered, +USD 0.007 per brief estimated), YouTube 3× (2 → 12, USD 0: API quota). TikTok stays 1×: the
    // recordings cannot measure it (most extra profiles were never recorded). Provisional until human relevance ratings.
    LIVE_EXTRACTION_MULTIPLIER_INSTAGRAM: z.coerce.number().min(1).max(4).default(2),
    LIVE_EXTRACTION_MULTIPLIER_YOUTUBE: z.coerce.number().min(1).max(4).default(3),
    LIVE_EXTRACTION_MULTIPLIER_TIKTOK: z.coerce.number().min(1).max(4).default(1),
    // Profiles a live run processes at the same time (the AI assessment dominates; measured ~6 s per profile).
    LIVE_PROFILE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
    // Per-job cost cap, checked before every extraction batch: a run's provider cost may not pass quoted max credits ×
    // revenue per credit ÷ the cost-to-price ratio (owner rule: price at least 3× cost). Revenue per credit defaults to
    // the cheapest paid credit (Scale tier, before payment fees). A batch takes only the candidates whose estimated
    // profile cost still fits: Instagram USD 0.0026 (measured per profile), TikTok USD 0.011 (one measured 5-profile
    // run, USD 0.054), YouTube USD 0 (Data API). Re-measure before relying on them.
    LIVE_REVENUE_PER_CREDIT_USD: z.coerce.number().positive().default(0.002029),
    LIVE_COST_TO_PRICE_RATIO: z.coerce.number().min(1).default(3),
    LIVE_PROFILE_USD_INSTAGRAM: z.coerce.number().min(0).default(0.0026),
    LIVE_PROFILE_USD_TIKTOK: z.coerce.number().min(0).default(0.011),
    LIVE_PROFILE_USD_YOUTUBE: z.coerce.number().min(0).default(0),
    // Per-job deadline (LIVE-004), minutes from job creation, checked before each extraction batch. Kept below the
    // stuck-job sweep (stuck_job_minutes, default 30), which fails and refunds the whole run. Measured live runs took
    // about 2.5 minutes (2026-10-13). Provisional default; the owner may set another value.
    LIVE_JOB_DEADLINE_MINUTES: z.coerce.number().min(1).max(240).default(20),
    APIFY_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(5),
    YOUTUBE_API_KEY: z.string().min(1).optional(),
    SERPER_API_KEY: z.string().min(1).optional(),
    SERPER_MONTHLY_SEARCH_LIMIT: z.coerce.number().int().min(0).default(2500),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    checkShared(v, ctx);
    if (v.NODE_ENV !== "production") return;
    for (const key of ["APIFY_TOKEN", "YOUTUBE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SERPER_API_KEY"] as const) {
      if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production (creator data pipeline and live discovery)" });
    }
  });

/** Reads the database CA certificate (PEM). Returns null when no path is configured. */
export function readCaFile(path: string | undefined): string | null {
  if (!path) return null;
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

function rateLimitStore(chosen: "postgres" | "upstash" | "memory" | undefined, upstash: { url: string; token: string } | null): "postgres" | "upstash" | "memory" {
  return chosen ?? (upstash ? "upstash" : "postgres");
}

function upstashFrom(v: SharedValues): { url: string; token: string } | null {
  return v.UPSTASH_REDIS_REST_URL && v.UPSTASH_REDIS_REST_TOKEN ? { url: v.UPSTASH_REDIS_REST_URL, token: v.UPSTASH_REDIS_REST_TOKEN } : null;
}

export type SearchConfig = { host: string; apiKey: string; indexPrefix: string } | null;
export type LlmProviderConfig = {
  name: "groq" | "ollama";
  baseUrl: string;
  apiKey: string;
  model: string;
  priceInPerMTok: number;
  priceOutPerMTok: number;
};

function searchFrom(v: SharedValues, key: string | undefined): SearchConfig {
  if (!v.MEILISEARCH_HOST || !key) return null;
  return { host: v.MEILISEARCH_HOST.replace(/\/+$/, ""), apiKey: key, indexPrefix: v.MEILISEARCH_INDEX_PREFIX };
}

/** Groq first (cheap default), Ollama Cloud as the fallback when Groq fails (SRS §3.3, architecture Q8). */
function llmFrom(v: SharedValues): LlmProviderConfig[] {
  const out: LlmProviderConfig[] = [];
  if (v.GROQ_API_KEY) {
    out.push({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: v.GROQ_API_KEY,
      model: v.GROQ_MODEL,
      priceInPerMTok: v.GROQ_PRICE_IN_PER_MTOK,
      priceOutPerMTok: v.GROQ_PRICE_OUT_PER_MTOK,
    });
  }
  if (v.OLLAMA_API_KEY) {
    out.push({
      name: "ollama",
      baseUrl: v.OLLAMA_BASE_URL.replace(/\/+$/, ""),
      apiKey: v.OLLAMA_API_KEY,
      model: v.OLLAMA_MODEL,
      priceInPerMTok: v.OLLAMA_PRICE_IN_PER_MTOK,
      priceOutPerMTok: v.OLLAMA_PRICE_OUT_PER_MTOK,
    });
  }
  return out;
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
  allowedOrigins: string[];
  databaseUrl: string;
  auth: { issuer: string; audience: string; jwksUri: string };
  staffJwtSecret: string;
  /** Staff hardware keys: bound to the app's own origin (the admin console is served there, never from previews). */
  webauthn: { rpId: string; rpName: string; origins: string[] };
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; store: "postgres" | "upstash" | "memory"; upstash: { url: string; token: string } | null };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
  payments: PaymentsConfig;
  catalogSearchBackend: "postgres" | "meilisearch";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  audienceSources: "youtube"[];
  outreachEmail: OutreachEmailConfig;
};

export type OutreachEmailConfig =
  | { mode: "off" }
  | { mode: "test"; from: string }
  | { mode: "resend"; from: string; apiKey: string; webhookSecret: string };

export function loadApiConfig(env: Env): ApiConfig {
  const v = parse(apiSchema, env);
  const previews = v.ALLOWED_PREVIEW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const appUrl = new URL(v.APP_URL).origin;
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    port: v.PORT,
    appUrl,
    allowedOrigins: [appUrl, ...previews],
    databaseUrl: v.DATABASE_URL,
    auth: { issuer: v.JWT_ISSUER, audience: v.JWT_AUDIENCE, jwksUri: v.JWKS_URI },
    staffJwtSecret: v.STAFF_JWT_SECRET,
    webauthn: { rpId: new URL(appUrl).hostname, rpName: "MUSHIN staff", origins: [appUrl] },
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: { windowMs: v.RATE_LIMIT_WINDOW_MS, maxRequests: v.RATE_LIMIT_MAX_REQUESTS, store: rateLimitStore(v.RATE_LIMIT_STORE, upstashFrom(v)), upstash: upstashFrom(v) },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    payments: paymentsFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_SEARCH_KEY),
    llm: llmFrom(v),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    outreachEmail:
      v.OUTREACH_EMAIL_MODE === "resend" && v.RESEND_API_KEY && v.RESEND_WEBHOOK_SECRET && v.OUTREACH_EMAIL_FROM
        ? { mode: "resend", from: v.OUTREACH_EMAIL_FROM, apiKey: v.RESEND_API_KEY, webhookSecret: v.RESEND_WEBHOOK_SECRET }
        : v.OUTREACH_EMAIL_MODE === "test"
          ? { mode: "test", from: v.OUTREACH_EMAIL_FROM ?? "MUSHIN test <outreach@test.mushin.invalid>" }
          : { mode: "off" },
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
  upstash: { url: string; token: string } | null;
  catalogSearchBackend: "postgres" | "meilisearch";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  scraping: ScrapingConfig;
  storage: StorageConfig;
  dataEncryptionKey: Buffer;
  audienceSources: "youtube"[];
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
    upstash: upstashFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_API_KEY),
    llm: llmFrom(v),
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    scraping: {
      apifyToken: v.APIFY_TOKEN ?? null,
      instagramActor: v.APIFY_INSTAGRAM_ACTOR_ID,
      instagramBuild: v.APIFY_INSTAGRAM_BUILD ?? (v.APIFY_INSTAGRAM_ACTOR_ID === "apify/instagram-profile-scraper" ? "0.0.634" : null),
      tiktokActor: v.APIFY_TIKTOK_ACTOR_ID,
      tiktokBuild: v.APIFY_TIKTOK_BUILD ?? (v.APIFY_TIKTOK_ACTOR_ID === "clockworks/tiktok-profile-scraper" ? "0.99.2065" : null),
      instagramPostActor: v.APIFY_INSTAGRAM_POST_ACTOR_ID === "off" ? null : v.APIFY_INSTAGRAM_POST_ACTOR_ID,
      instagramPostBuild: v.APIFY_INSTAGRAM_POST_BUILD ?? (v.APIFY_INSTAGRAM_POST_ACTOR_ID === "apify/instagram-scraper" ? "0.0.812" : null),
      contentResolutionMax: v.LIVE_CONTENT_RESOLUTION_MAX,
      youtubeSearch: v.LIVE_YOUTUBE_SEARCH === "video" && Boolean(v.YOUTUBE_API_KEY),
      extractionMultiplier: { instagram: v.LIVE_EXTRACTION_MULTIPLIER_INSTAGRAM, youtube: v.LIVE_EXTRACTION_MULTIPLIER_YOUTUBE, tiktok: v.LIVE_EXTRACTION_MULTIPLIER_TIKTOK },
      profileConcurrency: v.LIVE_PROFILE_CONCURRENCY,
      jobCostCap: {
        revenuePerCreditUsd: v.LIVE_REVENUE_PER_CREDIT_USD,
        costToPriceRatio: v.LIVE_COST_TO_PRICE_RATIO,
        profileUsd: { instagram: v.LIVE_PROFILE_USD_INSTAGRAM, tiktok: v.LIVE_PROFILE_USD_TIKTOK, youtube: v.LIVE_PROFILE_USD_YOUTUBE },
      },
      jobDeadlineMs: v.LIVE_JOB_DEADLINE_MINUTES * 60_000,
      apifyMonthlyBudgetUsd: v.APIFY_MONTHLY_BUDGET_USD,
      youtubeApiKey: v.YOUTUBE_API_KEY ?? null,
      serperApiKey: v.SERPER_API_KEY ?? null,
      serperMonthlySearchLimit: v.SERPER_MONTHLY_SEARCH_LIMIT,
    },
    storage: v.SUPABASE_URL && v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
  };
}
