import { and, asc, eq, gt, sql } from "drizzle-orm";
import { creatorAttributeEvidence, creators, writeOutbox, type Db, type SystemTx } from "@mushin/db";
import type { CreatorPlatform } from "../rules";
import { truncate } from "@mushin/core";
import { deriveAttributes } from "./attribute-evidence";
import { wholeChars } from "./quote";
import { placeAttributes, refreshProfileCountries, replaceAttributeEvidence } from "./repository";
import { standardize, type StandardProfile } from "./standardize";

/**
 * Re-derives niche and country (and city evidence) for stored creators from data already held: the newest archived
 * provider response while it is inside its retention period, otherwise the stored name, bio and the platform country
 * recorded as evidence earlier. Nothing is fetched and no AI is called. Dry run unless `apply`; batches in creator-id
 * order so a run can resume after the last finished batch; one transaction per creator, so a failure skips only that
 * creator (re-running retries it). A creator whose values and evidence would not change is not written, so a second
 * run changes nothing. Every write keeps a before-image for rollback.
 */
export type BackfillOptions = {
  db: Db;
  apply: boolean;
  /** The archived response for a storage key, or null when the file is missing. */
  readPayload: (storageKey: string) => Promise<unknown | null>;
  usePostText: (platform: CreatorPlatform) => boolean;
  maxPosts: (platform: CreatorPlatform) => number;
  batchSize?: number;
  /** Resume after this creator id (the checkpoint of an earlier run). */
  after?: string | null;
  limit?: number;
  now?: () => Date;
  onBatch?: (p: { lastId: string; processed: number }) => Promise<void> | void;
};

const SNAPSHOT_COLS = {
  niches: creators.niches,
  nicheMain: creators.nicheMain,
  nicheStatus: creators.nicheStatus,
  nicheConfidence: creators.nicheConfidence,
  nicheAssessedAt: creators.nicheAssessedAt,
  city: creators.city,
  country: creators.country,
  platformCountry: creators.platformCountry,
  statedCountry: creators.statedCountry,
  countrySource: creators.countrySource,
  countryConfidence: creators.countryConfidence,
  countryCheckedAt: creators.countryCheckedAt,
};
type Snapshot = { [K in keyof typeof SNAPSHOT_COLS]: unknown };
type EvidenceSnap = { attribute: string; value: string; source: string; status: string; evidence: string; payloadId: string | null; observedAt: Date };
export type BeforeImage = { creatorId: string; columns: Snapshot; evidence: EvidenceSnap[] };

type Stat = { total: number; nicheKnown: number; nicheUnknown: number; nicheVariety: number; nicheConflicting: number; countryKnown: number; countryUnknown: number; countryBySource: Record<string, number> };
const emptyStat = (): Stat => ({ total: 0, nicheKnown: 0, nicheUnknown: 0, nicheVariety: 0, nicheConflicting: 0, countryKnown: 0, countryUnknown: 0, countryBySource: {} });
export type BackfillReport = {
  applied: boolean;
  processed: number;
  changed: number;
  unchanged: number;
  failed: { creatorId: string; error: string }[];
  keptEarlierNiches: number;
  fromPayload: number;
  fromStoredFields: number;
  countryCleared: number;
  needsFreshData: { creatorId: string; platform: string; handle: string; reason: string }[];
  /** Which values changed for each changed creator (no creator text). */
  changes: { creatorId: string; platform: string; fields: string[] }[];
  before: Record<string, Stat>;
  after: Record<string, Stat>;
  lastId: string | null;
  beforeImages: BeforeImage[];
};

// The stored values a run compares; the checked/assessed dates are not compared, so an unchanged creator is not rewritten.
const COMPARED = ["niches", "nicheMain", "nicheStatus", "nicheConfidence", "city", "country", "platformCountry", "statedCountry", "countrySource", "countryConfidence"] as const;
// Keyed exactly as stored (replaceAttributeEvidence trims the same way).
const evidenceKey = (r: { attribute: string; value: string; source: string; status: string; evidence: string }) => `${r.attribute}|${truncate(r.value, 80)}|${r.source}|${r.status}|${truncate(wholeChars(r.evidence), 300)}`;
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function tally(s: Stat, c: { niches: string[]; nicheStatus: string | null; country: string | null; countrySource: string | null }, conflictingNiche: boolean) {
  s.total++;
  if (c.nicheStatus === "variety") s.nicheVariety++;
  else if (c.niches.length > 0) s.nicheKnown++;
  else s.nicheUnknown++;
  if (conflictingNiche) s.nicheConflicting++;
  if (c.country) {
    s.countryKnown++;
    const k = c.countrySource ?? "legacy (no source)";
    s.countryBySource[k] = (s.countryBySource[k] ?? 0) + 1;
  } else s.countryUnknown++;
}

