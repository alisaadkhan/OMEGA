import { createHash } from "node:crypto";
import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { createApifyClient } from "./apify";
import { ProviderError, type PostOwnerResult, type ProfileScraper, type ProviderRunStore, type ScrapeRequest, type ScrapeResult, type SpendGuard } from "./types";
import { fetchYouTubeChannel } from "./youtube";

type Options = {
  apify: { token: string; instagramActor: string; tiktokActor: string; instagramBuild?: string; tiktokBuild?: string; instagramPostActor?: string; instagramPostBuild?: string } | null;
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
  /** Durable run records (audit SRCH-04): with a job id, a retried batch resumes its run instead of paying again. */
  runs?: ProviderRunStore;
  /** Hard limits Apify enforces on each run (audit SRCH-04). */
  apifyRunLimits?: { timeoutSecs: number; maxTotalChargeUsd: number };
};

/** Default per-run limits: a little over the 180 s wait, and well above a normal batch's cost (~$0.02-0.10). */
export const APIFY_RUN_LIMITS = { timeoutSecs: 300, maxTotalChargeUsd: 1 };

/** A stable key for one paid batch of one job: retries of the same batch get the same key. */
export function apifyRunKey(jobId: string, actor: string, input: unknown): string {
  return `apify:${jobId}:${actor}:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`;
}

const NO_DOWNLOADS = { shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false, shouldDownloadSubtitles: false };

function tiktokHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  try {
    const url = new URL(raw);
    if (url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com")) return url.pathname.match(/^\/@([\w.]+)\/?$/i)?.[1]?.toLowerCase() ?? null;
  } catch {
    // Actor output is normally the requested handle, not a URL.
  }
  const handle = raw.replace(/^@/, "");
  return /^[a-z0-9._]{1,24}$/i.test(handle) ? handle.toLowerCase() : null;
}

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
    const author = r["authorMeta"];
    const name = typeof author === "object" && author !== null ? (author as Record<string, unknown>)["name"] : undefined;
    const authorHandle = tiktokHandle(name);
    const inputHandle = tiktokHandle(r["input"]);
    // TikTok returns one dataset row per video. Only associate a row when the
    // requested profile and actor-reported author identity agree.
    if (r["input"] !== undefined && (!inputHandle || !authorHandle || inputHandle !== authorHandle)) return null;
    return inputHandle ?? authorHandle;
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

  async function viaApify(req: ScrapeRequest, actor: string, input: unknown, units = 1, maxWaitMs?: number, build?: string, operation?: string): Promise<ScrapeResult> {
    if (!apify) throw new ProviderError(false, "not_configured", "APIFY_TOKEN is not set");
    const done = await o.spendGuard.begin(units);
    try {
      return await runApify(req, actor, input, apify, maxWaitMs, build, operation);
    } finally {
      done();
    }
  }

  async function runApify(req: ScrapeRequest, actor: string, input: unknown, apify: ReturnType<typeof createApifyClient>, maxWaitMs?: number, build?: string, operation = `scrape_${req.platform}`): Promise<ScrapeResult> {
    // Audit SRCH-04: claim the run first, so a retry of this batch resumes the same paid run.
    const jobId = req.ctx?.jobId ?? null;
    const runKey = o.runs && jobId ? apifyRunKey(jobId, actor, input) : null;
    const claimed = runKey && o.runs ? await o.runs.claim({ runKey, actor, jobId, workspaceId: req.ctx?.workspaceId ?? null }) : null;
    const prior = claimed && !claimed.created ? claimed.run : null;
    // A finished run whose cost is recorded: read its items again, never record its cost twice.
    const alreadyPaid = prior?.status === "succeeded" && prior.costRecorded;
    const resumeRunId = prior?.externalRunId && (prior.status === "running" || prior.status === "starting" || alreadyPaid) ? prior.externalRunId : undefined;
    const limits = o.apifyRunLimits ?? APIFY_RUN_LIMITS;
    const start = {
      ...(maxWaitMs === undefined ? {} : { maxWaitMs }),
      ...(build ? { build } : {}),
      ...(resumeRunId ? { resumeRunId } : {}),
      timeoutSecs: limits.timeoutSecs,
      maxTotalChargeUsd: limits.maxTotalChargeUsd,
      ...(runKey && o.runs ? { onStarted: (id: string) => o.runs?.attach(runKey, id) ?? Promise.resolve() } : {}),
    };
    const settle = async (status: "succeeded" | "failed", costUsd: number | null) => {
      if (runKey && o.runs && !alreadyPaid) await o.runs.finish(runKey, status, costUsd).catch((err: unknown) => o.logger.error({ err, runKey }, "could not record the Apify run's end"));
    };
    const out = await instrumented(
      {
        provider: "apify",
        operation,
        timeoutMs: (maxWaitMs ?? 180_000) + 60_000,
        retries: 0,
        sink: o.sink,
        logger: o.logger,
        ctx: req.ctx,
        usage: (r: { items: unknown[]; costUsd: number }) => ({ model: actor, units: r.items.length, costUsd: alreadyPaid ? 0 : r.costUsd }),
      },
      () => apify.runActor(actor, input, start),
    ).catch(async (err: unknown) => {
      // A failed run can still have been charged; record it so the monthly spend cap counts it (spec §4).
      const pe = providerErrorOf(err);
      // Only a run Apify reported as ended (it then carries its final cost) is settled here; after a network error the
      // run may still be going, so it stays open for the retry or the reconciler.
      if (pe && pe.costUsd > 0) await settle("failed", pe.costUsd);
      if (pe && pe.costUsd > 0) {
        await o.sink
          .record({
            provider: "apify",
            operation,
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
    await settle("succeeded", out.costUsd);
    return { provider: "apify", raw: out.items, costUsd: alreadyPaid ? 0 : out.costUsd };
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
        for (const handle of handles) {
          try {
            profiles.push({ handle, raw: (await youtubeProfile({ platform: "youtube", handle, ...(req.ctx ? { ctx: req.ctx } : {}) })).raw });
          } catch (err) {
            // One channel's own failure (e.g. HTTP 404) leaves only that channel out, so it ends as not found;
            // quota, configuration and retryable failures still stop the batch.
            if (!(err instanceof ProviderError) || err.retryable || err.reason !== "provider") throw err;
          }
        }
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

    ...(o.apify?.instagramPostActor
      ? {
          async resolveInstagramPostOwners(req: { urls: string[]; ctx?: ScrapeRequest["ctx"] }): Promise<PostOwnerResult> {
            const urls = [...new Set(req.urls)].slice(0, 20);
            if (urls.length === 0) return { owners: [], costUsd: 0 };
            const one: ScrapeRequest = { platform: "instagram", handle: "posts", ...(req.ctx ? { ctx: req.ctx } : {}) };
            const out = await viaApify(one, o.apify?.instagramPostActor ?? "", { directUrls: urls, resultsType: "posts", resultsLimit: 1, addParentData: false }, urls.length, 180_000, o.apify?.instagramPostBuild, "resolve_instagram_posts");
            return { owners: postOwners(urls, out.raw), costUsd: out.costUsd };
          },
        }
      : {}),
  };
}

/** Instagram post short codes look like `DTGCHjfjDuY`; only an owner the provider reports for that exact post counts. */
export function postOwners(urls: string[], items: unknown): { url: string; owner: string | null }[] {
  const codeOf = (u: string): string | null => /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/.exec(u)?.[1] ?? null;
  const byCode = new Map<string, string>();
  for (const it of Array.isArray(items) ? items : []) {
    if (typeof it !== "object" || it === null) continue;
    const r = it as Record<string, unknown>;
    const code = typeof r["shortCode"] === "string" ? r["shortCode"] : typeof r["url"] === "string" ? codeOf(r["url"]) : null;
    const owner = typeof r["ownerUsername"] === "string" ? r["ownerUsername"].toLowerCase() : null;
    if (code && owner && /^[a-z0-9._]{1,30}$/.test(owner)) byCode.set(code, owner);
  }
  return urls.map((url) => {
    const code = codeOf(url);
    return { url, owner: code ? (byCode.get(code) ?? null) : null };
  });
}

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

/** `instrumented` wraps failures in PROVIDER_UNAVAILABLE; surface the ProviderError so the runner can read `retryable`. */
function unwrap(err: unknown): never {
  throw providerErrorOf(err) ?? new ProviderError(true, "provider", err instanceof Error ? err.message : String(err));
}
