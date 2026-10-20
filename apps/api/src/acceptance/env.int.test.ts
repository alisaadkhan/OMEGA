/**
 * Acceptance: environment, migrations, database safety and provider disabling (ENV-*).
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig } from "@mushin/core";
import { migrate } from "@mushin/db";
import { assertTruncatableTestDatabaseUrl, ownerQuery } from "@mushin/db/testing";
import { createLlm, createProfileScraper, createSerperSearch, createYouTubeSearch, ProviderError } from "@mushin/integrations";
import { evidence, externalAttempts, installNetworkGuard, logger } from "./harness";

afterAll(() => expect(externalAttempts).toEqual([]));
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/db/migrations");
const adminUrl = () => {
  const u = new URL(process.env["TEST_DATABASE_URL"] ?? "");
  u.pathname = "/postgres";
  return u.toString();
};

describe("environment and safety (ENV)", () => {
  it("ENV-01 every migration applies to a brand-new database, and a second run applies nothing", async () => {
    const name = `mushin_disposable_acc_${randomUUID().slice(0, 8)}`;
    const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    try {
      const url = new URL(adminUrl());
      url.pathname = `/${name}`;
      const first = await migrate(url.toString(), { caPem: null });
      const second = await migrate(url.toString(), { caPem: null });
      const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
      evidence("ENV-01", { database: name, applied: first.length, secondRun: second.length, filesInRepo: files.length, last: files.at(-1) });
      expect(first).toHaveLength(files.length);
      expect(second).toEqual([]);
    } finally {
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  it("ENV-02 the test database carries every repository migration with matching checksums", async () => {
    const applied = await ownerQuery<{ name: string }>(`select name from platform.schema_migrations order by name`);
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    evidence("ENV-02", { applied: applied.length, files: files.length });
    expect(applied.map((a) => a.name)).toEqual(files);
  });

  it("ENV-03 the truncating test helpers refuse the frozen evaluation corpus and any non-local database", () => {
    const refusals = ["postgres://postgres@localhost:54330/mushin_eval_disposable", "postgres://postgres@localhost:54330/mushin_corpus_test", "postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres_test"].map((u) => {
      try {
        assertTruncatableTestDatabaseUrl(u);
        return "accepted";
      } catch {
        return "refused";
      }
    });
    evidence("ENV-03", { refusals });
    expect(refusals).toEqual(["refused", "refused", "refused"]);
  });

  it("ENV-04 configuration that mixes Supabase projects is refused at start-up", () => {
    const base = {
      NODE_ENV: "development", DATABASE_URL: "postgres://u:p@localhost:5432/x", SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      JWT_ISSUER: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co/auth/v1", JWKS_URI: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co/auth/v1/.well-known/jwks.json",
      APP_URL: "http://localhost:5173", DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), STAFF_JWT_SECRET: "s".repeat(48),
    };
    let message = "";
    try {
      loadApiConfig(base);
    } catch (err) {
      message = err instanceof ConfigError ? err.message : String(err);
    }
    evidence("ENV-04", { refused: message.length > 0, message: message.slice(0, 200) });
    expect(message).toMatch(/same Supabase project/);
  });

  it("ENV-05 provider adapters with blank keys refuse as not_configured and make no network call", async () => {
    installNetworkGuard();
    let fetches = 0;
    const counting = (async () => {
      fetches++;
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const sink = { record: async () => undefined } as never;
    const guard = { begin: async () => () => undefined };
    const serper = createSerperSearch({ apiKey: null, limit: guard, sink, logger, fetch: counting });
    const youtube = createYouTubeSearch({ apiKey: null, sink, logger, fetch: counting });
    const scraper = createProfileScraper({ apify: null, youtubeApiKey: null, tiktokVideos: 10, spendGuard: guard, sink, logger, fetch: counting });
    const reasons = await Promise.all([
      serper.search({ query: "food lahore", country: "pk", hl: "en", num: 10 } as never).catch((e: unknown) => (e instanceof ProviderError ? e.reason : String(e))),
      youtube.search({ query: "food lahore", type: "video", max: 5 } as never).catch((e: unknown) => (e instanceof ProviderError ? e.reason : String(e))),
      scraper.fetchProfile({ platform: "instagram", handle: "x" } as never).catch((e: unknown) => (e instanceof ProviderError ? e.reason : String(e))),
      scraper.fetchProfile({ platform: "youtube", handle: "x" } as never).catch((e: unknown) => (e instanceof ProviderError ? e.reason : String(e))),
    ]);
    const before = externalAttempts.length;
    const llm = createLlm([], { sink, logger, budget: null });
    const llmOutcome = await llm.complete({ feature: "search_interpret", system: "s", input: "i", schema: { parse: (v: unknown) => v } } as never).then(() => "answered", (e: Error) => e.message.slice(0, 80));
    evidence("ENV-05", { reasons, fetches, llmOutcome, llmExternalAttempts: externalAttempts.length - before });
    expect(reasons).toEqual(["not_configured", "not_configured", "not_configured", "not_configured"]);
    expect(fetches).toBe(0);
    expect(llmOutcome).not.toBe("answered");
    expect(externalAttempts.length - before).toBe(0);
  });
});
