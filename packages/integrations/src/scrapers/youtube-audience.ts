import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented, type CallContext } from "../instrumented";
import { ProviderError } from "./types";

const API = "https://www.googleapis.com/youtube/v3";

/** A recent upload and its top-level comments: the commenter's channel id and the text, held in memory only. */
export type AudienceVideo = { id: string; publishedAt: string | null; commentsOff: boolean; comments: { authorId: string; text: string }[] };
/** `quotaUnits`: the YouTube quota the sample used (1 per read). */
export type YouTubeCommentSample = { channelId: string | null; videosConsidered: number; videos: AudienceVideo[]; quotaUnits: number };
/** `order`: "time" (newest first, the default) or "relevance" (YouTube's top comments). */
export type CommentSampleRequest = { handle: string; maxVideos: number; windowDays: number; commentsPerVideo: number; now: Date; order?: "time" | "relevance"; ctx?: CallContext };

/**
 * Public data for audience estimates (YouTube Data API v3, quota only, $0). Every read costs 1 quota unit. Enabled only
 * where the operator has confirmed MUSHIN may derive metrics from API data (Developer Policies III.E.2, III.E.4.h, L).
 */
export interface YouTubeAudienceSource {
  sampleComments(req: CommentSampleRequest): Promise<YouTubeCommentSample>;
  /** The country each channel declares in its settings, or null; channels the API does not return are absent. */
  channelCountries(req: { channelIds: string[]; ctx?: CallContext }): Promise<{ countries: Map<string, string | null>; quotaUnits: number }>;
}

type Failure = { status: number; text: string };

async function read(doFetch: typeof fetch, url: string, signal: AbortSignal): Promise<unknown | Failure> {
  let res: Response;
  try {
    res = await doFetch(url, { signal });
  } catch (err) {
    throw new ProviderError(true, "provider", `YouTube is unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.ok) return res.json();
  return { status: res.status, text: await res.text() };
}

function raise(f: Failure): never {
  if (f.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(f.text)) throw new ProviderError(false, "quota", "YouTube daily quota used up");
  if (f.status === 400 || f.status === 401 || f.status === 403) throw new ProviderError(false, "not_configured", `YouTube refused the request (HTTP ${f.status})`);
  throw new ProviderError(f.status >= 500 || f.status === 429, "provider", `YouTube answered HTTP ${f.status}`);
}

const isFailure = (v: unknown): v is Failure => typeof v === "object" && v !== null && "status" in v && "text" in v && typeof (v as Failure).status === "number";

export function createYouTubeAudienceSource(o: { apiKey: string | null; sink: ProviderCallSink; logger: Logger; fetch?: typeof fetch }): YouTubeAudienceSource {
  const doFetch = o.fetch ?? fetch;
  const key = () => {
    if (!o.apiKey) throw new ProviderError(false, "not_configured", "YOUTUBE_API_KEY is not set");
    return `key=${encodeURIComponent(o.apiKey)}`;
  };
  /** One quota unit per read, recorded like every other provider call. */
  /** Every attempt is counted (a refused read still uses quota); each request keeps its own counter. */
  const call = <T>(used: { units: number }, operation: string, ctx: CallContext | undefined, fn: (signal: AbortSignal) => Promise<T>) =>
    instrumented<T>(
      { provider: "youtube", operation, timeoutMs: 20_000, retries: 1, sink: o.sink, logger: o.logger, ctx,
        usage: () => ({ model: "youtube-data-v3", units: 1, costUsd: 0 }),
        isRetryable: (err) => !(err instanceof ProviderError) || err.retryable },
      (signal) => {
        used.units += 1;
        return fn(signal);
      },
    );

  return {
    async sampleComments(req) {
      const k = key();
      const used = { units: 0 };
      const channel = await call(used, "audience_channel", req.ctx, async (signal) => {
        const r = await read(doFetch, `${API}/channels?part=contentDetails&forHandle=${encodeURIComponent(req.handle)}&${k}`, signal);
        if (isFailure(r)) raise(r);
        return (r as { items?: { id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }).items?.[0] ?? null;
      });
      const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
      if (!channel?.id || !uploads) return { channelId: channel?.id ?? null, videosConsidered: 0, videos: [], quotaUnits: used.units };
      const since = req.now.getTime() - req.windowDays * 86_400_000;
      const items = await call(used, "audience_uploads", req.ctx, async (signal) => {
        const r = await read(doFetch, `${API}/playlistItems?part=contentDetails&maxResults=${Math.min(50, req.maxVideos)}&playlistId=${encodeURIComponent(uploads)}&${k}`, signal);
        if (isFailure(r)) raise(r);
        return (r as { items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }).items ?? [];
      });
      const recent = items
        .map((i) => ({ id: i.contentDetails?.videoId ?? "", publishedAt: i.contentDetails?.videoPublishedAt ?? null }))
        .filter((v) => /^[\w-]{6,20}$/.test(v.id) && (v.publishedAt === null || Date.parse(v.publishedAt) >= since));
      const videos: AudienceVideo[] = [];
      for (const v of recent) {
        const comments: AudienceVideo["comments"] = [];
        let commentsOff = false;
        let pageToken: string | undefined;
        do {
          const page = await call(used, "audience_comments", req.ctx, async (signal) => {
            const params = new URLSearchParams({ part: "snippet", videoId: v.id, maxResults: String(Math.min(100, req.commentsPerVideo - comments.length)), order: req.order ?? "time", textFormat: "plainText" });
            if (pageToken) params.set("pageToken", pageToken);
            const r = await read(doFetch, `${API}/commentThreads?${params.toString()}&${k}`, signal);
            // Comments turned off (or the video made private since) is a fact about the video, not a failure.
            if (isFailure(r) && (r.status === 403 || r.status === 404) && /commentsDisabled|videoNotFound/.test(r.text)) return null;
            if (isFailure(r)) raise(r);
            return r as { nextPageToken?: string; items?: { snippet?: { topLevelComment?: { snippet?: { authorChannelId?: { value?: string }; textDisplay?: string } } } }[] };
          });
          if (page === null) {
            commentsOff = true;
            break;
          }
          for (const t of page.items ?? []) {
            const s = t.snippet?.topLevelComment?.snippet;
            const authorId = s?.authorChannelId?.value;
            if (authorId) comments.push({ authorId, text: (s?.textDisplay ?? "").slice(0, 500) });
          }
          pageToken = page.nextPageToken;
        } while (pageToken && comments.length < req.commentsPerVideo);
        videos.push({ id: v.id, publishedAt: v.publishedAt, commentsOff, comments });
      }
      return { channelId: channel.id, videosConsidered: items.length, videos, quotaUnits: used.units };
    },

    async channelCountries(req) {
      const k = key();
      const used = { units: 0 };
      const out = new Map<string, string | null>();
      const ids = [...new Set(req.channelIds)].filter((id) => /^[\w-]{10,40}$/.test(id));
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const items = await call(used, "audience_commenter_countries", req.ctx, async (signal) => {
          const r = await read(doFetch, `${API}/channels?part=snippet&maxResults=50&id=${batch.join(",")}&${k}`, signal);
          if (isFailure(r)) raise(r);
          return (r as { items?: { id?: string; snippet?: { country?: string } }[] }).items ?? [];
        });
        // Only the declared country is kept; titles and descriptions in the response are not read.
        for (const it of items) if (it.id) out.set(it.id, typeof it.snippet?.country === "string" && /^[A-Z]{2}$/.test(it.snippet.country) ? it.snippet.country : null);
      }
      return { countries: out, quotaUnits: used.units };
    },
  };
}
