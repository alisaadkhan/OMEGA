import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig, loadWorkerConfig } from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
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
    expect(loadWorkerConfig({ DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres" }).directUrl).toContain("pooler");
    expect(() => loadWorkerConfig({ DIRECT_URL: "postgresql://user:password@host:5432/postgres" })).toThrow(/DIRECT_URL/);
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
