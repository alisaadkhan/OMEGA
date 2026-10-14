/**
 * Rebuilds the catalog search projections from PostgreSQL (the source of truth) on demand: the same comparison the
 * worker runs nightly (`creator.reindex_all`). Repairs the PostgreSQL projection always, and Meilisearch when it is
 * configured. Safe to repeat: it only upserts outdated documents and removes ones that should no longer be visible.
 *
 *   npm run search:reindex
 */
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createSearchIndex } from "@mushin/integrations";
import { createCreatorIndexer } from "../apps/api/src/modules/creators/index";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: "info", name: "search-reindex" });
const db = createDatabase(config.databaseUrl, { max: 2, applicationName: "mushin-search-reindex", caPem: config.databaseCaPem });
const index = config.search ? createSearchIndex(config.search, logger) : null;
const indexer = createCreatorIndexer({ db, index, logger });
try {
  await indexer.ensureSettings();
  const result = await indexer.reconcile();
  console.log(`Reindexed from PostgreSQL${index ? " (PostgreSQL projection and Meilisearch)" : " (PostgreSQL projection only; Meilisearch not configured)"}: ${result.upserted} upserted, ${result.removed} removed.`);
} finally {
  await db.close();
}
