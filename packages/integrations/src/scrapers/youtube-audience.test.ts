import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createYouTubeAudienceSource } from "./youtube-audience";
import { ProviderError } from "./types";

const logger = createLogger({ level: "silent" });
const now = new Date("2026-10-13T00:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Routes each API path to a handler; records every URL requested. */
function fake(routes: Record<string, (url: URL) => Response>) {
  const urls: URL[] = [];
  const f = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    const path = url.pathname.split("/").pop() ?? "";
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected ${path}`);
    return handler(url);
  };
  return { fetch: f as typeof fetch, urls };
}

const channel = () => json({ items: [{ id: "UCowner000000000000000", contentDetails: { relatedPlaylists: { uploads: "UUowner" } } }] });
const uploads = () =>
  json({ items: [
    { contentDetails: { videoId: "vid_recent1", videoPublishedAt: "2026-10-01T00:00:00Z" } },
    { contentDetails: { videoId: "vid_off0001", videoPublishedAt: "2026-09-01T00:00:00Z" } },
    { contentDetails: { videoId: "vid_old0001", videoPublishedAt: "2025-01-01T00:00:00Z" } },
  ] });
const thread = (author: string, text: string) => ({ snippet: { topLevelComment: { snippet: { authorChannelId: { value: author }, textDisplay: text } } } });

describe("YouTube audience source", () => {
  it("samples recent uploads' comments page by page, treats disabled comments as a fact and counts quota", async () => {
    const { fetch, urls } = fake({
      channels: channel,
      playlistItems: uploads,
      commentThreads: (u) => {
        if (u.searchParams.get("videoId") === "vid_off0001") return json({ error: { errors: [{ reason: "commentsDisabled" }] } }, 403);
        return u.searchParams.get("pageToken")
          ? json({ items: [thread("UCc", "third")] })
          : json({ nextPageToken: "p2", items: [thread("UCa", "first"), thread("UCb", "second")] });
      },
    });
    const sink = new MemoryProviderCallSink();
    const src = createYouTubeAudienceSource({ apiKey: "k", sink, logger, fetch });
    const s = await src.sampleComments({ handle: "@creator", maxVideos: 12, windowDays: 180, commentsPerVideo: 100, now });
    expect(s.channelId).toBe("UCowner000000000000000");
    expect(s.videosConsidered).toBe(3);
    // The 2025 upload is outside the window and never read.
    expect(s.videos.map((v) => [v.id, v.commentsOff, v.comments.map((c) => c.authorId)])).toEqual([
      ["vid_recent1", false, ["UCa", "UCb", "UCc"]],
      ["vid_off0001", true, []],
    ]);
    expect(urls.some((u) => u.searchParams.get("videoId") === "vid_old0001")).toBe(false);
    expect(urls[0]?.searchParams.get("forHandle")).toBe("@creator");
    expect(s.quotaUnits).toBe(5); // channel, uploads, 2 comment pages, 1 refused page
    expect(sink.calls.every((c) => c.provider === "youtube" && c.costUsd === 0)).toBe(true);
  });

  it("reads only the declared country of commenters, 50 per request", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `UC${String(i).padStart(20, "0")}`);
    const { fetch, urls } = fake({
      channels: (u) => json({ items: (u.searchParams.get("id") ?? "").split(",").map((id, i) => ({ id, snippet: { title: "Name", description: "bio", country: i % 3 === 0 ? "PK" : i % 3 === 1 ? undefined : "pk" } })) }),
    });
    const src = createYouTubeAudienceSource({ apiKey: "k", sink: new MemoryProviderCallSink(), logger, fetch });
    const r = await src.channelCountries({ channelIds: [...ids, ids[0] ?? "", "bad id"] });
    expect(urls).toHaveLength(2);
    expect(r.quotaUnits).toBe(2);
    expect(r.countries.size).toBe(60);
    expect(r.countries.get(ids[0] ?? "")).toBe("PK");
    expect(r.countries.get(ids[1] ?? "")).toBeNull();
    expect(r.countries.get(ids[2] ?? "")).toBeNull(); // not an ISO code
  });

  it("fails without retrying when the key is missing or the daily quota is used up", async () => {
    const off = createYouTubeAudienceSource({ apiKey: null, sink: new MemoryProviderCallSink(), logger });
    await expect(off.sampleComments({ handle: "@x", maxVideos: 1, windowDays: 1, commentsPerVideo: 1, now })).rejects.toMatchObject({ reason: "not_configured", retryable: false });
    const { fetch } = fake({ channels: () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403) });
    const src = createYouTubeAudienceSource({ apiKey: "k", sink: new MemoryProviderCallSink(), logger, fetch });
    const err = await src.sampleComments({ handle: "@x", maxVideos: 1, windowDays: 1, commentsPerVideo: 1, now }).catch((e: unknown) => e);
    // instrumented() wraps provider failures; the ProviderError rides along as the cause, as for every adapter.
    const cause = (err as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ProviderError);
    expect(cause).toMatchObject({ reason: "quota", retryable: false });
  });

  it("returns an empty sample for an unknown handle", async () => {
    const { fetch } = fake({ channels: () => json({ items: [] }) });
    const src = createYouTubeAudienceSource({ apiKey: "k", sink: new MemoryProviderCallSink(), logger, fetch });
    expect(await src.sampleComments({ handle: "@nobody", maxVideos: 1, windowDays: 1, commentsPerVideo: 1, now })).toEqual({ channelId: null, videosConsidered: 0, videos: [], quotaUnits: 1 });
  });
});
