import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { SearchIndex } from "@mushin/integrations";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";

const BATCH = 200;

/** Keeps the Meilisearch projection of gcp in step (spec §4.3): per change, and a nightly full comparison. */
export function createCreatorIndexer(o: { db: Db; index: SearchIndex; logger: Logger }) {
  async function sync(creatorIds: string[]): Promise<void> {
    if (creatorIds.length === 0) return;
    const rows = await o.db.withSystem((tx) => repo.indexRows(tx, creatorIds));
    const keep = rows.filter(isIndexable);
    const kept = new Set(keep.map((r) => r.id));
    await o.index.upsert(keep.map(toDocument));
    await o.index.remove(creatorIds.filter((id) => !kept.has(id)));
  }

  async function reconcile(): Promise<{ upserted: number; removed: number }> {
    const wanted = new Map((await o.db.withSystem((tx) => repo.indexState(tx))).map((r) => [r.id, r.updatedEpoch]));
    const present = await o.index.listIds();
    const outdated = [...wanted].filter(([id, at]) => present.get(id) !== at).map(([id]) => id);
    const leftover = [...present.keys()].filter((id) => !wanted.has(id));
    for (let i = 0; i < outdated.length; i += BATCH) await sync(outdated.slice(i, i + BATCH));
    await o.index.remove(leftover);
    if (outdated.length > 0 || leftover.length > 0) o.logger.warn({ upserted: outdated.length, removed: leftover.length }, "search index drift repaired");
    return { upserted: outdated.length, removed: leftover.length };
  }

  return { sync, reconcile, ensureSettings: () => o.index.ensureSettings() };
}

export type CreatorIndexer = ReturnType<typeof createCreatorIndexer>;
