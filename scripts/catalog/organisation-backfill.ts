/**
 * Organisation accounts backfill (0072, owner decision 2026-11-03): marks creators whose Instagram category names an
 * organisation (restaurant, brand, magazine, agency, venue...) so they leave search; nothing is deleted, and a staff
 * override is never touched. Then the changed creators are re-projected.
 *
 *   node --import tsx scripts/catalog/organisation-backfill.ts --db mushin_catalog_v4 [--apply]
 *     categories from each Instagram profile's stored provider answer;
 *   node --env-file=.env --import tsx scripts/catalog/organisation-backfill.ts --live --from mushin_catalog_v4 [--apply]
 *     the live database has no stored answers: categories are copied from the local catalogue by Instagram handle.
 * Dry run by default.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase, type Db } from "@mushin/db";
import { sql } from "drizzle-orm";
import { createCreatorIndexer, organisationCategory, standardize } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, from: { type: "string" }, apply: { type: "boolean", default: false }, live: { type: "boolean", default: false } } });
const local = (name: string): Db => {
  if (!/^mushin_catalog_[a-z0-9_]+$/.test(name) || /eval/.test(name)) throw new Error("catalogue names must be local operational catalogues (mushin_catalog_*)");
  return createDatabase(`postgres://postgres@127.0.0.1:54330/${name}`, { max: 2, applicationName: "organisation-backfill" });
};
const liveUrl = values.live ? process.env["DIRECT_URL"] : undefined;
if (values.live && (!liveUrl || !values.from)) throw new Error("--live needs DIRECT_URL (run with --env-file=.env) and --from <local catalogue>");
const db = liveUrl ? createDatabase(liveUrl, { max: 2, applicationName: "organisation-backfill", caPem: null }) : local(values.db ?? "");
const logger = createLogger({ level: "info", name: "organisation-backfill" });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Instagram handle → organisation category (null = a person), from stored answers of a local catalogue. */
async function categories(source: Db, name: string): Promise<Map<string, string | null>> {
  const rows = await source.withSystem((tx) =>
    tx.execute<{ handle: string; key: string | null }>(sql`
      select lower(p.handle) handle, (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = 'instagram' and r.provider = 'apify' order by r.fetched_at desc limit 1) key
      from gcp.creator_profiles p where p.platform = 'instagram'`),
  );
  const out = new Map<string, string | null>();
  for (const r of rows) {
    const file = r.key ? join(root, ".catalog-storage", name, "raw-payloads", r.key) : "";
    if (!file || !existsSync(file)) continue;
    const std = standardize("instagram", r.handle, JSON.parse(readFileSync(file, "utf8")), { maxPosts: 1 });
    if (std.kind === "ok") out.set(r.handle, organisationCategory(std.profile.accountCategory));
  }
  return out;
}

const sourceName = values.live ? (values.from as string) : (values.db as string);
const source = values.live ? local(sourceName) : db;
const known = await categories(source, sourceName);
if (source !== db) await source.close();
const rows = [...known.entries()].map(([handle, category]) => ({ handle, category }));

const result = await db.withSystem(async (tx) => {
  const changes = await tx.execute<{ id: string; handle: string; before: string | null; after: string | null }>(sql`
    select distinct on (c.id) c.id, m.handle, c.organisation_category before, m.category after
    from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id and p.platform = 'instagram'
    join jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as m(handle text, category text) on lower(p.handle) = m.handle
    where c.organisation_category is distinct from m.category and c.organisation_override_by_staff_id is null
    order by c.id, p.followers desc nulls last`);
  if (values.apply && changes.length > 0) {
    await tx.execute(sql`
      update gcp.creators c set organisation_category = u.after, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify([...changes].map((c) => ({ id: c.id, after: c.after })))}::jsonb) as u(id uuid, after text)
      where c.id = u.id`);
  }
  return [...changes];
});
if (values.apply && result.length > 0) {
  const ix = createCreatorIndexer({ db, index: null, logger });
  const ids = result.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) await ix.sync(ids.slice(i, i + 200));
}
const marked = result.filter((r) => r.after !== null);
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", target: values.live ? "live" : values.db, categoriesKnown: known.size, changed: result.length, marked: marked.length, cleared: result.length - marked.length, accounts: marked.map((r) => `${r.handle} (${r.after})`) }, null, 1));
await db.close();
