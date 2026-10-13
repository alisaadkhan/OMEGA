import { readFileSync } from "node:fs";
import { ProviderError, type BatchScrapeRequest, type BatchScrapeResult, type ProfileScraper, type ScrapePlatform, type ScrapeRequest, type ScrapeResult } from "./types";

/** A recorded real response (fixtures/, recorded 2026-10-09 from public brand accounts). */
export function scraperFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

type Reply = ScrapeResult | Error | ((req: ScrapeRequest) => ScrapeResult | Promise<ScrapeResult>);

/** Test scraper: answers per platform from fixtures (or throws a given error) and records every call. */
export class FixtureScraper implements ProfileScraper {
  readonly calls: ScrapeRequest[] = [];
  constructor(private readonly replies: Partial<Record<ScrapePlatform, Reply>>) {}

  async fetchProfile(req: ScrapeRequest): Promise<ScrapeResult> {
    this.calls.push(req);
    const r = this.replies[req.platform];
    if (!r) throw new Error(`FixtureScraper has no reply for ${req.platform}`);
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(req) : r;
  }

  readonly batchCalls: BatchScrapeRequest[] = [];

  async fetchProfiles(req: BatchScrapeRequest): Promise<BatchScrapeResult> {
    this.batchCalls.push(req);
    const profiles: { handle: string; raw: unknown }[] = [];
    let costUsd = 0;
    let provider: "apify" | "youtube" = req.platform === "youtube" ? "youtube" : "apify";
    for (const handle of req.handles.map((h) => h.replace(/^@/, "").toLowerCase())) {
      const r = this.replies[req.platform];
      if (!r) throw new Error(`FixtureScraper has no reply for ${req.platform}`);
      if (r instanceof Error) throw r;
      const one = typeof r === "function" ? await r({ platform: req.platform, handle }) : r;
      profiles.push({ handle, raw: one.raw });
      costUsd += one.costUsd;
      provider = one.provider;
    }
    return { provider, profiles, costUsd };
  }

  /** Post link → author handle (or null); set to enable Instagram post-owner resolution in tests. */
  postOwners: ((url: string) => string | null) | null = null;
  readonly postOwnerCalls: string[][] = [];

  async resolveInstagramPostOwners(req: { urls: string[] }): Promise<{ owners: { url: string; owner: string | null }[]; costUsd: number }> {
    if (!this.postOwners) throw new ProviderError(false, "not_configured", "post-owner resolution is not configured in this fixture");
    this.postOwnerCalls.push(req.urls);
    const lookup = this.postOwners;
    return { owners: req.urls.map((url) => ({ url, owner: lookup(url) })), costUsd: 0.0027 * req.urls.length };
  }

  static defaults(): FixtureScraper {
    return new FixtureScraper({
      instagram: { provider: "apify", raw: scraperFixture("instagram-profile.json"), costUsd: 0.0026 },
      tiktok: { provider: "apify", raw: scraperFixture("tiktok-videos.json"), costUsd: 0.018 },
      youtube: { provider: "youtube", raw: { channel: scraperFixture("youtube-channel.json"), videos: scraperFixture("youtube-videos.json") }, costUsd: 0 },
    });
  }
}
