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
  MEILISEARCH_HOST: z.url().optional(),
  MEILISEARCH_API_KEY: z.string().min(1).optional(),
  MEILISEARCH_SEARCH_KEY: z.string().min(1).optional(),
  MEILISEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9_]*$/, "lowercase letters, digits and _ only").default(""),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  GROQ_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.075),
  GROQ_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0.3),
  OLLAMA_API_KEY: z.string().min(1).optional(),
  OLLAMA_BASE_URL: z.url().default("https://ollama.com/v1"),
  OLLAMA_MODEL: z.string().min(1).default("gpt-oss:20b"),
  OLLAMA_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0),
  OLLAMA_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0),
});
type SharedValues = z.output<typeof sharedObject>;

const PADDLE_KEYS = ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET"] as const;

function checkShared(v: SharedValues, ctx: z.RefinementCtx) {
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
  if (v.NODE_ENV === "production" && (!v.MEILISEARCH_HOST || !v.MEILISEARCH_API_KEY || !v.MEILISEARCH_SEARCH_KEY)) {
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
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  })
  .superRefine(checkShared);

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
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; upstash: { url: string; token: string } | null };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
  payments: PaymentsConfig;
  search: SearchConfig;
  llm: LlmProviderConfig[];
};

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
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: { windowMs: v.RATE_LIMIT_WINDOW_MS, maxRequests: v.RATE_LIMIT_MAX_REQUESTS, upstash: upstashFrom(v) },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    payments: paymentsFrom(v),
    search: searchFrom(v, v.MEILISEARCH_SEARCH_KEY),
    llm: llmFrom(v),
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
  search: SearchConfig;
  llm: LlmProviderConfig[];
  scraping: ScrapingConfig;
  storage: StorageConfig;
  dataEncryptionKey: Buffer;
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
    search: searchFrom(v, v.MEILISEARCH_API_KEY),
    llm: llmFrom(v),
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    scraping: {
      apifyToken: v.APIFY_TOKEN ?? null,
      instagramActor: v.APIFY_INSTAGRAM_ACTOR_ID,
      instagramBuild: v.APIFY_INSTAGRAM_BUILD ?? (v.APIFY_INSTAGRAM_ACTOR_ID === "apify/instagram-profile-scraper" ? "0.0.634" : null),
      tiktokActor: v.APIFY_TIKTOK_ACTOR_ID,
      tiktokBuild: v.APIFY_TIKTOK_BUILD ?? (v.APIFY_TIKTOK_ACTOR_ID === "clockworks/tiktok-profile-scraper" ? "0.99.2065" : null),
      apifyMonthlyBudgetUsd: v.APIFY_MONTHLY_BUDGET_USD,
      youtubeApiKey: v.YOUTUBE_API_KEY ?? null,
      serperApiKey: v.SERPER_API_KEY ?? null,
      serperMonthlySearchLimit: v.SERPER_MONTHLY_SEARCH_LIMIT,
    },
    storage: v.SUPABASE_URL && v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
  };
}
