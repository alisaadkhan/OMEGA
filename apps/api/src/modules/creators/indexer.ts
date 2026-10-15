import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { SearchIndex } from "@mushin/integrations";
import { ELIGIBILITY_VERSION } from "./eligibility";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { applyDocumentPolicy, DEFAULT_SOURCE_POLICY, type SourcePolicy } from "./source-policy";

const BATCH = 200;

/** Keeps the Meilisearch projection of gcp in step (spec §4.3): per change, and a nightly full comparison. */
export function createCreatorIndexer(o: { db: Db; index: SearchIndex | null; logger: Logger; sourcePolicy?: SourcePolicy }) {
  const policy = o.sourcePolicy ?? DEFAULT_SOURCE_POLICY;
  async function sync(creatorIds: string[]): Promise<void> {
    if (creatorIds.length === 0) return;
    const rows = await o.db.withSystem((tx) => repo.indexRows(tx, creatorIds));
    const keep = rows.filter(isIndexable);
    const docs = keep.map((r) => applyDocumentPolicy(toDocument(r), policy));
    await o.db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
    if (o.index) await o.index.upsert(docs);
    // A creator hidden while we were writing may have had its own sync's removal applied before our upsert.
    // The upsert has been applied by now, so re-checking closes that gap: a later hide syncs after this point.
    const stillVisible = docs.length === 0 ? new Set<string>() : new Set(await o.db.withSystem((tx) => repo.visibleIds(tx, docs.map((d) => d.id))));
    const hidden = creatorIds.filter((id) => !stillVisible.has(id));
    await o.db.withSystem((tx) => repo.removePostgresSearchDocuments(tx, hidden));
    if (o.index) await o.index.remove(hidden);
  }

  async function reconcile(): Promise<{ upserted: number; removed: number }> {
    const wanted = new Map((await o.db.withSystem((tx) => repo.indexState(tx))).map((r) => [r.id, r.updatedEpoch]));
    const postgres = new Map((await o.db.withSystem((tx) => repo.postgresSearchState(tx, ELIGIBILITY_VERSION))).map((r) => [r.id, r.updatedEpoch]));
    const postgresOutdated = [...wanted].filter(([id, at]) => postgres.get(id) !== at).map(([id]) => id);
    const postgresLeftover = [...postgres.keys()].filter((id) => !wanted.has(id));
    for (let i = 0; i < postgresOutdated.length; i += BATCH) await sync(postgresOutdated.slice(i, i + BATCH));
    await o.db.withSystem((tx) => repo.removePostgresSearchDocuments(tx, postgresLeftover));

    let outdated = postgresOutdated.length;
    let leftover = postgresLeftover.length;
    if (o.index) {
      const present = await o.index.listIds(ELIGIBILITY_VERSION);
      const meiliOutdated = [...wanted].filter(([id, at]) => present.get(id) !== at).map(([id]) => id);
      const meiliLeftover = [...present.keys()].filter((id) => !wanted.has(id));
      for (let i = 0; i < meiliOutdated.length; i += BATCH) await sync(meiliOutdated.slice(i, i + BATCH));
      await o.index.remove(meiliLeftover);
      outdated = Math.max(outdated, meiliOutdated.length);
      leftover = Math.max(leftover, meiliLeftover.length);
    }
    if (outdated > 0 || leftover > 0) o.logger.warn({ upserted: outdated, removed: leftover }, "search index drift repaired");
    return { upserted: outdated, removed: leftover };
  }

  return { sync, reconcile, ensureSettings: () => o.index?.ensureSettings() ?? Promise.resolve() };
}

export type CreatorIndexer = ReturnType<typeof createCreatorIndexer>;
