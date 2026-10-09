import { readFileSync } from "node:fs";
import type { ProfileScraper, ScrapePlatform, ScrapeRequest, ScrapeResult } from "./types";

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

  static defaults(): FixtureScraper {
    return new FixtureScraper({
      instagram: { provider: "apify", raw: scraperFixture("instagram-profile.json"), costUsd: 0.0026 },
      tiktok: { provider: "apify", raw: scraperFixture("tiktok-videos.json"), costUsd: 0.018 },
      youtube: { provider: "youtube", raw: { channel: scraperFixture("youtube-channel.json"), videos: scraperFixture("youtube-videos.json") }, costUsd: 0 },
    });
  }
}
