import type { CallContext } from "../instrumented";

export type ScrapePlatform = "instagram" | "tiktok" | "youtube";
/** `handle` is the canonical URL's last segment: `coke_studio` (Instagram), `@cokestudiopakistan` (TikTok), `@cokestudio` (YouTube). */
export type ScrapeRequest = { platform: ScrapePlatform; handle: string; ctx?: CallContext };
/** `raw` is archived as-is and parsed by the creators module (hostile input). YouTube: `{ channel, videos }`. */
export type ScrapeResult = { provider: "apify" | "youtube"; raw: unknown; costUsd: number };

export type BatchScrapeRequest = { platform: ScrapePlatform; handles: string[]; ctx?: CallContext };
/** One raw response per requested handle, in the shape `fetchProfile` returns for that platform (archived per profile). */
export type BatchScrapeResult = { provider: "apify" | "youtube"; profiles: { handle: string; raw: unknown }[]; costUsd: number };

export interface ProfileScraper {
  fetchProfile(req: ScrapeRequest): Promise<ScrapeResult>;
  /** Live discovery: many profiles of one platform in one Apify run (YouTube: one API read each, free). */
  fetchProfiles(req: BatchScrapeRequest): Promise<BatchScrapeResult>;
}

export type ProviderErrorReason = "spend_cap" | "quota" | "not_configured" | "provider";

/** Tells the job runner whether trying again later can help (spec §5.2). */
export class ProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly reason: ProviderErrorReason,
    message: string,
    /** What the provider charged for the failed work (counted by the spend cap). */
    readonly costUsd = 0,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Admits paid work (`units` runs, default 1), or throws spend_cap; call the returned function once its cost is recorded. */
export type SpendGuard = { begin(units?: number): Promise<() => void> };
