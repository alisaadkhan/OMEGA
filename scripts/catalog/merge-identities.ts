/**
 * Cross-platform identity merge (addendum 3; owner directive 2026-11-04 §3 item 5). Dry run by default: lists every
 * group with its evidence. --apply merges them (platform.merge_creator, 0085) and re-projects search, so one person's
 * Instagram, YouTube and TikTok show as one creator card. Idempotent.
 *
 *   node --import tsx scripts/catalog/merge-identities.ts --db mushin_catalog_v4 [--apply] [--out file.json]
 *   node --env-file=.env --import tsx scripts/catalog/merge-identities.ts --live [--apply]   # DIRECT_URL, after approval
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createCreatorIndexer, findMergeGroups, mergeGroups } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, live: { type: "boolean", default: false }, apply: { type: "boolean", default: false }, out: { type: "string" } } });
const liveUrl = values.live ? process.env["DIRECT_URL"] : undefined;
if (values.live && !liveUrl) throw new Error("--live needs DIRECT_URL (run with --env-file=.env)");
const dbName = values.db ?? "";
if (!values.live && (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName))) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const db = liveUrl ? createDatabase(liveUrl, { max: 2, applicationName: "merge-identities", caPem: null }) : createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "merge-identities" });
const logger = createLogger({ level: "info", name: "merge-identities" });

const groups = await findMergeGroups(db);
const report: Record<string, unknown> = {
  mode: values.apply ? "apply" : "dry-run",
  target: liveUrl ? "live" : dbName,
  groups: groups.length,
  creatorsAbsorbed: groups.reduce((s, g) => s + g.absorb.length, 0),
  sample: groups.slice(0, 40).map((g) => ({ handles: g.handles, evidence: g.evidence })),
};
if (values.apply) {
  // A merge can complete a chain (Instagram links the creator that now holds YouTube and TikTok): repeat until done.
  let merged = 0;
  const refused: unknown[] = [];
  const touched = new Set<string>();
  let todo = groups;
  for (let pass = 0; pass < 5 && todo.length > 0; pass++) {
    const r = await mergeGroups(db, todo);
    merged += r.merged;
    refused.push(...r.refused);
    for (const id of r.touched) touched.add(id);
    if (r.merged === 0) break;
    todo = await findMergeGroups(db);
  }
  const indexer = createCreatorIndexer({ db, index: null, logger });
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 200) await indexer.sync(ids.slice(i, i + 200));
  Object.assign(report, { merged, refused, remainingGroups: todo.length, projection: await indexer.reconcile() });
}
const text = JSON.stringify(report, null, 1);
if (values.out) writeFileSync(values.out, text);
console.log(text);
await db.close();
