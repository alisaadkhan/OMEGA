import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { createApifyClient } from "./apify";
import { ProviderError, type ProfileScraper, type ScrapeRequest, type ScrapeResult, type SpendGuard } from "./types";
import { fetchYouTubeChannel } from "./youtube";

type Options = {
  apify: { token: string; instagramActor: string; tiktokActor: string } | null;
  youtubeApiKey: string | null;
  tiktokVideos: number;
  youtubeVideos?: number;
  spendGuard: SpendGuard;
  sink: ProviderCallSink;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/** Job-level retries decide whether to try again (spec §5.2), so the adapter itself makes one attempt. */
export function createProfileScraper(o: Options): ProfileScraper {
  const apify = o.apify ? createApifyClient({ token: o.apify.token, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.sleep ? { sleep: o.sleep } : {}) }) : null;

  async function viaApify(req: ScrapeRequest, actor: string, input: unknown): Promise<ScrapeResult> {
    if (!apify) throw new ProviderError(false, "not_configured", "APIFY_TOKEN is not set");
    await o.spendGuard.assertWithinBudget();
    const out = await instrumented(
      {
        provider: "apify",
        operation: `scrape_${req.platform}`,
        timeoutMs: 240_000,
        retries: 0,
        sink: o.sink,
        logger: o.logger,
        ctx: req.ctx,
        usage: (r: { items: unknown[]; costUsd: number }) => ({ model: actor, units: r.items.length, costUsd: r.costUsd }),
      },
      () => apify.runActor(actor, input),
    ).catch(unwrap);
    return { provider: "apify", raw: out.items, costUsd: out.costUsd };
  }

  return {
    async fetchProfile(req) {
      if (req.platform === "instagram") return viaApify(req, o.apify?.instagramActor ?? "", { usernames: [req.handle] });
      if (req.platform === "tiktok") {
        return viaApify(req, o.apify?.tiktokActor ?? "", {
          profiles: [req.handle.replace(/^@/, "")],
          resultsPerPage: o.tiktokVideos,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
          shouldDownloadAvatars: false,
          shouldDownloadSubtitles: false,
        });
      }
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
    },
  };
}

/** `instrumented` wraps failures in PROVIDER_UNAVAILABLE; surface the ProviderError so the runner can read `retryable`. */
function unwrap(err: unknown): never {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) throw e;
  throw new ProviderError(true, "provider", err instanceof Error ? err.message : String(err));
}
