import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { apifyRunCost, type ApifyRun } from "./apify";
import { createProfileScraper, postOwners, splitByHandle } from "./scraper";
import { scraperFixture } from "./testing";
import { ProviderError } from "./types";

const logger = createLogger({ level: "silent" });
/** Runs the budget guard counts as in progress (each must be released once its cost is recorded). */
const inFlight = { n: 0 };
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
      begin: async () => {
        if (o.budgetOk === false) throw new ProviderError(false, "spend_cap", "Monthly Apify budget reached");
        inFlight.n += 1;
        return () => void (inFlight.n -= 1);
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

  // Measured 2026-10-13: settled pay-per-event runs report usageTotalUsd equal to their event charges (e.g. 24 TikTok
  // results: 0.072 and 24 × 0.003); adding both recorded 0.638 USD for runs Apify billed at 0.380.
  it("does not count a settled run's event charges twice", () => {
    const tt = run("apify-run-tiktok.json");
    const settled = { ...tt, usageTotalUsd: 0.018, chargedEventCounts: { result: 6 } };
    expect(apifyRunCost(settled, 6)).toBeCloseTo(0.018, 6);
    expect(apifyRunCost({ ...settled, usageTotalUsd: 0 }, 6)).toBeCloseTo(0.018, 6);
  });

  it("prices tiered pay-per-event actors at the highest tier when the run has not settled", () => {
    const tiered = { id: "r", status: "SUCCEEDED", defaultDatasetId: "d", usageTotalUsd: 0, chargedEventCounts: { result: 12 },
      pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { result: { isPrimaryEvent: true, eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: 0.0027 }, GOLD: { tieredEventPriceUsd: 0.0015 } } } } } } };
    expect(apifyRunCost(tiered, 12)).toBeCloseTo(0.0324, 6);
    expect(apifyRunCost({ ...tiered, chargedEventCounts: {} }, 12)).toBeCloseTo(0.0324, 6);
    expect(apifyRunCost({ ...tiered, usageTotalUsd: 0.03 }, 12)).toBeCloseTo(0.0324, 6);
  });
});

describe("Instagram post owners", () => {
  it("maps each post link to the owner the provider reported for that exact post, and never guesses", () => {
    const urls = ["https://www.instagram.com/reel/DTGCHjfjDuY/", "https://www.instagram.com/p/DaDb8TLjEAJ/", "https://www.instagram.com/p/Missing123/"];
    const items = [
      { shortCode: "DTGCHjfjDuY", ownerUsername: "Aizah_Fit" },
      { url: "https://www.instagram.com/p/DaDb8TLjEAJ/", ownerUsername: "aboutaqsa" },
      { shortCode: "Other999", ownerUsername: "someone_else" },
      { shortCode: "DaDb8TLjEAJ", ownerUsername: "not a <handle>" },
    ];
    expect(postOwners(urls, items)).toEqual([
      { url: urls[0], owner: "aizah_fit" },
      { url: urls[1], owner: "aboutaqsa" },
      { url: urls[2], owner: null },
    ]);
    expect(postOwners(urls, "not a list").every((o) => o.owner === null)).toBe(true);
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
    expect(inFlight.n).toBe(0);
  });

  it("pins an Instagram run to the configured build instead of the moving latest tag", async () => {
    const { fetch, calls } = fakeFetch(apifyRoutes(scraperFixture("instagram-profile.json"), "apify-run-instagram.json"));
    const pinned = createProfileScraper({
      apify: { token: "t", instagramActor: "apify/instagram-profile-scraper", instagramBuild: "0.0.634", tiktokActor: "clockworks/tiktok-profile-scraper" },
      youtubeApiKey: "yt", tiktokVideos: 6,
      spendGuard: { begin: async () => () => {} }, sink: new MemoryProviderCallSink(), logger, fetch, sleep: async () => {},
    });
    await pinned.fetchProfile({ platform: "instagram", handle: "coke_studio" });
    expect(calls[0]?.url).toContain("build=0.0.634");
  });

  it("pins TikTok runs to the configured immutable build", async () => {
    const { fetch, calls } = fakeFetch(apifyRoutes(scraperFixture("tiktok-videos.json"), "apify-run-tiktok.json"));
    const pinned = createProfileScraper({
      apify: { token: "t", instagramActor: "apify/instagram-profile-scraper", tiktokActor: "clockworks/tiktok-profile-scraper", tiktokBuild: "0.99.2065" },
      youtubeApiKey: "yt", tiktokVideos: 3,
      spendGuard: { begin: async () => () => {} }, sink: new MemoryProviderCallSink(), logger, fetch, sleep: async () => {},
    });
    await pinned.fetchProfile({ platform: "tiktok", handle: "cokestudiopakistan" });
    expect(calls[0]?.url).toContain("build=0.99.2065");
    expect(calls[0]?.body).toMatchObject({ resultsPerPage: 3, shouldDownloadVideos: false });
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
    expect(inFlight.n).toBe(0);
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

  it("fetches many Instagram profiles in one Apify run and splits the items by handle", async () => {
    const one = (scraperFixture("instagram-profile.json") as Record<string, unknown>[])[0] ?? {};
    const items = [{ ...one, username: "first_one" }, { ...one, username: "Second_One" }];
    const { fetch, calls } = fakeFetch(apifyRoutes(items, "apify-run-instagram.json"));
    const { s, sink } = scraper(fetch);
    const out = await s.fetchProfiles({ platform: "instagram", handles: ["first_one", "second_one", "missing_one"] });
    expect(calls[0]?.body).toEqual({ usernames: ["first_one", "second_one", "missing_one"] });
    expect(out.profiles.map((p) => [p.handle, (p.raw as unknown[]).length])).toEqual([["first_one", 1], ["second_one", 1], ["missing_one", 0]]);
    expect(sink.calls).toHaveLength(1);
    expect(inFlight.n).toBe(0);
  });

  it("splits TikTok video items by the requested profile", () => {
    const v = (scraperFixture("tiktok-videos.json") as Record<string, unknown>[])[0] ?? {};
    const items = [
      { ...v, input: "a_one", authorMeta: { name: "a_one" } },
      { ...v, input: "a_one", authorMeta: { name: "a_one" } },
      { ...v, input: "b_two", authorMeta: { name: "b_two" } },
    ];
    expect(splitByHandle("tiktok", items, ["a_one", "b_two", "c_three"]).map((p) => (p.raw as unknown[]).length)).toEqual([2, 1, 0]);
    const mismatch = splitByHandle("tiktok", [{ ...v, input: "a_one", authorMeta: { name: "other_person" } }], ["a_one"]);
    expect(mismatch[0]?.raw).toEqual([]);
  });

  it("reads YouTube channels one by one for free", async () => {
    const { fetch } = fakeFetch((c) => {
      if (c.url.includes("/channels?")) return Response.json(scraperFixture("youtube-channel.json"));
      if (c.url.includes("/playlistItems?")) return Response.json(scraperFixture("youtube-playlist.json"));
      return Response.json(scraperFixture("youtube-videos.json"));
    });
    const out = await scraper(fetch).s.fetchProfiles({ platform: "youtube", handles: ["@cokestudio", "other"] });
    expect(out).toMatchObject({ provider: "youtube", costUsd: 0 });
    expect(out.profiles.map((p) => p.handle)).toEqual(["cokestudio", "other"]);
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
