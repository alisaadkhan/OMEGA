/**
 * Copies creator contacts from a local operational catalogue to the live catalogue (owner, 22 Nov: "move the existing
 * contacts to production encrypted with the live key"). load-staging.ts and live-sync.ts never copy contacts; this is
 * the one path that does, under these rules:
 *   - only contacts of creators the live catalogue already has as active (new creators arrive through load-staging);
 *   - every value is decrypted with the local key, checked against its stored hash, and sealed again with the live key
 *     (LIVE_DATA_ENCRYPTION_KEY, or DATA_ENCRYPTION_KEY when the live API uses the same key); nothing is printed but counts;
 *   - a contact live already has (same creator, kind and value hash) is left as it is, so a live check result or a
 *     customer reveal is never overwritten; status, trust and source travel with the value;
 *   - suppression and outreach rules are untouched: they are applied by the live API when an email is sent.
 * After --apply the search projection of every affected creator is rebuilt, so has-contact filters and email-first
 * ranking see the new contacts. Dry run by default (everything runs in the transaction, is counted, then rolled back).
 *
 *   node --env-file=.env --import tsx scripts/catalog/sync-contacts.ts --db mushin_catalog_v4 --expect-ref yknp [--apply]
 * --reindex (with --apply): rebuild the projection of every live creator with a contact, without copying anything.
 */
import { parseArgs } from "node:util";
import { createLogger, decryptSecret, encryptedKeyId, encryptSecret, keyId, readCaFile, sha256Hex } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import postgres from "postgres";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, "expect-ref": { type: "string" }, apply: { type: "boolean", default: false }, reindex: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const target = process.env["DIRECT_URL"] ?? "";
const u = new URL(target);
const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected live project (--expect-ref)");
const keyOf = (name: string) => {
  const v = process.env[name];
  if (!v) return null;
  const k = Buffer.from(v, "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
};
const localKey = keyOf("LOCAL_DATA_ENCRYPTION_KEY") ?? keyOf("DATA_ENCRYPTION_KEY");
const liveKey = keyOf("LIVE_DATA_ENCRYPTION_KEY") ?? keyOf("DATA_ENCRYPTION_KEY");
if (!localKey || !liveKey) throw new Error("DATA_ENCRYPTION_KEY (or LOCAL_/LIVE_DATA_ENCRYPTION_KEY) is not set");

const caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
const isLocal = u.hostname === "127.0.0.1" || u.hostname === "localhost";
const src = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });
// Contacts are personal data: the live connection must verify the server's certificate (no unverified fallback).
if (!isLocal && !caPem) throw new Error("DATABASE_SSL_CA_FILE is required to copy contacts to the live database");
const dst = postgres(target, { max: 1, onnotice: () => {}, ssl: isLocal ? false : { ca: caPem as string, rejectUnauthorized: true } });

type Contact = {
  id: string; creator_id: string; kind: string; value_encrypted: string; value_hash: string; masked: string; trust: string; source: string;
  first_seen_at: string; last_seen_at: string; last_verified_at: string | null; status: string; checked_at: string | null; check_detail: string | null;
};
class DryRun extends Error {}
const report: Record<string, unknown> = { target: `${ref.slice(0, 4)}…`, localKeyId: keyId(localKey), liveKeyId: keyId(liveKey), applied: values.apply };
let affected: string[] = [];
try {
  if (values.reindex) {
    affected = (await dst<{ id: string }[]>`select distinct creator_id id from gcp.creator_contacts`).map((r) => r.id);
    report["reindexOnly"] = true;
    if (!values.apply) throw new DryRun("dry run");
  } else await dst.begin(async (tx) => {
    const live = new Set((await tx<{ id: string }[]>`select id from gcp.creators where status = 'active'`).map((r) => r.id));
    const rows = await src<Contact[]>`select id, creator_id, kind, value_encrypted, value_hash, masked, trust, source, first_seen_at, last_seen_at,
      last_verified_at, status, checked_at, check_detail from gcp.creator_contacts`;
    const keyIds: Record<string, number> = {};
    let notOnLive = 0, hashMismatch = 0;
    const out: Contact[] = [];
    for (const r of rows) {
      if (!live.has(r.creator_id)) { notOnLive += 1; continue; }
      const kid = encryptedKeyId(r.value_encrypted) ?? "v1";
      keyIds[kid] = (keyIds[kid] ?? 0) + 1;
      const value = decryptSecret(r.value_encrypted, localKey);
      // The stored hash is how suppressions and duplicates are matched: a value that no longer matches it is not copied.
      if (sha256Hex(value.trim().toLowerCase()) !== r.value_hash) { hashMismatch += 1; continue; }
      out.push({ ...r, value_encrypted: encryptSecret(value, liveKey) });
    }
    let inserted: string[] = [];
    for (let i = 0; i < out.length; i += 500) {
      const res = await tx<{ creator_id: string }[]>`insert into gcp.creator_contacts ${tx(out.slice(i, i + 500))}
        on conflict (creator_id, kind, value_hash) do nothing returning creator_id`;
      inserted = inserted.concat(res.map((x) => x.creator_id));
    }
    affected = [...new Set(inserted)];
    const [after] = await tx<{ creators: number; email: number; phone: number }[]>`select count(distinct creator_id)::int creators,
      count(distinct creator_id) filter (where kind = 'email' and status <> 'invalid')::int email,
      count(distinct creator_id) filter (where kind = 'phone' and status <> 'invalid')::int phone
      from gcp.creator_contacts k where exists (select 1 from gcp.creators c where c.id = k.creator_id and c.status = 'active')`;
    Object.assign(report, {
      localContacts: rows.length, sealedWith: keyIds, creatorNotOnLive: notOnLive, hashMismatch, eligible: out.length,
      inserted: inserted.length, alreadyOnLive: out.length - inserted.length, creatorsGainingContacts: affected.length,
      liveAfter: { creatorsWithAnyContact: after?.creators, withEmail: after?.email, withPhone: after?.phone },
    });
    if (!values.apply) throw new DryRun("dry run: rolled back");
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
}
await src.end();
await dst.end();

if (values.apply && affected.length) {
  // has_contact and the email-first order are read from the projection: rebuild the affected creators' documents.
  const db = createDatabase(target, { max: 2, applicationName: "catalog-sync-contacts", caPem });
  const indexer = createCreatorIndexer({ db, index: null, logger: createLogger({ level: "warn", name: "catalog-sync-contacts" }), sourcePolicy: { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" } });
  for (let i = 0; i < affected.length; i += 200) await indexer.sync(affected.slice(i, i + 200));
  await db.close();
  report["projection"] = `rebuilt for ${affected.length} creators`;
}
console.log(JSON.stringify(report, null, 2));
