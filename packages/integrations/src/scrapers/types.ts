import type { CallContext } from "../instrumented";

export type ScrapePlatform = "instagram" | "tiktok" | "youtube";
/** `handle` is the canonical URL's last segment: `coke_studio` (Instagram), `@cokestudiopakistan` (TikTok), `@cokestudio` (YouTube). */
export type ScrapeRequest = { platform: ScrapePlatform; handle: string; ctx?: CallContext };
/** `raw` is archived as-is and parsed by the creators module (hostile input). YouTube: `{ channel, videos }`. */
export type ScrapeResult = { provider: "apify" | "youtube"; raw: unknown; costUsd: number };

export type BatchScrapeRequest = { platform: ScrapePlatform; handles: string[]; ctx?: CallContext };
/** One raw response per requested handle, in the shape `fetchProfile` returns for that platform (archived per profile). */
export type BatchScrapeResult = { provider: "apify" | "youtube"; profiles: { handle: string; raw: unknown }[]; costUsd: number };

/** Public Instagram post or reel links whose author is wanted (live discovery uses posts as discovery evidence). */
export type PostOwnerRequest = { urls: string[]; ctx?: CallContext };
/** The author handle the provider reported for each link, or null when the post could not be read. */
export type PostOwnerResult = { owners: { url: string; owner: string | null }[]; costUsd: number };

export interface ProfileScraper {
  fetchProfile(req: ScrapeRequest): Promise<ScrapeResult>;
  /** Live discovery: many profiles of one platform in one Apify run (YouTube: one API read each, free). */
  fetchProfiles(req: BatchScrapeRequest): Promise<BatchScrapeResult>;
  /** Live discovery: authors of Instagram post/reel links in one run; absent when not configured. */
  resolveInstagramPostOwners?(req: PostOwnerRequest): Promise<PostOwnerResult>;
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

/**
 * Durable record of paid provider runs (audit SRCH-04), implemented in PostgreSQL (packages/db). A run is claimed by a
 * stable key (job + actor + exact input) before the provider is called, so a retry finds it and resumes it instead of
 * paying again; its cost is recorded once.
 */
export type ProviderRunRecord = { runKey: string; externalRunId: string | null; status: "starting" | "running" | "succeeded" | "failed" | "aborted" | "unknown"; costRecorded: boolean };
export interface ProviderRunStore {
  /** The existing run for this key, or a new one claimed now (status "starting"). */
  claim(r: { runKey: string; actor: string; jobId: string | null; workspaceId: string | null }): Promise<{ run: ProviderRunRecord; created: boolean }>;
  /** The provider returned its run id: stored before any waiting. */
  attach(runKey: string, externalRunId: string): Promise<void>;
  /** Terminal state and the cost recorded for it (once). */
  finish(runKey: string, status: "succeeded" | "failed" | "aborted" | "unknown", costUsd: number | null): Promise<void>;
  /** Runs still open since before `before` (for the reconciler). */
  open(before: Date): Promise<(ProviderRunRecord & { actor: string; jobId: string | null; workspaceId: string | null; startedAt: Date })[]>;
}
