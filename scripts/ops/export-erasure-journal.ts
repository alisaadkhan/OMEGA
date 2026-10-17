/**
 * Erasure journal (audit OPS-04): the hashes of every suppressed (erased or removal-requested) profile link, written to
 * a file kept OUTSIDE the database and its backups. After a restore, `after-restore.ts` applies it again, so an older
 * backup cannot bring back a creator erased since. Holds only SHA-256 hashes and platforms: no names, links or emails.
 * Run daily (and before any planned restore); keep the latest copies with the backups' retention.
 *   npm run ops:erasure-journal -- [out.json]      (default ./erasure-journal-<date>.json)
 */
import { writeFileSync } from "node:fs";
import { loadWorkerConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { sql } from "drizzle-orm";

const config = loadWorkerConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-erasure-journal", caPem: config.databaseCaPem });
try {
  const rows = await db.withSystem((tx) =>
    tx.execute<{ urlHash: string; platform: string; at: string }>(sql`select url_hash as "urlHash", platform, created_at::text as at from gcp.creator_suppressions order by created_at, url_hash`),
  );
  const exportedAt = new Date().toISOString();
  const out = process.argv[2] ?? `erasure-journal-${exportedAt.slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify({ format: "mushin.erasure-journal.v1", exportedAt, entries: rows.map((r) => ({ urlHash: r.urlHash, platform: r.platform })) }));
  console.log(`wrote ${rows.length} suppression hash(es) to ${out}`);
} finally {
  await db.close();
}
