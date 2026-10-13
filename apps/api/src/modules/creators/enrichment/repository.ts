import { and, desc, eq, lt, sql } from "drizzle-orm";
import { encryptSecret, sha256Hex } from "@mushin/core";
import {
  creatorContacts,
  creatorLinks,
  creatorProfiles,
  creators,
  enrichmentSettings,
  enrichmentSnapshots,
  profileMetricSnapshots,
  rawPayloads,
  writeOutbox,
  type SystemTx,
  type TenantTx,
} from "@mushin/db";
import { maskContact, type CreatorPlatform } from "../rules";
import type { Assessment } from "./assessment";
import type { ExtractedContact, ExtractedLink } from "./links";
import type { PreviousMetrics, SignalReport } from "./signals";
import type { StandardProfile } from "./standardize";

type Tx = TenantTx | SystemTx;
export type EnrichmentSettingsRow = typeof enrichmentSettings.$inferSelect;

export async function getEnrichmentSettings(tx: Tx): Promise<EnrichmentSettingsRow> {
  const [s] = await tx.select().from(enrichmentSettings).limit(1);
  if (!s) throw new Error("platform.enrichment_settings has no row");
  return s;
}

export async function findProfileByUrl(tx: Tx, canonicalUrl: string): Promise<{ profileId: string; creatorId: string; lastScrapedAt: Date | null } | null> {
  const rows = await tx
    .select({ profileId: creatorProfiles.id, creatorId: creatorProfiles.creatorId, lastScrapedAt: creatorProfiles.lastScrapedAt })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.canonicalUrl, canonicalUrl))
    .limit(1);
  return rows[0] ?? null;
}

/** What a refresh scrapes: the creator's primary profile. Only active creators can be refreshed. */
export async function profileTarget(
  tx: Tx,
  creatorId: string,
): Promise<{ platform: CreatorPlatform; handle: string; canonicalUrl: string; lastScrapedAt: Date | null } | null> {
  const rows = await tx
    .select({ platform: creatorProfiles.platform, canonicalUrl: creatorProfiles.canonicalUrl, lastScrapedAt: creatorProfiles.lastScrapedAt, status: creators.status, primary: creators.primaryPlatform })
    .from(creatorProfiles)
    .innerJoin(creators, eq(creators.id, creatorProfiles.creatorId))
    .where(eq(creatorProfiles.creatorId, creatorId))
    .orderBy(sql`(${creatorProfiles.platform} = ${creators.primaryPlatform}) desc`, desc(creatorProfiles.followers))
    .limit(1);
  const r = rows[0];
  if (!r || r.status !== "active") return null;
  return { platform: r.platform, handle: r.canonicalUrl.split("/").pop() ?? "", canonicalUrl: r.canonicalUrl, lastScrapedAt: r.lastScrapedAt };
}

export async function latestMetrics(tx: Tx, profileId: string): Promise<PreviousMetrics | null> {
  const rows = await tx
    .select({ followers: profileMetricSnapshots.followers, avgLikes: profileMetricSnapshots.avgLikes, capturedAt: profileMetricSnapshots.capturedAt })
    .from(profileMetricSnapshots)
    .where(eq(profileMetricSnapshots.profileId, profileId))
    .orderBy(desc(profileMetricSnapshots.capturedAt))
    .limit(1);
  return rows[0] ?? null;
}

export type PayloadRef = { id: string; storageKey: string; provider: "apify" | "youtube"; platform: CreatorPlatform; canonicalUrl: string; fetchedAt: Date; deleteAfter: Date };
const payloadCols = {
  id: rawPayloads.id,
  storageKey: rawPayloads.storageKey,
  provider: rawPayloads.provider,
  platform: rawPayloads.platform,
  canonicalUrl: rawPayloads.canonicalUrl,
  fetchedAt: rawPayloads.fetchedAt,
  deleteAfter: rawPayloads.deleteAfter,
};

export async function payloadForJob(tx: Tx, jobId: string): Promise<PayloadRef | null> {
  const rows = await tx.select(payloadCols).from(rawPayloads).where(eq(rawPayloads.jobId, jobId)).orderBy(desc(rawPayloads.fetchedAt)).limit(1);
  return rows[0] ?? null;
}

