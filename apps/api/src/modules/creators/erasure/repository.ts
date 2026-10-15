import { and, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import {
  creatorContacts,
  creatorLinks,
  creatorProfiles,
  creators,
  rawPayloads,
  removalRequests,
  serperCache,
  writeOutbox,
  type SystemTx,
} from "@mushin/db";

export type RemovalRow = typeof removalRequests.$inferSelect;

export async function insertRequest(tx: SystemTx, r: { urls: string[]; creatorId: string | null; emailEncrypted: string; reason: string | null }): Promise<string> {
  const [row] = await tx.insert(removalRequests).values({ urls: r.urls, creatorId: r.creatorId, requesterEmailEncrypted: r.emailEncrypted, reason: r.reason }).returning({ id: removalRequests.id });
  if (!row) throw new Error("removal request insert returned no row");
  return row.id;
}

const changed = (tx: SystemTx, creatorId: string) =>
  writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: null });

/** Hidden from every workspace at once (spec §7 step 2); the index drops it on `creator.changed`. */
export async function hideCreator(tx: SystemTx, creatorId: string): Promise<void> {
  const rows = await tx.update(creators).set({ status: "removal_requested" }).where(and(eq(creators.id, creatorId), eq(creators.status, "active"))).returning({ id: creators.id });
  if (rows.length > 0) await changed(tx, creatorId);
}

export async function restoreCreator(tx: SystemTx, creatorId: string): Promise<void> {
  const rows = await tx.update(creators).set({ status: "active" }).where(and(eq(creators.id, creatorId), eq(creators.status, "removal_requested"))).returning({ id: creators.id });
  if (rows.length > 0) await changed(tx, creatorId);
}

export async function requestForUpdate(tx: SystemTx, id: string): Promise<RemovalRow | null> {
  const rows = await tx.select().from(removalRequests).where(eq(removalRequests.id, id)).for("update").limit(1);
  return rows[0] ?? null;
}

export async function getRequest(tx: SystemTx, id: string): Promise<RemovalRow | null> {
  const rows = await tx.select().from(removalRequests).where(eq(removalRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function otherOpenRequests(tx: SystemTx, creatorId: string, exceptId: string): Promise<number> {
  const rows = await tx
    .select({ id: removalRequests.id })
    .from(removalRequests)
    .where(and(eq(removalRequests.creatorId, creatorId), eq(removalRequests.status, "received"), ne(removalRequests.id, exceptId)));
  return rows.length;
}

export async function finishRequest(tx: SystemTx, id: string, status: "processed" | "rejected", staffId: string | null, note: string | null): Promise<void> {
  await tx.update(removalRequests).set({ status, handledByStaffId: staffId, staffNote: note, processedAt: sql`now()` }).where(eq(removalRequests.id, id));
}

export function listRequests(tx: SystemTx, status: RemovalRow["status"]) {
  return tx
    .select({
      r: removalRequests,
      creator: { id: creators.id, displayName: creators.displayName, handle: creators.primaryHandle, platform: creators.primaryPlatform },
    })
    .from(removalRequests)
    .leftJoin(creators, eq(creators.id, removalRequests.creatorId))
    .where(eq(removalRequests.status, status))
    .orderBy(removalRequests.createdAt)
    .limit(200);
}

export async function profileUrls(tx: SystemTx, creatorId: string): Promise<{ canonicalUrl: string; platform: "instagram" | "tiktok" | "youtube" }[]> {
  return tx.select({ canonicalUrl: creatorProfiles.canonicalUrl, platform: creatorProfiles.platform }).from(creatorProfiles).where(eq(creatorProfiles.creatorId, creatorId));
}

export async function payloadsFor(tx: SystemTx, creatorId: string | null, urls: string[]): Promise<{ id: string; storageKey: string }[]> {
  const conds = [urls.length > 0 ? inArray(rawPayloads.canonicalUrl, urls) : undefined, creatorId ? eq(rawPayloads.creatorId, creatorId) : undefined].filter((c) => c !== undefined);
  if (conds.length === 0) return [];
  return tx.select({ id: rawPayloads.id, storageKey: rawPayloads.storageKey }).from(rawPayloads).where(or(...conds));
}

export async function avatarKeyOf(tx: SystemTx, creatorId: string): Promise<string | null> {
  const rows = await tx.select({ key: creators.avatarKey }).from(creators).where(eq(creators.id, creatorId)).limit(1);
  return rows[0]?.key ?? null;
}

/** Spec §7 step 3: every personal row of the creator, in one transaction; the creator row stays as a tombstone. */
export async function eraseRows(tx: SystemTx, creatorId: string, payloadIds: string[]): Promise<void> {
  if (payloadIds.length > 0) await tx.delete(rawPayloads).where(inArray(rawPayloads.id, payloadIds));
  await tx.delete(creatorContacts).where(eq(creatorContacts.creatorId, creatorId));
  await tx.delete(creatorLinks).where(eq(creatorLinks.creatorId, creatorId));
  // Snapshots are append-only for every app role; only this function deletes them (migration 0015).
  await tx.execute(sql`select platform.erase_creator_snapshots(${creatorId}::uuid)`);
  await tx.delete(creatorProfiles).where(eq(creatorProfiles.creatorId, creatorId));
  await tx
    .update(creators)
    .set({
      status: "erased",
      displayName: "Erased creator",
      primaryHandle: "erased",
      avatarUrl: null,
      avatarKey: null,
      city: null,
      country: null,
      niches: [],
      tags: [],
      verified: false,
      authenticityScore: null,
      fakeFollowerPct: null,
      aiSummary: null,
      aiSummaryModel: null,
      aiSummaryAt: null,
      aiSummarySourceHash: null,
      aiSummaryFailedAt: null,
      minorReason: null,
      minorOverrideReason: null,
      assessmentStatus: null,
    })
    .where(eq(creators.id, creatorId));
  await changed(tx, creatorId);
}

/** Every workspace's rows that point at the creator or name their links (migration 0014; RLS hides them otherwise). */
export async function scrubWorkspaceRows(tx: SystemTx, creatorId: string | null, canonicalUrls: string[]): Promise<void> {
  const urls = canonicalUrls.length > 0 ? sql`array[${sql.join(canonicalUrls.map((u) => sql`${u}`), sql`, `)}]::text[]` : sql`'{}'::text[]`;
  await tx.execute(sql`select platform.erase_creator_workspace_rows(${creatorId}::uuid, ${urls})`);
}

/** Cached Google results that mention the creator's profiles (kept up to 7 days otherwise). */
export async function purgeCachedSearches(tx: SystemTx, canonicalUrls: string[]): Promise<void> {
  for (const u of canonicalUrls) {
    const path = u.replace(/^https?:\/\//, "");
    await tx.delete(serperCache).where(sql`${serperCache.results}::text ilike ${`%${path}%`}`);
  }
}

export async function hashUrls(tx: SystemTx, id: string, hashed: string[]): Promise<void> {
  await tx.update(removalRequests).set({ urls: hashed }).where(eq(removalRequests.id, id));
}

export async function clearEmailsBefore(tx: SystemTx, before: Date): Promise<number> {
  const rows = await tx
    .update(removalRequests)
    .set({ requesterEmailEncrypted: null })
    .where(and(isNotNull(removalRequests.requesterEmailEncrypted), isNotNull(removalRequests.processedAt), lt(removalRequests.processedAt, before)))
    .returning({ id: removalRequests.id });
  return rows.length;
}
