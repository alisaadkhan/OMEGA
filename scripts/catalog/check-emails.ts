/**
 * Checks every never-checked creator email (owner, 22 Nov, step 5): format, domain and mail server (MX), nothing is
 * sent. Uses the worker's own checker (contact-checks.ts): each attempt is stored as evidence, the status becomes
 * domain_ok or invalid, and a failed lookup leaves the email unchecked for a later run. Creators whose email proves
 * invalid are re-projected into search at once (production runs no worker to read the outbox).
 *
 *   node --env-file=.env --import tsx scripts/catalog/check-emails.ts --db mushin_catalog_v4            (local catalogue)
 *   DATABASE_SSL_CA_FILE=prod-ca-2021.crt node --env-file=.env --import tsx scripts/catalog/check-emails.ts --live --expect-ref yknp
 */
import { parseArgs } from "node:util";
import { createLogger, readCaFile } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { createContactChecker } from "../../apps/api/src/modules/creators/contact-checks";
import { systemMailResolver } from "../../apps/api/src/modules/creators/email-check";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, live: { type: "boolean", default: false }, "expect-ref": { type: "string" }, concurrency: { type: "string", default: "8" } } });
let url: string;
let caPem: string | null = null;
if (values.live) {
  url = process.env["DIRECT_URL"] ?? "";
  const u = new URL(url);
  const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
  if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected live project (--expect-ref)");
  caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
  if (!caPem) throw new Error("DATABASE_SSL_CA_FILE is required for the live database");
} else {
  if (!/^mushin_catalog_[a-z0-9_]+$/.test(values.db ?? "")) throw new Error("--db must name a local operational catalogue (mushin_catalog_*), or pass --live");
  url = `postgres://postgres@127.0.0.1:54330/${values.db}`;
}
const key = Buffer.from(process.env["DATA_ENCRYPTION_KEY"] ?? "", "base64");
if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be set (32 bytes, base64)");

const logger = createLogger({ level: "warn", name: "check-emails" });
const db = createDatabase(url, { max: 4, applicationName: "check-emails", ...(caPem ? { caPem } : {}) });
const checker = createContactChecker({ db, encryptionKey: key, resolver: systemMailResolver(), logger });
const creators = (await db.withSystem((tx) => tx.execute<{ id: string }>(sql`select distinct creator_id id from gcp.creator_contacts where kind = 'email' and checked_at is null`))).map((r) => r.id);
console.error(`${creators.length} creators with unchecked emails`);

const totals = { creators: creators.length, checked: 0, invalid: 0, failed: 0 };
const invalidCreators: string[] = [];
const queue = [...creators];
let done = 0;
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  while (queue.length) {
    const id = queue.shift() as string;
    const r = await checker.check(id, null);
    totals.checked += r.checked;
    totals.invalid += r.invalid;
    totals.failed += r.failed;
    if (r.invalid > 0) invalidCreators.push(id);
    if (++done % 100 === 0) console.error(`… ${done}/${creators.length}`);
  }
}));
if (invalidCreators.length) {
  await createCreatorIndexer({ db, index: null, logger, sourcePolicy: { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" } }).sync(invalidCreators);
}
const status = await db.withSystem((tx) => tx.execute<{ status: string; detail: string | null; n: number }>(sql`select status, check_detail detail, count(*)::int n from gcp.creator_contacts where kind = 'email' group by 1, 2 order by 3 desc`));
await db.close();
console.log(JSON.stringify({ target: values.live ? "live" : values.db, ...totals, reprojected: invalidCreators.length, emailStatusNow: status }, null, 2));
