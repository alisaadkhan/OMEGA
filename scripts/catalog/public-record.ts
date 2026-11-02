/**
 * Records a country from a public record (0067) for the creators of a researched seed manifest (owner directive 2026-11-03):
 * each entry's source URL is kept as the evidence, it is never stored as the creator's own confirmation, and a profile whose
 * bio explicitly states a life abroad stays foreign. Then the creators' profile countries are re-decided and search re-projected.
 *
 *   node --import tsx scripts/catalog/public-record.ts --db mushin_catalog_v4 --manifest docs/completion/seed/<file>.json [--apply]
 *   node --env-file=.env --import tsx scripts/catalog/public-record.ts --live --manifest <file> [--apply]
 * Manifest: { candidates: [{ handle, platform?: "instagram"|"tiktok"|"youtube", source, country?: "PK" }] }. Dry run by default.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { bulkRefreshProfileCountries, createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, manifest: { type: "string" }, apply: { type: "boolean", default: false }, live: { type: "boolean", default: false } } });
if (!values.manifest) throw new Error("--manifest is required");
const liveUrl = values.live ? process.env["DIRECT_URL"] : undefined;
if (values.live && !liveUrl) throw new Error("--live needs DIRECT_URL (run with --env-file=.env)");
const dbName = values.db ?? "";
if (!liveUrl && (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName))) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const db = liveUrl ? createDatabase(liveUrl, { max: 2, applicationName: "public-record", caPem: null }) : createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "public-record" });
const logger = createLogger({ level: "info", name: "public-record" });

type Entry = { handle: string; platform?: "instagram" | "tiktok" | "youtube"; source: string; country?: string };
const manifest = JSON.parse(readFileSync(values.manifest, "utf8")) as { candidates: Entry[] };
const entries = manifest.candidates.filter((e) => /^[a-z0-9._-]{1,60}$/i.test(e.handle) && typeof e.source === "string" && e.source.length > 0 && e.source.length <= 500);
const rows = entries.map((e) => ({ handle: e.handle.toLowerCase(), platform: e.platform ?? "instagram", source: e.source, country: (e.country ?? "PK").toUpperCase() }));
if (rows.some((r) => !/^[A-Z]{2}$/.test(r.country))) throw new Error("country must be an ISO code");

const result = await db.withSystem(async (tx) => {
  const found = await tx.execute<{ creator_id: string; handle: string }>(sql`
    select p.creator_id, lower(p.handle) handle from gcp.creator_profiles p
    join jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as m(handle text, platform text, source text, country text) on lower(p.handle) = m.handle and p.platform = m.platform`);
  const ids = [...new Set([...found].map((f) => f.creator_id))];
  if (!values.apply) return { matched: ids.length, missing: rows.filter((r) => ![...found].some((f) => f.handle === r.handle)).map((r) => r.handle), changed: [] as unknown[] };
  await tx.execute(sql`
    update gcp.creators c set public_country = m.country, public_country_source = m.source, public_country_at = now(), updated_at = now()
    from gcp.creator_profiles p join jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as m(handle text, platform text, source text, country text) on lower(p.handle) = m.handle and p.platform = m.platform
    where p.creator_id = c.id and c.public_country is distinct from m.country`);
  const changed = await bulkRefreshProfileCountries(tx, ids, { source: "staff" });
  return { matched: ids.length, missing: rows.filter((r) => ![...found].some((f) => f.handle === r.handle)).map((r) => r.handle), changed };
});
const projection = values.apply ? await createCreatorIndexer({ db, index: null, logger }).reconcile() : null;
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", manifestEntries: rows.length, ...result, changedCount: result.changed.length, changed: undefined, projection }, null, 1));
await db.close();