/** The archived response of one profile within a job (live runs archive several profiles per job). */
export async function payloadForJobProfile(tx: Tx, jobId: string, canonicalUrl: string): Promise<PayloadRef | null> {
  const rows = await tx
    .select(payloadCols)
    .from(rawPayloads)
    .where(and(eq(rawPayloads.jobId, jobId), eq(rawPayloads.canonicalUrl, canonicalUrl)))
    .orderBy(desc(rawPayloads.fetchedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function latestPayloadForCreator(tx: Tx, creatorId: string): Promise<PayloadRef | null> {
  const rows = await tx.select(payloadCols).from(rawPayloads).where(eq(rawPayloads.creatorId, creatorId)).orderBy(desc(rawPayloads.fetchedAt)).limit(1);
  return rows[0] ?? null;
}

export async function insertRawPayload(
  tx: Tx,
  row: { provider: "apify" | "youtube"; platform: CreatorPlatform; canonicalUrl: string; jobId: string; storageKey: string; bytes: number; sha256: string; deleteAfter: Date },
): Promise<string> {
  const [r] = await tx.insert(rawPayloads).values(row).returning({ id: rawPayloads.id });
  if (!r) throw new Error("raw payload insert returned no row");
  return r.id;
}

export async function expiredPayloads(tx: Tx, now: Date, limit: number): Promise<{ id: string; storageKey: string }[]> {
  return tx.select({ id: rawPayloads.id, storageKey: rawPayloads.storageKey }).from(rawPayloads).where(lt(rawPayloads.deleteAfter, now)).limit(limit);
}

export async function deletePayloadRows(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(rawPayloads).where(sql`${rawPayloads.id} in ${ids}`);
}

export type SaveInput = {
  profile: StandardProfile;
  canonicalUrl: string;
  payloadId: string;
  metrics: { engagementRate: number | null; avgLikes: number | null; avgComments: number | null; avgViews: number | null };
  report: SignalReport;
  assessment: { value: Assessment; model: string } | null;
  modelVersion: string;
  minorReason: string | null;
  contacts: ExtractedContact[];
  links: ExtractedLink[];
  avatar: { url: string; key: string } | null;
  tags: string[];
  encryptionKey: Buffer;
  requestId: string | null;
};

const assessmentStatusOf = (i: SaveInput): "assessed" | "pending" | "insufficient_data" =>
  i.assessment === null ? "pending" : i.report.kind === "insufficient" ? "insufficient_data" : "assessed";

/**
 * Spec §5.1 step 5, one transaction (worker role). A refresh updates the creator the profile link belongs to; the
 * pipeline only ever sets `is_minor`, never clears it (SRS §5.5).
 */
export async function saveEnrichment(tx: Tx, i: SaveInput): Promise<{ creatorId: string; created: boolean; assessment: "assessed" | "pending" | "insufficient_data" }> {
  const p = i.profile;
  const status = assessmentStatusOf(i);
  const score = status === "assessed" ? (i.assessment?.value.score ?? null) : null;
  const existing = await findProfileByUrl(tx, i.canonicalUrl);
  const a = i.assessment?.value ?? null;
  let creatorId: string;
  let profileId: string;
  const metricTimes = { followersUpdatedAt: sql`now()`, engagementUpdatedAt: sql`now()`, audienceUpdatedAt: a ? sql`now()` : sql`${creatorProfiles.audienceUpdatedAt}`, lastScrapedAt: sql`now()` };

  if (!existing) {
    const [c] = await tx
      .insert(creators)
      .values({
        displayName: p.displayName,
        primaryHandle: p.handle,
        primaryPlatform: p.platform,
        avatarUrl: i.avatar?.url ?? null,
        avatarKey: i.avatar?.key ?? null,
        city: a?.creatorCity ?? null,
        country: p.country ?? a?.creatorCountry ?? null,
        niches: a?.niches ?? [],
        tags: i.tags,
        verified: p.verified,
        authenticityScore: score,
        assessmentStatus: status,
        isMinor: i.minorReason !== null,
        minorReason: i.minorReason,
        minorFlaggedAt: i.minorReason !== null ? new Date() : null,
        lastEnrichedAt: new Date(),
      })
      .returning({ id: creators.id });
    if (!c) throw new Error("creator insert returned no row");
    creatorId = c.id;
    const [pr] = await tx
      .insert(creatorProfiles)
      .values({
        creatorId,
        platform: p.platform,
        handle: p.handle,
        canonicalUrl: i.canonicalUrl,
        followers: p.followers,
        following: p.following,
        posts: p.posts,
        engagementRate: i.metrics.engagementRate,
        avgLikes: i.metrics.avgLikes,
        avgComments: i.metrics.avgComments,
        avgViews: i.metrics.avgViews,
        bio: p.bio,
        followersUpdatedAt: new Date(),
        engagementUpdatedAt: new Date(),
        audienceUpdatedAt: a ? new Date() : null,
        lastScrapedAt: new Date(),
      })
      .returning({ id: creatorProfiles.id });
    if (!pr) throw new Error("profile insert returned no row");
    profileId = pr.id;
  } else {
    creatorId = existing.creatorId;
    profileId = existing.profileId;
    await tx
      .update(creatorProfiles)
      .set({
        handle: p.handle,
        followers: p.followers,
        following: p.following,
        posts: p.posts,
        engagementRate: i.metrics.engagementRate,
        avgLikes: i.metrics.avgLikes,
        avgComments: i.metrics.avgComments,
        avgViews: i.metrics.avgViews,
        bio: p.bio,
        ...metricTimes,
      })
      .where(eq(creatorProfiles.id, profileId));
    await tx
      .update(creators)
      .set({
        displayName: p.displayName,
        verified: p.verified,
        ...(i.avatar ? { avatarUrl: i.avatar.url, avatarKey: i.avatar.key } : {}),
        ...(a && a.niches.length > 0 ? { niches: a.niches } : {}),
        ...(i.tags.length > 0 ? { tags: i.tags } : {}),
        city: sql`coalesce(${creators.city}, ${a?.creatorCity ?? null})`,
        country: sql`coalesce(${creators.country}, ${p.country ?? a?.creatorCountry ?? null})`,
        // A pending assessment keeps the last score until the background assessment replaces it.
        ...(status === "pending" ? {} : { authenticityScore: score }),
        assessmentStatus: status === "pending" ? sql`coalesce(${creators.assessmentStatus}, 'pending')` : status,
        lastEnrichedAt: new Date(),
        ...(i.minorReason !== null
          ? { isMinor: true, minorReason: sql`coalesce(${creators.minorReason}, ${i.minorReason})`, minorFlaggedAt: sql`coalesce(${creators.minorFlaggedAt}, now())` }
          : {}),
      })
      .where(eq(creators.id, creatorId));
  }

  await tx.insert(profileMetricSnapshots).values({
    profileId,
    followers: p.followers,
    following: p.following,
    posts: p.posts,
    engagementRate: i.metrics.engagementRate,
    avgLikes: i.metrics.avgLikes,
    avgComments: i.metrics.avgComments,
    avgViews: i.metrics.avgViews,
    rawPayloadId: i.payloadId,
  });

  for (const k of i.contacts) {
    await tx
      .insert(creatorContacts)
      .values({
        creatorId,
        kind: k.kind,
        valueEncrypted: encryptSecret(k.value, i.encryptionKey),
        valueHash: sha256Hex(k.value.trim().toLowerCase()),
        masked: maskContact(k.kind, k.value),
        trust: k.trust,
        source: k.source,
      })
      .onConflictDoUpdate({ target: [creatorContacts.creatorId, creatorContacts.kind, creatorContacts.valueHash], set: { lastSeenAt: sql`now()` } });
  }
  for (const l of i.links) {
    await tx
      .insert(creatorLinks)
      .values({ creatorId, platform: l.platform, url: l.url, source: l.source })
      .onConflictDoUpdate({ target: [creatorLinks.creatorId, creatorLinks.url], set: { lastSeenAt: sql`now()` } });
  }
  if (a) await insertSnapshot(tx, creatorId, a, i.report, i.modelVersion, i.assessment?.model ?? "");
  await tx.update(rawPayloads).set({ creatorId }).where(eq(rawPayloads.id, i.payloadId));
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: i.requestId });
  if (status === "pending") {
    await writeOutbox(tx, { eventType: "creator.assessment_requested", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: i.requestId });
  }
  return { creatorId, created: !existing, assessment: status };
}

async function insertSnapshot(tx: Tx, creatorId: string, a: Assessment, report: SignalReport, modelVersion: string, model: string): Promise<void> {
  await tx.insert(enrichmentSnapshots).values({
    creatorId,
    verdict: a.verdict ?? "insufficient data",
    authenticityScore: report.kind === "scored" ? a.score : null,
    evidenceBreakdown: report.kind === "scored" ? a.evidence : [],
    audience: a.audience,
    modelVersion: `${modelVersion}/${model}`,
    confidence: report.kind === "scored" ? report.confidence : null,
  });
}

/** Background re-assessment after an AI failure (spec §5.2): a new snapshot and the creator's score; data is unchanged. */
export async function saveReassessment(tx: Tx, creatorId: string, a: Assessment, report: SignalReport, modelVersion: string, model: string, minorReason: string | null): Promise<void> {
  await insertSnapshot(tx, creatorId, a, report, modelVersion, model);
  await tx
    .update(creators)
    .set({
      authenticityScore: report.kind === "scored" ? a.score : null,
      assessmentStatus: report.kind === "scored" ? "assessed" : "insufficient_data",
      ...(a.niches.length > 0 ? { niches: a.niches } : {}),
      ...(minorReason !== null
        ? { isMinor: true, minorReason: sql`coalesce(${creators.minorReason}, ${minorReason})`, minorFlaggedAt: sql`coalesce(${creators.minorFlaggedAt}, now())` }
        : {}),
    })
    .where(eq(creators.id, creatorId));
  await tx
    .update(creatorProfiles)
    .set({ audienceUpdatedAt: sql`now()` })
    .where(and(eq(creatorProfiles.creatorId, creatorId)));
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: null });
}
