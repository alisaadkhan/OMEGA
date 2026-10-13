import { sha256Hex, type Logger } from "@mushin/core";
import type { DiscoveryJobStep } from "@mushin/contracts";
import type { Db, TenantTx } from "@mushin/db";
import { AVATAR_BUCKET, ProviderError, RAW_PAYLOAD_BUCKET, type Llm, type ObjectStorage, type ProfileScraper } from "@mushin/integrations";
import { activeNiches } from "../repository";
import type { CreatorPlatform } from "../rules";
import { assessCreator, type Assessment } from "./assessment";
import { fetchAvatar } from "./avatar";
import { extractContacts, extractLinks } from "./links";
import { minorByRules } from "./minors";
import * as repo from "./repository";
import { measureSignals, profileMetrics, type SignalReport } from "./signals";
import { standardize, type StandardProfile } from "./standardize";
import { suppressedUrls } from "../suppressions";

export type EnrichJob = { jobId: string; workspaceId: string; platform: CreatorPlatform; handle: string; canonicalUrl: string; requestId: string | null };
export type SavedResult = { kind: "saved"; creatorId: string; outcome: "created" | "refreshed"; assessment: "assessed" | "pending" | "insufficient_data"; profile: StandardProfile };
export type EnrichResult = SavedResult | { kind: "reused"; creatorId: string } | { kind: "unavailable"; code: "PRIVATE_ACCOUNT" | "NOT_FOUND"; message: string };
export type EnrichHooks = { onStep(step: DiscoveryJobStep): Promise<void>; onSaved(tx: TenantTx, result: SavedResult): Promise<void> };
export type ProcessHooks = { onStep?(step: DiscoveryJobStep): Promise<void>; onSaved(tx: TenantTx, result: SavedResult): Promise<void> };

type Deps = {
  db: Db;
  scraper: ProfileScraper;
  storage: ObjectStorage | null;
  llm: Llm;
  encryptionKey: Buffer;
  logger: Logger;
  now?: () => Date;
  /** Fetches a profile photo to copy into storage (injectable for tests). */
  fetchImage?: typeof fetch;
};

function topTags(p: StandardProfile): string[] {
  const counts = new Map<string, number>();
  for (const post of p.recentPosts) for (const t of post.hashtags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => `#${t}`);
}

