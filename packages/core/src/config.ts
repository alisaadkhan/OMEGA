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
}

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
    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  })
  .superRefine(checkShared);

const workerSchema = sharedObject.extend({ DATABASE_URL: postgresUrl, DIRECT_URL: postgresUrl }).superRefine(checkShared);

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
  };
}
