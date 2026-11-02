/**
 * The daily creator lifecycle check, run by hand (owner instruction 2026-10-26). Dry run by default: it reports refreshes
 * due, unavailable profiles, profiles waiting for a second "not found", removal requests waiting, location states and
 * how many search documents disagree with the eligibility policy now. --apply re-projects those documents (show/hide
 * only; nothing is deleted and no paid refresh is started).
 *
 *   node --import tsx scripts/ops/lifecycle-sweep.ts --db mushin_catalog_v3 [--apply]
 * Local databases only (mushin_*); the frozen evaluation corpus is refused.
 */
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createCreatorIndexer, lifecycleSweep } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false } } });
const name = values.db ?? "";
if (!/^mushin_[a-z0-9_]+$/.test(name) || /eval/.test(name)) throw new Error("--db must name a local database (mushin_*), never an evaluation corpus");
const url = `postgres://postgres@127.0.0.1:54330/${name}`;
const db = createDatabase(url, { max: 2, applicationName: "lifecycle-sweep", caPem: null });
const logger = createLogger({ level: "silent" });
const indexer = createCreatorIndexer({ db, index: null, logger, sourcePolicy: { youtubeDerivedMetrics: false } });
const report = await lifecycleSweep({ db, apply: values.apply, reproject: (ids) => indexer.sync(ids) });
console.log(JSON.stringify(report, null, 1));
await db.close();
