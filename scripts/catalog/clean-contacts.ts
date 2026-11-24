/**
 * Contact clean-up from the owner's spreadsheet audit (23 Nov). Dry run by default; --apply writes.
 *   1. Phones stored as "+0…" (a Pakistani national number saved with a stray "+") become +92… E.164, as normPhone
 *      now reads them (06d17ba); a number then repeated on the same creator is kept once.
 *   2. Listed typo emails are removed (--strip a@b.co,c@d.com): they can pass a domain check yet never deliver.
 * Values are decrypted only in memory with DATA_ENCRYPTION_KEY and written back encrypted, hashed and masked exactly
 * as the ingest path does. Prints counts only, never a contact value.
 *
 *   node --env-file=.env --import tsx scripts/catalog/clean-contacts.ts --db mushin_catalog_v4 --strip "x@y.co" [--apply]
 *   DATABASE_SSL_CA_FILE=prod-ca-2021.crt node --env-file=.env --import tsx scripts/catalog/clean-contacts.ts --live --expect-ref yknp --strip "x@y.co" [--apply]
 * Live (owner, 24 Nov: "copy catalogue contact fix"): the same rules on the live database, over verified TLS only, with
 * the live key (LIVE_DATA_ENCRYPTION_KEY, else DATA_ENCRYPTION_KEY); the changed creators are re-projected at once.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createLogger, decryptSecret, encryptSecret, readCaFile, sha256Hex } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";
import { normPhone } from "../../apps/api/src/modules/creators/enrichment/links";
import { maskContact } from "../../apps/api/src/modules/creators/rules";

const { values } = parseArgs({ options: { db: { type: "string" }, live: { type: "boolean", default: false }, "expect-ref": { type: "string" }, strip: { type: "string", default: "" }, apply: { type: "boolean", default: false } } });
let url: string;
let caPem: string | null = null;
if (values.live) {
  url = process.env["DIRECT_URL"] ?? "";
  const u = new URL(url);
  const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
  if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected live project (--expect-ref)");
  caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
  if (!caPem) throw new Error("DATABASE_SSL_CA_FILE is required for the live database (contacts are personal data)");
} else {
  const dbName = values.db ?? "";
  if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*), or pass --live");
  url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
}
const keyText = values.live ? (process.env["LIVE_DATA_ENCRYPTION_KEY"] ?? process.env["DATA_ENCRYPTION_KEY"]) : process.env["DATA_ENCRYPTION_KEY"];
if (!keyText) throw new Error("DATA_ENCRYPTION_KEY is needed to read and rewrite contacts");
const key = Buffer.from(keyText, "base64");
const strip = new Set((values.strip ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
const db = createDatabase(url, { max: 2, applicationName: "clean-contacts", ...(caPem ? { caPem } : {}) });
const logger = createLogger({ level: "info", name: "clean-contacts" });

type Row = { id: string; creator_id: string; kind: "email" | "phone"; value_encrypted: string; first_seen_at: Date };
const rows = await db.withSystem((tx) => tx.execute<Row>(sql`select id::text, creator_id::text, kind, value_encrypted, first_seen_at from gcp.creator_contacts order by creator_id, kind, first_seen_at, id`));

const fixes: { id: string; creator: string; value: string }[] = [];
const drops: { id: string; creator: string; why: "duplicate" | "typo_email" }[] = [];
const seen = new Map<string, string>(); // creator|kind|normalised value -> kept row id
for (const r of rows) {
  let value: string;
  try {
    value = decryptSecret(r.value_encrypted, key);
  } catch {
    continue;
  }
  if (r.kind === "email" && strip.has(value.trim().toLowerCase())) {
    drops.push({ id: r.id, creator: r.creator_id, why: "typo_email" });
    continue;
  }
  let next = value;
  if (r.kind === "phone" && /^\+0[1-9]\d{8,10}$/.test(value.replace(/[^\d+]/g, ""))) next = normPhone(value.replace(/^\s*\+/, "")) ?? value;
  const k = `${r.creator_id}|${r.kind}|${next.trim().toLowerCase()}`;
  if (seen.has(k)) {
    drops.push({ id: r.id, creator: r.creator_id, why: "duplicate" });
    continue;
  }
  seen.set(k, r.id);
  if (next !== value) fixes.push({ id: r.id, creator: r.creator_id, value: next });
}
logger.info({ target: values.live ? "live" : values.db, mode: values.apply ? "apply" : "dry-run", phonesNormalised: fixes.length, duplicatesRemoved: drops.filter((d) => d.why === "duplicate").length, typoEmailsRemoved: drops.filter((d) => d.why === "typo_email").length, creators: new Set([...fixes, ...drops].map((x) => x.creator)).size }, "contact clean-up");

if (values.apply) {
  await db.withSystem(async (tx) => {
    for (const d of drops) await tx.execute(sql`delete from gcp.creator_contacts where id = ${d.id}::uuid`);
    for (const f of fixes)
      await tx.execute(sql`update gcp.creator_contacts set value_encrypted = ${encryptSecret(f.value, key)}, value_hash = ${sha256Hex(f.value.trim().toLowerCase())}, masked = ${maskContact("phone", f.value)} where id = ${f.id}::uuid`);
  });
  await createCreatorIndexer({ db, index: null, logger, sourcePolicy: { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" } }).sync([...new Set([...fixes, ...drops].map((x) => x.creator))]);
}
await db.close();
