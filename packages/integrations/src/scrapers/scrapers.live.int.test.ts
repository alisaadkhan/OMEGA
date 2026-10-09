import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createObjectStorage, RAW_PAYLOAD_BUCKET } from "../storage";
import { createBudgetGuard } from "./guard";
import { createProfileScraper } from "./scraper";

// Spends about $0.02 of Apify (spec §10). Run: LIVE_SCRAPE_TESTS=1 npx vitest run --project int packages/integrations/src/scrapers/scrapers.live.int.test.ts
describe.skipIf(process.env["LIVE_SCRAPE_TESTS"] !== "1")("live scrapers and storage (LIVE_SCRAPE_TESTS=1)", () => {
  const config = loadWorkerConfig(process.env);
  const logger = createLogger({ level: "silent" });
  const sink = new MemoryProviderCallSink();
  const scraper = createProfileScraper({
    apify: config.scraping.apifyToken ? { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, tiktokActor: config.scraping.tiktokActor } : null,
    youtubeApiKey: config.scraping.youtubeApiKey,
    tiktokVideos: 3,
    youtubeVideos: 3,
    spendGuard: createBudgetGuard({ budgetUsd: config.scraping.apifyMonthlyBudgetUsd, spentSince: async () => 0 }),
    sink,
    logger,
  });

  it("scrapes one public profile per platform and records the cost", async () => {
    const ig = await scraper.fetchProfile({ platform: "instagram", handle: "coke_studio" });
    expect((ig.raw as { username?: string }[])[0]?.username).toBe("coke_studio");
    const tt = await scraper.fetchProfile({ platform: "tiktok", handle: "@cokestudiopakistan" });
    expect((tt.raw as { authorMeta?: { name?: string } }[])[0]?.authorMeta?.name).toBe("cokestudiopakistan");
    const yt = await scraper.fetchProfile({ platform: "youtube", handle: "@cokestudio" });
    expect((yt.raw as { channel: { items?: unknown[] } }).channel.items).toHaveLength(1);
    expect(sink.calls.filter((c) => c.status === "ok")).toHaveLength(3);
  }, 600_000);

  it("round-trips an object through Supabase Storage", async () => {
    const storage = createObjectStorage(config.storage, logger);
    if (!storage) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required");
    await storage.ensureBucket(RAW_PAYLOAD_BUCKET, { public: false });
    const key = `live-check/${randomUUID()}.json`;
    await storage.put(RAW_PAYLOAD_BUCKET, key, '{"ok":true}', "application/json");
    expect(new TextDecoder().decode((await storage.get(RAW_PAYLOAD_BUCKET, key)) ?? new Uint8Array())).toBe('{"ok":true}');
    await storage.remove(RAW_PAYLOAD_BUCKET, [key]);
    expect(await storage.get(RAW_PAYLOAD_BUCKET, key)).toBeNull();
  }, 60_000);
});
