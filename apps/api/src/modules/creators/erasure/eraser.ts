import type { Logger } from "@mushin/core";
import { inArray } from "drizzle-orm";
import { rawPayloads, writeOutbox, type Db } from "@mushin/db";
import { AVATAR_BUCKET, RAW_PAYLOAD_BUCKET, type ObjectStorage } from "@mushin/integrations";
import { findIdByCanonicalUrl } from "../repository";
import { normalizeProfileUrl, type CreatorPlatform } from "../rules";
import { suppress, urlHash } from "../suppressions";
import * as repo from "./repository";

const EMAIL_KEEP_DAYS = 30;

/** Spec §7. Every step is safe to repeat: a retry finishes what a crash left. */
export function createEraser(deps: { db: Db; storage: ObjectStorage | null; logger: Logger; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function erase(removalRequestId: string): Promise<void> {
    const r = await deps.db.withSystem((tx) => repo.getRequest(tx, removalRequestId));
    if (!r || r.status !== "processed") return;
    const requested = r.urls
      .map((u) => normalizeProfileUrl(u))
      .filter((n): n is { platform: CreatorPlatform; canonicalUrl: string } => n !== null);
    // Links are resolved again now: a creator added after the request was made is erased too (stale binding).
    const creatorIds = new Set<string>(r.creatorId ? [r.creatorId] : []);
    for (const n of requested) {
      const id = await deps.db.withSystem((tx) => findIdByCanonicalUrl(tx, n.canonicalUrl));
      if (id) creatorIds.add(id);
    }
    const own: { canonicalUrl: string; platform: CreatorPlatform }[] = [];
    const avatars: string[] = [];
    for (const id of creatorIds) {
      own.push(...(await deps.db.withSystem((tx) => repo.profileUrls(tx, id))));
      const key = await deps.db.withSystem((tx) => repo.avatarKeyOf(tx, id));
      if (key) avatars.push(key);
    }
    const entries = [...new Map([...own, ...requested].map((e) => [e.canonicalUrl, { canonicalUrl: e.canonicalUrl, platform: e.platform }])).values()];
    const urls = entries.map((e) => e.canonicalUrl);
    const byId = new Map<string, { id: string; storageKey: string }>();
    for (const id of [...creatorIds, null]) for (const p of await deps.db.withSystem((tx) => repo.payloadsFor(tx, id, urls))) byId.set(p.id, p);
    const payloads = [...byId.values()];
    // Files first (spec §7 step 2): the rows that point at them are deleted after.
    if (deps.storage) {
      if (payloads.length > 0) await deps.storage.remove(RAW_PAYLOAD_BUCKET, payloads.map((p) => p.storageKey));
      if (avatars.length > 0) await deps.storage.remove(AVATAR_BUCKET, avatars);
    } else if (payloads.length > 0 || avatars.length > 0) {
      throw new Error("File storage is not configured: cannot erase archived files");
    }
    await deps.db.withSystem(async (tx) => {
      if (payloads.length > 0) await tx.delete(rawPayloads).where(inArray(rawPayloads.id, payloads.map((p) => p.id)));
      if (creatorIds.size === 0) await repo.scrubWorkspaceRows(tx, null, urls);
      for (const id of creatorIds) {
        await repo.scrubWorkspaceRows(tx, id, urls);
        await repo.eraseRows(tx, id, []);
      }
      await repo.purgeCachedSearches(tx, entries.map((e) => e.canonicalUrl));
      await suppress(tx, entries, r.id);
      // The request keeps only hashes of the links from now on.
      if (!r.urls.every((u) => u.startsWith("sha256:"))) {
        await repo.hashUrls(tx, r.id, entries.map((e) => `sha256:${urlHash(e.canonicalUrl)}`));
        await writeOutbox(tx, { eventType: "notify.removal_processed", aggregateType: "removal_request", aggregateId: r.id, workspaceId: null, payload: { removalRequestId: r.id }, requestId: null });
      }
    });
  }

  /** The requester's email is kept only to confirm (sub-project 7); it goes 30 days after the request was handled. */
  function clearOldEmails(): Promise<number> {
    return deps.db.withSystem((tx) => repo.clearEmailsBefore(tx, new Date(now().getTime() - EMAIL_KEEP_DAYS * 86_400_000)));
  }

  return { erase, clearOldEmails };
}

export type Eraser = ReturnType<typeof createEraser>;
