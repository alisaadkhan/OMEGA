import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createYouTubeSearch } from "./youtube-search";

const logger = createLogger({ level: "silent" });

function fakeFetch(search: unknown, channels: unknown, status = 200) {
  const urls: string[] = [];
  const f = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (status !== 200) return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status });
    return new Response(JSON.stringify(url.includes("/search?") ? search : channels), { status: 200 });
  };
  return { fetch: f as typeof fetch, urls };
}

describe("YouTube-native search", () => {
  it("returns each channel once as an @handle link with the video as topic evidence, and records quota use", async () => {
    const { fetch, urls } = fakeFetch(
      { items: [
        { id: { videoId: "v1" }, snippet: { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Tech Urdu", title: "Tecno Pova review in Urdu", description: "Budget phone" } },
        { id: { videoId: "v2" }, snippet: { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Tech Urdu", title: "Second video", description: "" } },
        { id: { videoId: "v3" }, snippet: { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", channelTitle: "No Handle", title: "x", description: "" } },
      ] },
      { items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", snippet: { title: "Tech Urdu", customUrl: "@TechUrdu" } }, { id: "UCbbbbbbbbbbbbbbbbbbbbbb", snippet: { title: "No Handle" } }] },
    );
    const sink = new MemoryProviderCallSink();
    const yt = createYouTubeSearch({ apiKey: "k", sink, logger, fetch });
    const out = await yt.search({ query: "budget phones review", type: "video", regionCode: "pk", relevanceLanguage: "ur" });
    expect(out).toEqual([{ title: "Tech Urdu - Tecno Pova review in Urdu", link: "https://www.youtube.com/@TechUrdu", snippet: "Tecno Pova review in Urdu. Budget phone" }]);
    expect(urls[0]).toContain("regionCode=PK");
    expect(urls[0]).toContain("relevanceLanguage=ur");
    expect(urls[1]).toContain("id=UCaaaaaaaaaaaaaaaaaaaaaa,UCbbbbbbbbbbbbbbbbbbbbbb");
    expect(sink.calls).toMatchObject([{ provider: "youtube", operation: "search_youtube_video", units: 101, costUsd: 0, status: "ok" }]);
  });

  it("reports a used-up quota as a non-retryable quota error", async () => {
    const { fetch } = fakeFetch({}, {}, 403);
    const yt = createYouTubeSearch({ apiKey: "k", sink: new MemoryProviderCallSink(), logger, fetch });
    await expect(yt.search({ query: "x", type: "channel" })).rejects.toMatchObject({ reason: "quota", retryable: false });
  });
});
