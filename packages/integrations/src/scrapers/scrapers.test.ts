import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { apifyRunCost, type ApifyRun } from "./apify";
import { createProfileScraper } from "./scraper";
import { scraperFixture } from "./testing";
import { ProviderError } from "./types";

const logger = createLogger({ level: "silent" });
type Call = { url: string; method: string; body: unknown };

function fakeFetch(routes: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return routes(call);
  };
  return { fetch: f as typeof fetch, calls };
}

const run = (name: string) => scraperFixture(name) as ApifyRun;

function apifyRoutes(items: unknown, runFixture: string) {
  return (c: Call) => {
    if (c.url.includes("/runs?")) return Response.json({ data: { ...run(runFixture), status: "RUNNING" } }, { status: 201 });
    if (c.url.includes("/actor-runs/")) return Response.json({ data: run(runFixture) });
    if (c.url.includes("/datasets/")) return Response.json(items);
    return new Response("unexpected", { status: 500 });
  };
}

function scraper(fetchImpl: typeof fetch, o: { budgetOk?: boolean; apify?: boolean; youtube?: boolean; apifyMaxWaitMs?: number } = {}) {
  const sink = new MemoryProviderCallSink();
  const s = createProfileScraper({
    apify: o.apify === false ? null : { token: "t", instagramActor: "apify/instagram-profile-scraper", tiktokActor: "clockworks/tiktok-profile-scraper" },
    youtubeApiKey: o.youtube === false ? null : "yt",
    tiktokVideos: 6,
    spendGuard: {
      assertWithinBudget: async () => {
        if (o.budgetOk === false) throw new ProviderError(false, "spend_cap", "Monthly Apify budget reached");
      },
    },
    sink,
    logger,
    fetch: fetchImpl,
    sleep: async () => {},
    ...(o.apifyMaxWaitMs !== undefined ? { apifyMaxWaitMs: o.apifyMaxWaitMs } : {}),
  });
  return { s, sink };
}

describe("Apify cost", () => {
  it("prices pay-per-event runs from charged events, or from items when the free tier reports none", () => {
    const ig = run("apify-run-instagram.json");
    expect(apifyRunCost(ig, 1)).toBeCloseTo(0.0026, 6);
    const tt = run("apify-run-tiktok.json");
    expect(apifyRunCost(tt, 6)).toBeCloseTo(0.018, 6);
    expect(apifyRunCost({ ...tt, usageTotalUsd: 0.5, chargedEventCounts: {} }, 0)).toBe(0.5);
  });
});

