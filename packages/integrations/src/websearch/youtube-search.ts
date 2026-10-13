import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented, type CallContext } from "../instrumented";
import { ProviderError } from "../scrapers/types";
import type { WebResult } from "./types";

export type YouTubeSearchQuery = { query: string; type: "channel" | "video"; regionCode?: string; relevanceLanguage?: string; max?: number; publishedAfter?: Date; ctx?: CallContext };
export type YouTubeSearch = { search(q: YouTubeSearchQuery): Promise<WebResult[]> };

const API = "https://www.googleapis.com/youtube/v3";
/** search.list costs 100 quota units and channels.list 1 (YouTube Data API v3; the free daily quota is 10,000). */
export const YOUTUBE_SEARCH_UNITS = 101;

type SearchItem = { id?: { channelId?: string; videoId?: string }; snippet?: { channelId?: string; channelTitle?: string; title?: string; description?: string } };
type ChannelItem = { id?: string; snippet?: { title?: string; description?: string; customUrl?: string; country?: string } };

async function getJson(doFetch: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const res = await doFetch(url, { signal });
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(text)) throw new ProviderError(false, "quota", "YouTube daily quota used up");
  if (res.status === 400 || res.status === 403) throw Object.assign(new ProviderError(false, "not_configured", `YouTube refused the search (HTTP ${res.status})`), { status: res.status });
  throw Object.assign(new ProviderError(res.status >= 500, "provider", `YouTube answered HTTP ${res.status}`), { status: res.status });
}

/**
 * YouTube-native discovery. Channel or video search, then the channels' @handles: each result is shaped like a web search
 * result linking to youtube.com/@handle, so it flows through the same normalization, gates and decision trail. A video
 * result carries the video's title and description as topic evidence. `regionCode` only biases ranking; it is never
 * evidence of where a creator lives, and channels without an @handle are skipped (profiles are fetched by handle).
 */
export function createYouTubeSearch(o: { apiKey: string | null; sink: ProviderCallSink; logger: Logger; fetch?: typeof fetch }): YouTubeSearch {
  const doFetch = o.fetch ?? fetch;
  return {
    async search(q) {
      const apiKey = o.apiKey;
      if (!apiKey) throw new ProviderError(false, "not_configured", "YOUTUBE_API_KEY is not set");
      const key = `key=${encodeURIComponent(apiKey)}`;
      return instrumented<WebResult[]>(
        { provider: "youtube", operation: `search_youtube_${q.type}`, timeoutMs: 20_000, retries: 1, sink: o.sink, logger: o.logger, ctx: q.ctx,
          usage: () => ({ model: "youtube-data-v3", units: YOUTUBE_SEARCH_UNITS, costUsd: 0 }),
          isRetryable: (err) => !(err instanceof ProviderError) || err.retryable },
        async (signal) => {
          const params = new URLSearchParams({ part: "snippet", type: q.type, q: q.query.slice(0, 200), maxResults: String(Math.min(50, q.max ?? 25)) });
          if (q.regionCode) params.set("regionCode", q.regionCode.toUpperCase());
          if (q.relevanceLanguage) params.set("relevanceLanguage", q.relevanceLanguage);
          if (q.publishedAfter) params.set("publishedAfter", q.publishedAfter.toISOString().replace(/\.\d{3}Z$/, "Z"));
          const found = (await getJson(doFetch, `${API}/search?${params.toString()}&${key}`, signal)) as { items?: SearchItem[] };
          const items = found.items ?? [];
          const ids = [...new Set(items.map((i) => i.snippet?.channelId ?? i.id?.channelId).filter((id): id is string => typeof id === "string" && /^[\w-]{10,40}$/.test(id)))].slice(0, 50);
          if (ids.length === 0) return [];
          const channels = ((await getJson(doFetch, `${API}/channels?part=snippet&id=${ids.join(",")}&${key}`, signal)) as { items?: ChannelItem[] }).items ?? [];
          const byId = new Map(channels.map((c) => [c.id ?? "", c]));
          const out: WebResult[] = [];
          const seen = new Set<string>();
          for (const i of items) {
            const channelId = i.snippet?.channelId ?? i.id?.channelId ?? "";
            const ch = byId.get(channelId);
            const handle = ch?.snippet?.customUrl;
            if (!handle || !/^@[\w.-]{1,100}$/.test(handle) || seen.has(handle.toLowerCase())) continue;
            seen.add(handle.toLowerCase());
            const channelTitle = ch?.snippet?.title ?? i.snippet?.channelTitle ?? "";
            const evidence = q.type === "video" ? `${i.snippet?.title ?? ""}. ${i.snippet?.description ?? ""}` : (ch?.snippet?.description ?? i.snippet?.description ?? "");
            out.push({
              title: (q.type === "video" ? `${channelTitle} - ${i.snippet?.title ?? ""}` : channelTitle).slice(0, 300),
              link: `https://www.youtube.com/${handle}`.slice(0, 500),
              snippet: evidence.replace(/\s+/g, " ").trim().slice(0, 500),
            });
          }
          return out;
        },
      ).catch((err: unknown) => {
        for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) throw e;
        throw new ProviderError(true, "provider", err instanceof Error ? err.message : String(err));
      });
    },
  };
}
