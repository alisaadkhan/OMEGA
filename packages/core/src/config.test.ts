import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig, loadWorkerConfig } from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
const MOCK = "m".repeat(40);
const valid = {
  NODE_ENV: "development",
  PORT: "4000",
  APP_URL: "http://localhost:5173",
  ALLOWED_PREVIEW_ORIGINS: "https://preview.mushin.pk, https://staging.mushin.pk",
  DATABASE_URL: "postgresql://u:p@db.example.com:6543/postgres",
  SUPABASE_URL: "https://abc.supabase.co",
  JWT_ISSUER: "https://abc.supabase.co/auth/v1",
  JWT_AUDIENCE: "authenticated",
  JWKS_URI: "https://abc.supabase.co/auth/v1/.well-known/jwks.json",
  STAFF_JWT_SECRET: "s".repeat(40),
  DATA_ENCRYPTION_KEY: KEY,
  MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
};

describe("loadApiConfig", () => {
  it("parses a valid environment", () => {
    const c = loadApiConfig(valid);
    expect(c.port).toBe(4000);
    expect(c.allowedOrigins).toEqual(["http://localhost:5173", "https://preview.mushin.pk", "https://staging.mushin.pk"]);
    expect(c.dataEncryptionKey).toHaveLength(32);
    expect(c.rateLimit).toEqual({ windowMs: 60_000, maxRequests: 120, store: "postgres", upstash: null });
    expect(c.idempotencyTtlHours).toBe(24);
    expect(c.catalogSearchBackend).toBe("postgres");
    expect(c.logLevel).toBe("info");
  });

  it("keeps audience estimates off unless a source is enabled, and accepts only sources that exist", () => {
    expect(loadApiConfig(valid).audienceSources).toEqual([]);
    expect(loadApiConfig({ ...valid, AUDIENCE_SOURCES: " YouTube,youtube " }).audienceSources).toEqual(["youtube"]);
    expect(() => loadApiConfig({ ...valid, AUDIENCE_SOURCES: "youtube,instagram" })).toThrow(ConfigError);
  });

  it("lists every problem at once and treats blank values as missing", () => {
    const run = () => loadApiConfig({ ...valid, DATABASE_URL: "  ", STAFF_JWT_SECRET: "short" });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (err) {
      const issues = (err as ConfigError).issues.join("\n");
      expect(issues).toContain("DATABASE_URL");
      expect(issues).toContain("STAFF_JWT_SECRET");
    }
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => loadApiConfig({ ...valid, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it("requires both Upstash values or neither", () => {
    expect(() => loadApiConfig({ ...valid, UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
    const c = loadApiConfig({ ...valid, UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(c.rateLimit.upstash).toEqual({ url: "https://x.upstash.io", token: "t" });
  });

  it("counts rate limits in PostgreSQL unless another store is chosen explicitly (audit SEC-06)", () => {
    const upstash = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };
    expect(loadApiConfig(valid).rateLimit.store).toBe("postgres");
    // Upstash variables alone no longer select the fail-open store.
    expect(loadApiConfig({ ...valid, ...upstash }).rateLimit.store).toBe("postgres");
    expect(loadApiConfig({ ...valid, ...upstash, RATE_LIMIT_STORE: "upstash" }).rateLimit.store).toBe("upstash");
    expect(loadApiConfig({ ...valid, ...upstash, RATE_LIMIT_STORE: "postgres" }).rateLimit.store).toBe("postgres");
    expect(loadApiConfig({ ...valid, RATE_LIMIT_STORE: "memory" }).rateLimit.store).toBe("memory");
    expect(() => loadApiConfig({ ...valid, RATE_LIMIT_STORE: "upstash" })).toThrow(/RATE_LIMIT_STORE: upstash needs/);
    expect(() => loadApiConfig({ ...valid, RATE_LIMIT_STORE: "redis" })).toThrow(/RATE_LIMIT_STORE/);
  });

  it("trusts no proxy unless TRUSTED_PROXIES names one (audit SEC-05)", () => {
    expect(loadApiConfig(valid).trustedProxies).toEqual([]);
    expect(loadApiConfig({ ...valid, TRUSTED_PROXIES: " 10.0.0.0/8, 192.168.1.5 ," }).trustedProxies).toEqual(["10.0.0.0/8", "192.168.1.5"]);
  });

  it("refuses the per-process memory limiter in production", () => {
    expect(() => loadApiConfig({ ...valid, NODE_ENV: "production", RATE_LIMIT_STORE: "memory" })).toThrow(/RATE_LIMIT_STORE: memory is for development/);
  });
});

describe("loadWorkerConfig", () => {
  it("needs DIRECT_URL and rejects the placeholder host", () => {
    const urls = { DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres", MOCK_PADDLE_WEBHOOK_SECRET: MOCK, DATA_ENCRYPTION_KEY: KEY };
    expect(loadWorkerConfig({ ...urls, DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres" }).directUrl).toContain(":5432");
    expect(() => loadWorkerConfig({ ...urls, DIRECT_URL: "postgresql://user:password@host:5432/postgres" })).toThrow(/DIRECT_URL/);
  });

  it("queries through DATABASE_URL (transaction pooler) and keeps DIRECT_URL for pg-boss and LISTEN", () => {
    const c = loadWorkerConfig({
      DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres",
      DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres",
      MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
      DATA_ENCRYPTION_KEY: KEY,
    });
    expect([c.databaseUrl, c.directUrl]).toEqual(["postgresql://u:p@pooler.example.com:6543/postgres", "postgresql://u:p@pooler.example.com:5432/postgres"]);
    expect(() => loadWorkerConfig({ DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres", MOCK_PADDLE_WEBHOOK_SECRET: MOCK })).toThrow(/DATABASE_URL/);
  });
});

describe("database CA certificate", () => {
  it("is optional in development and loaded when configured", () => {
    expect(loadApiConfig(valid).databaseCaPem).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "mushin-ca-"));
    const file = join(dir, "supabase-ca.crt");
    writeFileSync(file, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    expect(loadApiConfig({ ...valid, DATABASE_SSL_CA_FILE: file }).databaseCaPem).toContain("BEGIN CERTIFICATE");
  });

  it("is required in production and must be readable", () => {
    expect(() => loadApiConfig({ ...valid, NODE_ENV: "production" })).toThrow(/DATABASE_SSL_CA_FILE/);
    expect(() => loadApiConfig({ ...valid, DATABASE_SSL_CA_FILE: "/definitely/missing.crt" })).toThrow(/DATABASE_SSL_CA_FILE/);
  });
});

function caFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "mushin-ca-"));
  const file = join(dir, "ca.crt");
  writeFileSync(file, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
  return file;
}

describe("payments config", () => {
  it("uses the mock provider when no Paddle keys are set", () => {
    expect(loadApiConfig(valid).payments).toEqual({
      mode: "mock",
      webhookSecret: MOCK,
      appUrl: "http://localhost:5173",
      publicApiUrl: "http://localhost:4000",
    });
  });

  it("uses Paddle when all three keys are set", () => {
    const c = loadApiConfig({ ...valid, PADDLE_API_KEY: "k", PADDLE_CLIENT_TOKEN: "t", PADDLE_WEBHOOK_SECRET: "s", PADDLE_ENVIRONMENT: "sandbox" });
    expect(c.payments).toMatchObject({ mode: "paddle", apiKey: "k", clientToken: "t", webhookSecret: "s", environment: "sandbox" });
  });

  it("rejects partial Paddle keys and a missing mock secret", () => {
    expect(() => loadApiConfig({ ...valid, PADDLE_API_KEY: "k" })).toThrow(/PADDLE_CLIENT_TOKEN/);
    expect(() => loadApiConfig({ ...valid, MOCK_PADDLE_WEBHOOK_SECRET: undefined })).toThrow(/MOCK_PADDLE_WEBHOOK_SECRET/);
  });

  it("refuses the mock provider in production", () => {
    expect(() => loadApiConfig({ ...valid, NODE_ENV: "production", DATABASE_SSL_CA_FILE: caFile() })).toThrow(/PADDLE_API_KEY/);
  });

  it("gives the worker payments and Upstash settings", () => {
    const c = loadWorkerConfig({
      DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres",
      DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres",
      MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
      DATA_ENCRYPTION_KEY: KEY,
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(c.payments.mode).toBe("mock");
    expect(c.upstash).toEqual({ url: "https://x.upstash.io", token: "t" });
    expect(c.appUrl).toBe("http://localhost:5173");
  });
});

describe("search and LLM settings", () => {
  const worker = { DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres", DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres", MOCK_PADDLE_WEBHOOK_SECRET: MOCK, DATA_ENCRYPTION_KEY: KEY };

  it("gives the API the read-only search key and the worker the admin key", () => {
    const meili = { MEILISEARCH_HOST: "http://127.0.0.1:7700/", MEILISEARCH_API_KEY: "admin", MEILISEARCH_SEARCH_KEY: "search", MEILISEARCH_INDEX_PREFIX: "dev_" };
    expect(loadApiConfig({ ...valid, ...meili }).search).toEqual({ host: "http://127.0.0.1:7700", apiKey: "search", indexPrefix: "dev_" });
    expect(loadWorkerConfig({ ...worker, ...meili }).search).toEqual({ host: "http://127.0.0.1:7700", apiKey: "admin", indexPrefix: "dev_" });
  });

  it("defaults to PostgreSQL and requires Meilisearch only for explicit rollback mode", () => {
    expect(loadApiConfig(valid).search).toBeNull();
    expect(loadApiConfig(valid).catalogSearchBackend).toBe("postgres");
    const production = { ...valid, NODE_ENV: "production", DATABASE_SSL_CA_FILE: caFile(), PADDLE_API_KEY: "p", PADDLE_CLIENT_TOKEN: "c", PADDLE_WEBHOOK_SECRET: "w", LLM_MONTHLY_BUDGET_USD: "20", SUPABASE_SERVICE_ROLE_KEY: "service" };
    expect(loadApiConfig(production).catalogSearchBackend).toBe("postgres");
    expect(() => loadApiConfig({ ...production, CATALOG_SEARCH_BACKEND: "meilisearch" })).toThrow(/MEILISEARCH_HOST/);
    expect(loadApiConfig({ ...valid, CATALOG_SEARCH_BACKEND: "meilisearch" }).catalogSearchBackend).toBe("meilisearch");
  });

  it("orders LLM providers Groq first, then Ollama Cloud, with model and price defaults", () => {
    const c = loadApiConfig({ ...valid, GROQ_API_KEY: "g", OLLAMA_API_KEY: "o" });
    expect(c.llm.map((p) => [p.name, p.model, p.baseUrl])).toEqual([
      ["groq", "openai/gpt-oss-20b", "https://api.groq.com/openai/v1"],
      ["ollama", "gpt-oss:20b", "https://ollama.com/v1"],
    ]);
    expect(c.llm[0]?.priceInPerMTok).toBeGreaterThan(0);
    // The paid Ollama Cloud fallback must never be recorded as free by default.
    expect(c.llm.map((p) => [p.name, p.priceInPerMTok, p.priceOutPerMTok])).toEqual([
      ["groq", 0.075, 0.3],
      ["ollama", 0.07, 0.3],
    ]);
    expect(loadApiConfig(valid).llm).toEqual([]);
    expect([loadApiConfig(valid).llmMonthlyBudgetUsd, loadApiConfig({ ...valid, LLM_MONTHLY_BUDGET_USD: "12.5" }).llmMonthlyBudgetUsd]).toEqual([5, 12.5]);
    // Production needs an explicit cap; 0 is a cap (every call refused), not "no cap".
    const production = { ...valid, NODE_ENV: "production", DATABASE_SSL_CA_FILE: caFile(), PADDLE_API_KEY: "p", PADDLE_CLIENT_TOKEN: "c", PADDLE_WEBHOOK_SECRET: "w", SUPABASE_SERVICE_ROLE_KEY: "service" };
    expect(() => loadApiConfig(production)).toThrow(/LLM_MONTHLY_BUDGET_USD/);
    expect(loadApiConfig({ ...production, LLM_MONTHLY_BUDGET_USD: "0" }).llmMonthlyBudgetUsd).toBe(0);
    // Audit SEC-03: production needs the Auth admin key so invitations can check confirmed emails on the server.
    expect(() => loadApiConfig({ ...production, SUPABASE_SERVICE_ROLE_KEY: undefined, LLM_MONTHLY_BUDGET_USD: "0" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(loadApiConfig({ ...production, LLM_MONTHLY_BUDGET_USD: "0" }).authAdmin).toEqual({ url: "https://abc.supabase.co", serviceKey: "service" });
    expect(loadApiConfig(valid).authAdmin).toBeNull();
    expect(loadWorkerConfig({ ...worker, OLLAMA_API_KEY: "o", OLLAMA_MODEL: "gemma4:31b" }).llm.map((p) => p.model)).toEqual(["gemma4:31b"]);
  });
});

describe("scraping and storage settings (worker only)", () => {
  const worker = {
    DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres",
    DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres",
    MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("reads Apify, YouTube and Supabase Storage settings with actor and budget defaults", () => {
    const c = loadWorkerConfig({
      ...worker,
      APIFY_TOKEN: "apify",
      YOUTUBE_API_KEY: "yt",
      SUPABASE_URL: "https://ref.supabase.co/",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(c.scraping).toEqual({
      apifyToken: "apify",
      instagramActor: "apify/instagram-profile-scraper",
      instagramBuild: "0.0.634",
      tiktokActor: "clockworks/tiktok-profile-scraper",
      tiktokBuild: "0.99.2065",
      instagramPostActor: "apify/instagram-scraper",
      instagramPostBuild: "0.0.812",
      contentResolutionMax: 0,
      youtubeSearch: true,
      extractionMultiplier: { instagram: 2, youtube: 3, tiktok: 1 },
      profileConcurrency: 3,
      jobCostCap: { revenuePerCreditUsd: 0.002029, costToPriceRatio: 3, profileUsd: { instagram: 0.0026, tiktok: 0.011, youtube: 0 } },
      jobDeadlineMs: 20 * 60_000,
      apifyMonthlyBudgetUsd: 5,
      youtubeApiKey: "yt",
      serperApiKey: null,
      serperMonthlySearchLimit: 2500,
    });
    expect(loadWorkerConfig({ ...worker, LIVE_JOB_DEADLINE_MINUTES: "10" }).scraping.jobDeadlineMs).toBe(600_000);
    expect(() => loadWorkerConfig({ ...worker, LIVE_JOB_DEADLINE_MINUTES: "0" })).toThrow(/LIVE_JOB_DEADLINE_MINUTES/);
    expect(loadWorkerConfig({ ...worker, APIFY_INSTAGRAM_POST_ACTOR_ID: "off" }).scraping).toMatchObject({ instagramPostActor: null, instagramPostBuild: null });
    expect(c.storage).toEqual({ url: "https://ref.supabase.co", serviceKey: "service" });
    expect(c.dataEncryptionKey.length).toBe(32);
  });

  it("does not apply the validated Instagram build to a custom actor", () => {
    const c = loadWorkerConfig({ ...worker, APIFY_INSTAGRAM_ACTOR_ID: "team/custom-instagram-actor" });
    expect(c.scraping.instagramBuild).toBeNull();
  });

  it("pins the reviewed TikTok actor version and permits explicit custom actor builds", () => {
    expect(loadWorkerConfig(worker).scraping.tiktokBuild).toBe("0.99.2065");
    expect(loadWorkerConfig({ ...worker, APIFY_TIKTOK_ACTOR_ID: "team/custom-tiktok", APIFY_TIKTOK_BUILD: "1.2.3" }).scraping.tiktokBuild).toBe("1.2.3");
  });

  it("treats missing scraper keys and storage as not configured outside production", () => {
    const c = loadWorkerConfig(worker);
    expect(c.scraping.apifyToken).toBeNull();
    expect(c.scraping.youtubeApiKey).toBeNull();
    expect(c.storage).toBeNull();
  });

  it("refuses production without the scraper keys, storage and encryption key", () => {
    expect(() => loadWorkerConfig({ ...worker, NODE_ENV: "production", DATABASE_SSL_CA_FILE: undefined })).toThrow(/APIFY_TOKEN/);
    expect(() => loadWorkerConfig({ ...worker, DATA_ENCRYPTION_KEY: "short" })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it("reads the Serper key and monthly search limit, and requires the key in production", () => {
    const c = loadWorkerConfig({ ...worker, SERPER_API_KEY: "serper-key", SERPER_MONTHLY_SEARCH_LIMIT: "100" });
    expect(c.scraping).toMatchObject({ serperApiKey: "serper-key", serperMonthlySearchLimit: 100 });
    expect(loadWorkerConfig(worker).scraping).toMatchObject({ serperApiKey: null, serperMonthlySearchLimit: 2500 });
    expect(() => loadWorkerConfig({ ...worker, NODE_ENV: "production", DATABASE_SSL_CA_FILE: undefined })).toThrow(/SERPER_API_KEY/);
  });
});
