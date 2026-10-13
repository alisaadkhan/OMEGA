import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { createApifyClient } from "./apify";
import { ProviderError, type ProfileScraper, type ScrapeRequest, type ScrapeResult, type SpendGuard } from "./types";
import { fetchYouTubeChannel } from "./youtube";

type Options = {
  apify: { token: string; instagramActor: string; tiktokActor: string; instagramBuild?: string; tiktokBuild?: string } | null;
  youtubeApiKey: string | null;
  tiktokVideos: number;
  youtubeVideos?: number;
  spendGuard: SpendGuard;
  sink: ProviderCallSink;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for an Apify run before stopping it (default 180 s). */
  apifyMaxWaitMs?: number;
};

const NO_DOWNLOADS = { shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false, shouldDownloadSubtitles: false };

/** Apify returns one list for a batch: Instagram items carry `username`, TikTok video items carry `input` (the requested profile). */
export function splitByHandle(platform: "instagram" | "tiktok", items: unknown, handles: string[]): { handle: string; raw: unknown[] }[] {
  const keyOf = (it: unknown): string | null => {
    if (typeof it !== "object" || it === null) return null;
    const r = it as Record<string, unknown>;
    if (platform === "instagram") {
      if (typeof r["username"] === "string") return r["username"].toLowerCase();
      const url = r["inputUrl"] ?? r["url"];
      return typeof url === "string" ? (url.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase() : null;
    }
    if (typeof r["input"] === "string") return r["input"].replace(/^@/, "").toLowerCase();
    const author = r["authorMeta"];
    const name = typeof author === "object" && author !== null ? (author as Record<string, unknown>)["name"] : undefined;
    return typeof name === "string" ? name.toLowerCase() : null;
  };
  const groups = new Map<string, unknown[]>(handles.map((h) => [h, []]));
  for (const it of Array.isArray(items) ? items : []) {
    const k = keyOf(it);
    if (k !== null) groups.get(k)?.push(it);
  }
  return handles.map((h) => ({ handle: h, raw: groups.get(h) ?? [] }));
}

/** Job-level retries decide whether to try again (spec §5.2), so the adapter itself makes one attempt. */
export function createProfileScraper(o: Options): ProfileScraper {
  const apify = o.apify
    ? createApifyClient({
        token: o.apify.token,
        ...(o.fetch ? { fetch: o.fetch } : {}),
        ...(o.sleep ? { sleep: o.sleep } : {}),
        ...(o.apifyMaxWaitMs !== undefined ? { maxWaitMs: o.apifyMaxWaitMs } : {}),
      })
    : null;

  async function viaApify(req: ScrapeRequest, actor: string, input: unknown, units = 1, maxWaitMs?: number, build?: string): Promise<ScrapeResult> {
    if (!apify) throw new ProviderError(false, "not_configured", "APIFY_TOKEN is not set");
    const done = await o.spendGuard.begin(units);
    try {
      return await runApify(req, actor, input, apify, maxWaitMs, build);
    } finally {
      done();
    }
  }

  async function runApify(req: ScrapeRequest, actor: string, input: unknown, apify: ReturnType<typeof createApifyClient>, maxWaitMs?: number, build?: string): Promise<ScrapeResult> {
    const out = await instrumented(
      {
        provider: "apify",
        operation: `scrape_${req.platform}`,
        timeoutMs: (maxWaitMs ?? 180_000) + 60_000,
        retries: 0,
        sink: o.sink,
        logger: o.logger,
        ctx: req.ctx,
        usage: (r: { items: unknown[]; costUsd: number }) => ({ model: actor, units: r.items.length, costUsd: r.costUsd }),
      },
      () => apify.runActor(actor, input, { ...(maxWaitMs === undefined ? {} : { maxWaitMs }), ...(build ? { build } : {}) }),
    ).catch(async (err: unknown) => {
      // A failed run can still have been charged; record it so the monthly spend cap counts it (spec §4).
      const pe = providerErrorOf(err);
      if (pe && pe.costUsd > 0) {
        await o.sink
          .record({
            provider: "apify",
            operation: `scrape_${req.platform}`,
            model: actor,
            tokensIn: null,
            tokensOut: null,
            units: null,
            costUsd: pe.costUsd,
            latencyMs: 0,
            status: "error",
            errorCode: "charged_failure",
            workspaceId: req.ctx?.workspaceId ?? null,
            jobId: req.ctx?.jobId ?? null,
            requestId: req.ctx?.requestId ?? null,
          })
          .catch((recordErr: unknown) => o.logger.error({ err: recordErr }, "could not record a failed Apify run's cost"));
      }
      return unwrap(err);
    });
    return { provider: "apify", raw: out.items, costUsd: out.costUsd };
  }

  async function youtubeProfile(req: ScrapeRequest): Promise<ScrapeResult> {
    const key = o.youtubeApiKey;
    if (!key) throw new ProviderError(false, "not_configured", "YOUTUBE_API_KEY is not set");
    const raw = await instrumented(
      {
        provider: "youtube",
        operation: "scrape_youtube",
        timeoutMs: 30_000,
        retries: 0,
        sink: o.sink,
        logger: o.logger,
        ctx: req.ctx,
        usage: () => ({ model: "youtube-data-v3", units: 3, costUsd: 0 }),
      },
      // Jobs store handles without "@"; the API looks channels up by their @handle.
      () => fetchYouTubeChannel({ apiKey: key, handle: req.handle.startsWith("@") ? req.handle : `@${req.handle}`, recentVideos: o.youtubeVideos ?? 12, ...(o.fetch ? { fetch: o.fetch } : {}) }),
    ).catch(unwrap);
    return { provider: "youtube", raw, costUsd: 0 };
  }

  return {
    async fetchProfile(req) {
      if (req.platform === "instagram") return viaApify(req, o.apify?.instagramActor ?? "", { usernames: [req.handle] }, 1, undefined, o.apify?.instagramBuild);
      if (req.platform === "tiktok") {
        return viaApify(req, o.apify?.tiktokActor ?? "", {
          profiles: [req.handle.replace(/^@/, "")],
          resultsPerPage: o.tiktokVideos,
          ...NO_DOWNLOADS,
        }, 1, undefined, o.apify?.tiktokBuild);
      }
      return youtubeProfile(req);
    },

    async fetchProfiles(req) {
      const handles = [...new Set(req.handles.map((h) => h.replace(/^@/, "").toLowerCase()))].slice(0, 20);
      if (req.platform === "youtube") {
        const profiles: { handle: string; raw: unknown }[] = [];
        for (const handle of handles) profiles.push({ handle, raw: (await youtubeProfile({ platform: "youtube", handle, ...(req.ctx ? { ctx: req.ctx } : {}) })).raw });
        return { provider: "youtube", profiles, costUsd: 0 };
      }
      if (handles.length === 0) return { provider: "apify", profiles: [], costUsd: 0 };
      // A bigger batch takes longer on Apify: 3 minutes plus 15 s per extra profile, at most 8 minutes.
      const maxWaitMs = Math.min(180_000 + 15_000 * (handles.length - 1), 480_000);
      const one: ScrapeRequest = { platform: req.platform, handle: handles.join(","), ...(req.ctx ? { ctx: req.ctx } : {}) };
      const out =
        req.platform === "instagram"
          ? await viaApify(one, o.apify?.instagramActor ?? "", { usernames: handles }, handles.length, maxWaitMs, o.apify?.instagramBuild)
          : await viaApify(one, o.apify?.tiktokActor ?? "", { profiles: handles, resultsPerPage: o.tiktokVideos, ...NO_DOWNLOADS }, handles.length, maxWaitMs, o.apify?.tiktokBuild);
      return { provider: "apify", profiles: splitByHandle(req.platform, out.raw, handles), costUsd: out.costUsd };
    },
  };
}

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

/** `instrumented` wraps failures in PROVIDER_UNAVAILABLE; surface the ProviderError so the runner can read `retryable`. */
function unwrap(err: unknown): never {
  throw providerErrorOf(err) ?? new ProviderError(true, "provider", err instanceof Error ? err.message : String(err));
}