describe("profile scraper", () => {
  it("runs the Instagram actor for the username and records the cost", async () => {
    const { fetch, calls } = fakeFetch(apifyRoutes(scraperFixture("instagram-profile.json"), "apify-run-instagram.json"));
    const { s, sink } = scraper(fetch);
    const out = await s.fetchProfile({ platform: "instagram", handle: "coke_studio" });
    expect(out.provider).toBe("apify");
    expect(Array.isArray(out.raw) && (out.raw as { username: string }[])[0]?.username).toBe("coke_studio");
    expect(calls[0]).toMatchObject({ method: "POST", body: { usernames: ["coke_studio"] } });
    expect(calls[0]?.url).toContain("/v2/acts/apify~instagram-profile-scraper/runs?");
    expect(sink.calls).toEqual([expect.objectContaining({ provider: "apify", operation: "scrape_instagram", status: "ok", costUsd: 0.0026 })]);
  });

  it("asks the TikTok actor for the configured number of videos without downloads", async () => {
    const { fetch, calls } = fakeFetch(apifyRoutes(scraperFixture("tiktok-videos.json"), "apify-run-tiktok.json"));
    const { s, sink } = scraper(fetch);
    await s.fetchProfile({ platform: "tiktok", handle: "@cokestudiopakistan" });
    expect(calls[0]?.body).toEqual({
      profiles: ["cokestudiopakistan"],
      resultsPerPage: 6,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      shouldDownloadSubtitles: false,
    });
    expect(sink.calls[0]?.costUsd).toBeCloseTo(0.018, 6);
  });

  it("refuses Apify work over the monthly budget before any call", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const { s } = scraper(fetch, { budgetOk: false });
    await expect(s.fetchProfile({ platform: "instagram", handle: "x" })).rejects.toMatchObject({ reason: "spend_cap", retryable: false });
    expect(calls).toHaveLength(0);
  });

  it("treats a failed Apify run and a 5xx as retryable, and a bad token as not retryable", async () => {
    const failed = fakeFetch((c) => (c.url.includes("/runs?") ? Response.json({ data: { ...run("apify-run-instagram.json"), status: "FAILED" } }, { status: 201 }) : Response.json({})));
    await expect(scraper(failed.fetch).s.fetchProfile({ platform: "instagram", handle: "x" })).rejects.toSatisfy(isProviderError(true));
    const down = fakeFetch(() => new Response("bad gateway", { status: 502 }));
    await expect(scraper(down.fetch).s.fetchProfile({ platform: "instagram", handle: "x" })).rejects.toSatisfy(isProviderError(true));
    const badToken = fakeFetch(() => Response.json({ error: { type: "user-or-token-not-found" } }, { status: 401 }));
    await expect(scraper(badToken.fetch).s.fetchProfile({ platform: "instagram", handle: "x" })).rejects.toSatisfy(isProviderError(false));
  });

  it("records what a failed run was charged, so the spend cap still counts it", async () => {
    const { fetch } = fakeFetch((c) => {
      if (c.url.includes("/runs?")) return Response.json({ data: { ...run("apify-run-instagram.json"), status: "RUNNING" } }, { status: 201 });
      if (c.url.includes("/actor-runs/")) return Response.json({ data: { ...run("apify-run-instagram.json"), status: "FAILED" } });
      if (c.url.includes("/datasets/")) return Response.json({ data: { itemCount: 1 } });
      return new Response("unexpected", { status: 500 });
    });
    const { s, sink } = scraper(fetch);
    await expect(s.fetchProfile({ platform: "instagram", handle: "x" })).rejects.toSatisfy(isProviderError(true));
    expect(sink.calls).toContainEqual(expect.objectContaining({ provider: "apify", status: "error", errorCode: "charged_failure", costUsd: 0.0026 }));
  });

  it("aborts a run that takes too long instead of leaving it running, and records its cost", async () => {
    const aborted: string[] = [];
    const { fetch } = fakeFetch((c) => {
      if (c.url.includes("/runs?")) return Response.json({ data: { ...run("apify-run-tiktok.json"), status: "RUNNING" } }, { status: 201 });
      if (c.url.endsWith("/abort")) {
        aborted.push(c.url);
        return Response.json({ data: { ...run("apify-run-tiktok.json"), status: "ABORTED", chargedEventCounts: { result: 2 } } });
      }
      if (c.url.includes("/actor-runs/")) return Response.json({ data: { ...run("apify-run-tiktok.json"), status: "RUNNING" } });
      if (c.url.includes("/datasets/")) return Response.json({ data: { itemCount: 2 } });
      return new Response("unexpected", { status: 500 });
    });
    const { s, sink } = scraper(fetch, { apifyMaxWaitMs: 0 });
    await expect(s.fetchProfile({ platform: "tiktok", handle: "@x" })).rejects.toSatisfy(isProviderError(true));
    expect(aborted).toEqual(["https://api.apify.com/v2/actor-runs/run-1/abort"]);
    expect(sink.calls).toContainEqual(expect.objectContaining({ status: "error", errorCode: "charged_failure", costUsd: 0.006 }));
  });

  it("reads a YouTube channel and its latest videos with three API calls and no cost", async () => {
    const { fetch, calls } = fakeFetch((c) => {
      if (c.url.includes("/channels?")) return Response.json(scraperFixture("youtube-channel.json"));
      if (c.url.includes("/playlistItems?")) return Response.json(scraperFixture("youtube-playlist.json"));
      if (c.url.includes("/videos?")) return Response.json(scraperFixture("youtube-videos.json"));
      return new Response("unexpected", { status: 500 });
    });
    const { s, sink } = scraper(fetch);
    const out = await s.fetchProfile({ platform: "youtube", handle: "@cokestudio" });
    expect(out).toMatchObject({ provider: "youtube", costUsd: 0 });
    expect((out.raw as { channel: unknown; videos: unknown }).videos).toBeDefined();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/youtube/v3/channels", "/youtube/v3/playlistItems", "/youtube/v3/videos"]);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("forHandle")).toBe("@cokestudio");
    expect(sink.calls[0]).toMatchObject({ provider: "youtube", operation: "scrape_youtube", units: 3, costUsd: 0 });
  });

  it("returns the empty channel answer for an unknown YouTube handle, and reports quota as not retryable", async () => {
    const empty = fakeFetch(() => Response.json(scraperFixture("youtube-notfound.json")));
    const out = await scraper(empty.fetch).s.fetchProfile({ platform: "youtube", handle: "@nobody" });
    expect(out.raw).toEqual({ channel: scraperFixture("youtube-notfound.json"), videos: null });
    const quota = fakeFetch(() => Response.json({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, { status: 403 }));
    await expect(scraper(quota.fetch).s.fetchProfile({ platform: "youtube", handle: "@x" })).rejects.toMatchObject({ reason: "quota", retryable: false });
  });

  it("refuses platforms whose keys are not configured", async () => {
    const { fetch } = fakeFetch(() => Response.json({}));
    await expect(scraper(fetch, { apify: false }).s.fetchProfile({ platform: "tiktok", handle: "@x" })).rejects.toMatchObject({ reason: "not_configured" });
    await expect(scraper(fetch, { youtube: false }).s.fetchProfile({ platform: "youtube", handle: "@x" })).rejects.toMatchObject({ reason: "not_configured" });
  });
});

function isProviderError(retryable: boolean) {
  return (err: unknown) => {
    for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e.retryable === retryable;
    return false;
  };
}
