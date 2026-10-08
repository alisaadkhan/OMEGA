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
    expect(c.rateLimit).toEqual({ windowMs: 60_000, maxRequests: 120, upstash: null });
    expect(c.idempotencyTtlHours).toBe(24);
    expect(c.logLevel).toBe("info");
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
});

describe("loadWorkerConfig", () => {
  it("needs DIRECT_URL and rejects the placeholder host", () => {
    const urls = { DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres", MOCK_PADDLE_WEBHOOK_SECRET: MOCK };
    expect(loadWorkerConfig({ ...urls, DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres" }).directUrl).toContain(":5432");
    expect(() => loadWorkerConfig({ ...urls, DIRECT_URL: "postgresql://user:password@host:5432/postgres" })).toThrow(/DIRECT_URL/);
  });

  it("queries through DATABASE_URL (transaction pooler) and keeps DIRECT_URL for pg-boss and LISTEN", () => {
    const c = loadWorkerConfig({
      DATABASE_URL: "postgresql://u:p@pooler.example.com:6543/postgres",
      DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres",
      MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
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
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(c.payments.mode).toBe("mock");
    expect(c.upstash).toEqual({ url: "https://x.upstash.io", token: "t" });
    expect(c.appUrl).toBe("http://localhost:5173");
  });
});