export async function backfillAttributes(o: BackfillOptions): Promise<BackfillReport> {
  const now = o.now ?? (() => new Date());
  const batchSize = o.batchSize ?? 200;
  const report: BackfillReport = { applied: o.apply, processed: 0, changed: 0, unchanged: 0, failed: [], keptEarlierNiches: 0, fromPayload: 0, fromStoredFields: 0, countryCleared: 0, needsFreshData: [], changes: [], before: {}, after: {}, lastId: o.after ?? null, beforeImages: [] };
  const stat = (side: "before" | "after", platform: string) => (report[side][platform] ??= emptyStat());

  for (;;) {
    const remaining = o.limit === undefined ? batchSize : Math.min(batchSize, o.limit - report.processed);
    if (remaining <= 0) break;
    const batch = await o.db.withSystem((tx) =>
      tx
        .select({ id: creators.id, displayName: creators.displayName, platform: creators.primaryPlatform, handle: creators.primaryHandle, ...SNAPSHOT_COLS, confirmedCountry: creators.confirmedCountry })
        .from(creators)
        .where(and(eq(creators.status, "active"), ...(report.lastId ? [gt(creators.id, report.lastId)] : [])))
        .orderBy(asc(creators.id))
        .limit(remaining),
    );
    if (batch.length === 0) break;
    for (const c of batch) {
      report.processed++;
      report.lastId = c.id;
      try {
        await o.db.withSystem(async (tx) => {
          const source = await sourceProfile(tx, o, c, now());
          if (source.kind === "missing") {
            report.needsFreshData.push({ creatorId: c.id, platform: c.platform, handle: c.handle, reason: source.reason });
            const existing = await currentEvidence(tx, c.id);
            tally(stat("before", c.platform), c, existing.some((r) => r.attribute === "niche" && r.status === "conflicting"));
            tally(stat("after", c.platform), c, existing.some((r) => r.attribute === "niche" && r.status === "conflicting"));
            report.unchanged++;
            return;
          }
          if (source.fromPayload) report.fromPayload++;
          else report.fromStoredFields++;
          const d = deriveAttributes(source.profile, null, { usePostText: o.usePostText(c.platform) });
          const existing = await currentEvidence(tx, c.id);
          tally(stat("before", c.platform), c, existing.some((r) => r.attribute === "niche" && r.status === "conflicting"));
          const placed = await placeAttributes(tx, c.id, d);
          const v = { ...c, ...placed.values } as typeof c;
          const effective = [...(placed.keptNiches ? existing.filter((r) => r.attribute === "niche") : []), ...d.evidence.filter((r) => !(placed.keptNiches && r.attribute === "niche"))];
          tally(stat("after", c.platform), { niches: v.niches, nicheStatus: v.nicheStatus, country: v.country, countrySource: v.countrySource }, effective.some((r) => r.attribute === "niche" && r.status === "conflicting"));
          if (placed.keptNiches) report.keptEarlierNiches++;
          if (c.country && !v.country) report.countryCleared++;
          const fields = (COMPARED.filter((k) => (k === "niches" ? !sameSet(c.niches, v.niches) : c[k] !== v[k])) as string[]).concat(sameSet(existing.map(evidenceKey), effective.map(evidenceKey)) ? [] : ["evidence"]);
          if (fields.length === 0) {
            report.unchanged++;
            return;
          }
          report.changed++;
          if (report.changes.length < 5000) report.changes.push({ creatorId: c.id, platform: c.platform, fields });
          if (!o.apply) return;
          report.beforeImages.push({ creatorId: c.id, columns: Object.fromEntries(Object.keys(SNAPSHOT_COLS).map((k) => [k, c[k as keyof typeof c]])) as Snapshot, evidence: existing });
          await tx.update(creators).set(placed.values).where(eq(creators.id, c.id));
          await replaceAttributeEvidence(tx, c.id, d, source.payloadId, { keepNiches: placed.keptNiches });
          await refreshProfileCountries(tx, c.id, { source: "backfill" });
          await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: c.id, workspaceId: null, payload: { creatorId: c.id }, requestId: null });
        });
      } catch (err) {
        report.failed.push({ creatorId: c.id, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      }
    }
    await o.onBatch?.({ lastId: report.lastId as string, processed: report.processed });
  }
  return report;
}