export function createEnrichmentPipeline(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const storage = deps.storage;
  const needStorage = (): ObjectStorage => {
    if (!storage) throw new ProviderError(false, "not_configured", "File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return storage;
  };

  async function readPayload(ref: repo.PayloadRef): Promise<unknown> {
    const bytes = await needStorage().get(RAW_PAYLOAD_BUCKET, ref.storageKey);
    if (!bytes) throw new Error(`archived payload ${ref.id} is missing from storage`);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Best effort: platform photo links expire within days, so a copy is kept; failure keeps the initials avatar. */
  async function copyAvatar(p: StandardProfile, canonicalUrl: string): Promise<{ url: string; key: string } | null> {
    if (!p.avatarUrl || !storage) return null;
    try {
      const image = await fetchAvatar(p.avatarUrl, deps.fetchImage ?? fetch);
      if (!image) return null;
      const key = `${p.platform}/${sha256Hex(canonicalUrl).slice(0, 32)}.${image.ext}`;
      await storage.put(AVATAR_BUCKET, key, image.bytes, image.contentType);
      return { url: storage.publicUrl(AVATAR_BUCKET, key), key };
    } catch (err) {
      deps.logger.warn({ err, canonicalUrl }, "could not copy the profile photo; keeping the initials avatar");
      return null;
    }
  }

  async function assess(p: StandardProfile, report: SignalReport, ctx: { jobId?: string; workspaceId?: string }): Promise<{ value: Assessment; model: string } | null> {
    const niches = await deps.db.withSystem((tx) => activeNiches(tx));
    try {
      const { assessment, model } = await assessCreator({ llm: deps.llm, report, profile: p, nicheLabels: niches, ctx });
      return { value: assessment, model };
    } catch (err) {
      deps.logger.warn({ err, handle: p.handle }, "creator assessment failed; saving the data and assessing again in the background");
      return null;
    }
  }

  const minorReasonFor = (p: StandardProfile, a: Assessment | null): string | null =>
    minorByRules([p.bio, ...p.recentPosts.map((x) => x.caption)], now()) ?? (a?.minorSigns.likely ? `AI: ${a.minorSigns.reason || "content suggests the creator may be under 18"}`.slice(0, 300) : null);

  /** One stored file and index row per profile, so erasure and reassessment can find a creator's own data (spec §4.2). */
  async function archive(job: EnrichJob, provider: "apify" | "youtube", raw: unknown): Promise<string> {
    const settings = await deps.db.withSystem((tx) => repo.getEnrichmentSettings(tx));
    const store = needStorage();
    const body = JSON.stringify(raw);
    const t = now();
    const key = `${job.platform}/${t.getUTCFullYear()}/${String(t.getUTCMonth() + 1).padStart(2, "0")}/${job.jobId}-${sha256Hex(job.canonicalUrl).slice(0, 16)}.json`;
    await store.put(RAW_PAYLOAD_BUCKET, key, body, "application/json");
    return deps.db.withSystem((tx) =>
      repo.insertRawPayload(tx, {
        provider,
        platform: job.platform,
        canonicalUrl: job.canonicalUrl,
        jobId: job.jobId,
        storageKey: key,
        bytes: Buffer.byteLength(body),
        sha256: sha256Hex(body),
        deleteAfter: new Date(t.getTime() + settings.rawRetentionDays * 86_400_000),
      }),
    );
  }

  async function archived(jobId: string, canonicalUrl: string): Promise<{ payloadId: string; raw: unknown } | null> {
    const ref = await deps.db.withSystem((tx) => repo.payloadForJobProfile(tx, jobId, canonicalUrl));
    return ref ? { payloadId: ref.id, raw: await readPayload(ref) } : null;
  }

  /** Reuses retained source evidence for a known profile; never fetches a provider as a side effect. */
  async function profileForUrl(canonicalUrl: string): Promise<{ profile: StandardProfile; fetchedAt: Date } | null> {
    const known = await deps.db.withSystem((tx) => repo.findProfileByUrl(tx, canonicalUrl));
    if (!known) return null;
    const ref = await deps.db.withSystem((tx) => repo.latestPayloadForCreator(tx, known.creatorId));
    if (!ref || ref.canonicalUrl !== canonicalUrl || ref.deleteAfter <= now()) return null;
    const settings = await deps.db.withSystem((tx) => repo.getEnrichmentSettings(tx));
    let handle: string;
    try {
      handle = decodeURIComponent(new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/^@/, "");
    } catch {
      return null;
    }
    const standardized = standardize(ref.platform, handle, await readPayload(ref), { maxPosts: ref.platform === "tiktok" ? settings.tiktokRecentVideos : settings.recentPosts });
    return standardized.kind === "ok" ? { profile: standardized.profile, fetchedAt: ref.fetchedAt } : null;
  }

  /** Steps after fetching (spec 4A §5.1 steps 3–5) for one profile whose response is already archived. */
  async function processProfile(job: EnrichJob, payloadId: string, raw: unknown, hooks: ProcessHooks): Promise<EnrichResult> {
    const settings = await deps.db.withSystem((tx) => repo.getEnrichmentSettings(tx));
    // Erased creators stay out, whichever path reaches here (sub-project 4B D9).
    if ((await deps.db.withSystem((tx) => suppressedUrls(tx, [job.canonicalUrl]))).size > 0) {
      return { kind: "unavailable", code: "NOT_FOUND", message: "We couldn't find this account. Check the link and try again." };
    }
    await hooks.onStep?.("cleaning");
    const std = standardize(job.platform, job.handle, raw, { maxPosts: job.platform === "tiktok" ? settings.tiktokRecentVideos : settings.recentPosts });
    if (std.kind === "private") return { kind: "unavailable", code: "PRIVATE_ACCOUNT", message: "This account is private, so we can't assess it." };
    if (std.kind === "not_found") return { kind: "unavailable", code: "NOT_FOUND", message: "We couldn't find this account. Check the link and try again." };
    const p = std.profile;
    const avatar = await copyAvatar(p, job.canonicalUrl);
    await hooks.onStep?.("assessing");
    const known = await deps.db.withSystem((tx) => repo.findProfileByUrl(tx, job.canonicalUrl));
    const previous = known ? await deps.db.withSystem((tx) => repo.latestMetrics(tx, known.profileId)) : null;
    const report = measureSignals(p, previous, { benchmarks: settings.engagementBenchmarks, minPostsForScore: settings.minPostsForScore, growthMinDays: settings.growthMinDays, scoreBand: settings.scoreBand }, now());
    const assessment = await assess(p, report, { jobId: job.jobId, workspaceId: job.workspaceId });
    await hooks.onStep?.("saving");
    return deps.db.withWorkspace(job.workspaceId, async (tx) => {
      const saved = await repo.saveEnrichment(tx, {
        profile: p,
        canonicalUrl: job.canonicalUrl,
        payloadId,
        metrics: profileMetrics(p),
        report,
        assessment,
        modelVersion: settings.modelVersion,
        minorReason: minorReasonFor(p, assessment?.value ?? null),
        contacts: extractContacts(p),
        links: extractLinks(p, job.canonicalUrl),
        avatar,
        tags: topTags(p),
        encryptionKey: deps.encryptionKey,
        requestId: job.requestId,
      });
      const result: SavedResult = { kind: "saved", creatorId: saved.creatorId, outcome: saved.created ? "created" : "refreshed", assessment: saved.assessment, profile: p };
      await hooks.onSaved(tx, result);
      return result;
    });
  }

  async function enrich(job: EnrichJob, hooks: EnrichHooks): Promise<EnrichResult> {
    const settings = await deps.db.withSystem((tx) => repo.getEnrichmentSettings(tx));
    await hooks.onStep("fetching");
    const known = await deps.db.withSystem((tx) => repo.findProfileByUrl(tx, job.canonicalUrl));
    const own = await archived(job.jobId, job.canonicalUrl);
    // Fresh data from any workspace's job a few minutes ago is reused, and this job is refunded (spec D10).
    if (!own && known?.lastScrapedAt && now().getTime() - known.lastScrapedAt.getTime() < settings.reuseWindowMinutes * 60_000) {
      return { kind: "reused", creatorId: known.creatorId };
    }
    if (own) return processProfile(job, own.payloadId, own.raw, hooks); // a retry: Apify is never paid twice
    const scraped = await deps.scraper.fetchProfile({ platform: job.platform, handle: job.handle, ctx: { workspaceId: job.workspaceId, jobId: job.jobId, requestId: job.requestId } });
    await hooks.onStep("archiving");
    return processProfile(job, await archive(job, scraped.provider, scraped.raw), scraped.raw, hooks);
  }

  /** Re-runs signals and the AI from the archived response (after an AI failure). Throws so the queue retries. */
  async function reassess(creatorId: string): Promise<"assessed" | "missing"> {
    const settings = await deps.db.withSystem((tx) => repo.getEnrichmentSettings(tx));
    const ref = await deps.db.withSystem((tx) => repo.latestPayloadForCreator(tx, creatorId));
    if (!ref) return "missing";
    const handle = ref.canonicalUrl.split("/").pop() ?? "";
    const std = standardize(ref.platform, handle, await readPayload(ref), { maxPosts: ref.platform === "tiktok" ? settings.tiktokRecentVideos : settings.recentPosts });
    if (std.kind !== "ok") return "missing";
    const known = await deps.db.withSystem((tx) => repo.findProfileByUrl(tx, ref.canonicalUrl));
    const history = known ? await deps.db.withSystem((tx) => repo.latestMetrics(tx, known.profileId)) : null;
    // The latest snapshot is the one this payload produced; growth compares against an older one only.
    const previous = history && history.capturedAt.getTime() < ref.fetchedAt.getTime() - 60_000 ? history : null;
    const report = measureSignals(std.profile, previous, { benchmarks: settings.engagementBenchmarks, minPostsForScore: settings.minPostsForScore, growthMinDays: settings.growthMinDays, scoreBand: settings.scoreBand }, now());
    const niches = await deps.db.withSystem((tx) => activeNiches(tx));
    const { assessment, model } = await assessCreator({ llm: deps.llm, report, profile: std.profile, nicheLabels: niches });
    await deps.db.withSystem((tx) => repo.saveReassessment(tx, creatorId, assessment, report, settings.modelVersion, model, minorReasonFor(std.profile, assessment)));
    return "assessed";
  }

  /** Spec D5: archived responses are deleted after the retention period (files first, then the index rows). */
  async function purgeExpiredPayloads(): Promise<number> {
    let total = 0;
    for (;;) {
      const batch = await deps.db.withSystem((tx) => repo.expiredPayloads(tx, now(), 200));
      if (batch.length === 0) return total;
      await needStorage().remove(RAW_PAYLOAD_BUCKET, batch.map((b) => b.storageKey));
      await deps.db.withSystem((tx) => repo.deletePayloadRows(tx, batch.map((b) => b.id)));
      total += batch.length;
    }
  }

  async function ensureBuckets(): Promise<void> {
    if (!storage) return;
    await storage.ensureBucket(RAW_PAYLOAD_BUCKET, { public: false });
    await storage.ensureBucket(AVATAR_BUCKET, { public: true });
  }

  return { enrich, archive, archived, profileForUrl, processProfile, reassess, purgeExpiredPayloads, ensureBuckets, storage };
}

export type EnrichmentPipeline = ReturnType<typeof createEnrichmentPipeline>;
