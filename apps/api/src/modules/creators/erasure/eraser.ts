import type { Logger } from "@mushin/core";
import { inArray } from "drizzle-orm";
import { rawPayloads, writeOutbox, type Db } from "@mushin/db";
import { AVATAR_BUCKET, RAW_PAYLOAD_BUCKET, type ObjectStorage } from "@mushin/integrations";
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
    const own = r.creatorId ? await deps.db.withSystem((tx) => repo.profileUrls(tx, r.creatorId ?? "")) : [];
    const entries = [...new Map([...own, ...requested].map((e) => [e.canonicalUrl, { canonicalUrl: e.canonicalUrl, platform: e.platform }])).values()];
    const payloads = await deps.db.withSystem((tx) => repo.payloadsFor(tx, r.creatorId, entries.map((e) => e.canonicalUrl)));
    const avatar = r.creatorId ? await deps.db.withSystem((tx) => repo.avatarKeyOf(tx, r.creatorId ?? "")) : null;
    // Files first (spec §7 step 2): the rows that point at them are deleted after.
    if (deps.storage) {
      if (payloads.length > 0) await deps.storage.remove(RAW_PAYLOAD_BUCKET, payloads.map((p) => p.storageKey));
      if (avatar) await deps.storage.remove(AVATAR_BUCKET, [avatar]);
    } else if (payloads.length > 0 || avatar) {
      throw new Error("File storage is not configured: cannot erase archived files");
    }
    await deps.db.withSystem(async (tx) => {
      await repo.scrubWorkspaceRows(tx, r.creatorId, entries.map((e) => e.canonicalUrl));
      if (r.creatorId) await repo.eraseRows(tx, r.creatorId, payloads.map((p) => p.id));
      else if (payloads.length > 0) await tx.delete(rawPayloads).where(inArray(rawPayloads.id, payloads.map((p) => p.id)));
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
