/**
 * Per-profile country for a local catalogue (0060, owner instruction 2026-10-27: Pakistan-only customer catalogue).
 * Recomputes each profile's country from what is already stored (its bio; for YouTube the recorded channel country; a
 * country the creator confirmed). No provider or AI is called. Idempotent: a second run changes nothing.
 *
 *   node --import tsx scripts/catalog/profile-countries.ts --db mushin_catalog_v3            # dry run (default)
 *   node --import tsx scripts/catalog/profile-countries.ts --db mushin_catalog_v3 --apply    # write, log, re-project
 *   node --env-file=.env --import tsx scripts/catalog/profile-countries.ts --live [--apply]  # the hosted database in
 *     DIRECT_URL (owner approval 2026-11-02: backfill after migration 0060 on the live project); TLS required
 *
 * Each change is logged as a "location" lifecycle event (source "backfill"). Nothing is deleted: profiles that are not
 * Pakistani are excluded from customer search by the eligibility rule (elig-2) and stay reviewable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { bulkRefreshProfileCountries, createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false }, live: { type: "boolean", default: false } } });
const liveUrl = values.live ? process.env["DIRECT_URL"] : undefined;
if (values.live && !liveUrl) throw new Error("--live needs DIRECT_URL (run with --env-file=.env)");
const liveRef = liveUrl ? (new URL(liveUrl).username.split(".")[1] ?? new URL(liveUrl).hostname) : null;
const dbName = liveRef ? `live-${liveRef}` : (values.db ?? "");
if (!liveRef && (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName))) throw new Error("--db must name a local operational catalogue (mushin_catalog_*), never an evaluation corpus");
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const logger = createLogger({ level: "info", name: "profile-countries" });
const db = liveUrl
  ? createDatabase(liveUrl, { max: 2, applicationName: "profile-countries", caPem: null })
  : createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "profile-countries" });
const sourcePolicy = { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" };

const tally = (rows: { platform: string; status: string }[]) =>
  rows.reduce<Record<string, Record<string, number>>>((m, r) => ((m[r.platform] ??= {})[r.status] = ((m[r.platform] ?? {})[r.status] ?? 0) + 1, m), {});

const before = await db.withSystem((tx) => tx.execute<{ platform: string; status: string }>(sql`select platform, country_status status from gcp.creator_profiles`));
const ids = await db.withSystem((tx) => tx.execute<{ id: string }>(sql`select id from gcp.creators where status = 'active' order by id`));

let changed = 0;
const transitions: Record<string, number> = {};
if (values.apply) {
  // Batches of 500 creators per transaction (one read, one update, one event insert each): seconds, not an hour.
  const all = [...ids].map((r) => r.id);
  for (let i = 0; i < all.length; i += 500) {
    const out = await db.withSystem((tx) => bulkRefreshProfileCountries(tx, all.slice(i, i + 500), { source: "backfill" }));
    for (const c of out) {
      changed++;
      const k = `${c.platform}: ${c.from} -> ${c.to.status}`;
      transitions[k] = (transitions[k] ?? 0) + 1;
    }
  }
} else {
  // Dry run: the same bulk decisions inside transactions that are always rolled back, so nothing is written.
  const all = [...ids].map((r) => r.id);
  class Rollback extends Error {}
  for (let i = 0; i < all.length; i += 500) {
    await db
      .withSystem(async (tx) => {
        for (const c of await bulkRefreshProfileCountries(tx, all.slice(i, i + 500), { source: "backfill" })) {
          changed++;
          const k = `${c.platform}: ${c.from} -> ${c.to.status}`;
          transitions[k] = (transitions[k] ?? 0) + 1;
        }
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }
}
const projection = values.apply ? await createCreatorIndexer({ db, index: null, logger, sourcePolicy }).reconcile() : null;
const after = await db.withSystem((tx) => tx.execute<{ platform: string; status: string }>(sql`select platform, country_status status from gcp.creator_profiles`));
const summary = { db: dbName, mode: values.apply ? "apply" : "dry-run", at: new Date().toISOString(), creators: ids.length, changed, transitions, before: tally(before), after: values.apply ? tally(after) : "unchanged (dry run)", projection };
const out = join(repo, "docs", "completion", "inventory");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `profile-countries-${dbName}-${summary.mode}.json`), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
await db.close();