async function currentEvidence(tx: SystemTx, creatorId: string): Promise<EvidenceSnap[]> {
  return tx
    .select({ attribute: creatorAttributeEvidence.attribute, value: creatorAttributeEvidence.value, source: creatorAttributeEvidence.source, status: creatorAttributeEvidence.status, evidence: creatorAttributeEvidence.evidence, payloadId: creatorAttributeEvidence.payloadId, observedAt: creatorAttributeEvidence.observedAt })
    .from(creatorAttributeEvidence)
    .where(eq(creatorAttributeEvidence.creatorId, creatorId));
}

type Source = { kind: "ok"; profile: StandardProfile; fromPayload: boolean; payloadId: string | null } | { kind: "missing"; reason: string };

/** The newest archived response inside its retention period, else the stored fields. */
async function sourceProfile(tx: SystemTx, o: BackfillOptions, c: { id: string; displayName: string; platform: CreatorPlatform; handle: string }, now: Date): Promise<Source> {
  const [profile] = await tx.execute<{ handle: string; bio: string | null; canonical_url: string }>(
    sql`select handle, bio, canonical_url from gcp.creator_profiles where creator_id = ${c.id} and platform = ${c.platform} order by followers desc nulls last limit 1`,
  );
  if (!profile) return { kind: "missing", reason: "no stored profile on the primary platform" };
  const [payload] = await tx.execute<{ id: string; storage_key: string }>(
    sql`select id, storage_key from platform.raw_payloads where canonical_url = ${profile.canonical_url} and delete_after > ${now.toISOString()}::timestamptz order by fetched_at desc limit 1`,
  );
  if (payload) {
    const raw = await o.readPayload(payload.storage_key);
    const std = raw === null ? null : standardize(c.platform, profile.handle, raw, { maxPosts: o.maxPosts(c.platform) });
    if (std?.kind === "ok") return { kind: "ok", profile: std.profile, fromPayload: true, payloadId: payload.id };
  }
  if (!profile.bio?.trim()) return { kind: "missing", reason: "no bio stored and no archived response inside its retention period" };
  // The platform country recorded from an earlier (in-retention) response, kept as evidence.
  const [declared] = await tx.execute<{ value: string }>(
    sql`select value from gcp.creator_attribute_evidence where creator_id = ${c.id} and attribute = 'country' and source = 'platform_registration' order by observed_at desc limit 1`,
  );
  const stored: StandardProfile = {
    platform: c.platform,
    handle: profile.handle,
    displayName: c.displayName,
    bio: profile.bio,
    followers: null,
    following: null,
    posts: null,
    verified: false,
    websiteUrls: [],
    businessEmail: null,
    businessPhone: null,
    country: declared?.value ?? null,
    avatarUrl: null,
    recentPosts: [],
  };
  return { kind: "ok", profile: stored, fromPayload: false, payloadId: null };
}

/** Restores the before-images a backfill run recorded (values and evidence rows), then marks the creators changed. */
export async function restoreBeforeImages(db: Db, images: BeforeImage[]): Promise<number> {
  for (const img of images) {
    await db.withSystem(async (tx) => {
      const cols = img.columns as Record<string, unknown>;
      for (const k of ["nicheAssessedAt", "countryCheckedAt"]) if (typeof cols[k] === "string") cols[k] = new Date(cols[k] as string);
      await tx.update(creators).set(cols).where(eq(creators.id, img.creatorId));
      await tx.delete(creatorAttributeEvidence).where(eq(creatorAttributeEvidence.creatorId, img.creatorId));
      if (img.evidence.length) {
        await tx.insert(creatorAttributeEvidence).values(
          img.evidence.map((e) => ({ creatorId: img.creatorId, attribute: e.attribute as never, value: e.value, source: e.source as never, status: e.status as never, evidence: e.evidence, payloadId: e.payloadId, observedAt: new Date(e.observedAt) })),
        );
      }
      await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: img.creatorId, workspaceId: null, payload: { creatorId: img.creatorId }, requestId: null });
    });
  }
  return images.length;
}

