/**
 * Loads the validated operational catalogue into staging (owner decisions 2026-10-20: catalogue built locally, then
 * staging; staging is the yknp… project, never production). One transaction, idempotent (existing rows are kept, never
 * overwritten), and only public catalogue data:
 *   loaded:   active, non-minor, unmerged creators; their profiles, links, attribute evidence, metric and assessment
 *             snapshots; then the search projection is rebuilt from them;
 *   excluded: contacts (encrypted with the local key), raw payloads and avatar copies (local files; avatar and payload
 *             references are cleared), every workspace, job, ledger and the catalog_build schema.
 *   Then run scripts/catalog/sync-avatars.ts: it uploads the profile photos and links them (photos are always kept).
 * Dry run by default (counts only); --apply writes. DIRECT_URL must point at the staging project (checked by ref).
 *
 *   node --env-file=.env --import tsx scripts/catalog/load-staging.ts --db mushin_catalog_v2 --expect-ref yknp [--apply]
 */
import { parseArgs } from "node:util";
import { createLogger, loadWorkerConfig, readCaFile } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import postgres from "postgres";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const { values } = parseArgs({ options: { db: { type: "string" }, "expect-ref": { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const target = process.env["DIRECT_URL"] ?? "";
const u = new URL(target);
const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected staging project (--expect-ref)");
const caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
const src = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });
// A local rehearsal database (127.0.0.1) has no TLS; the hosted target always uses it.
const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
const dst = postgres(target, { max: 1, onnotice: () => {}, ssl: local ? false : caPem ? { ca: caPem, rejectUnauthorized: true } : { rejectUnauthorized: false } });

const KEEP = `c.status = 'active' and not c.is_minor and c.merged_into_id is null`;
// [target table, source query returning one jsonb row per record]
const steps: [string, string][] = [
  ["gcp.creators", `select to_jsonb(c) || '{"avatar_url": null, "avatar_key": null, "minor_override_by_staff_id": null}'::jsonb r from gcp.creators c where ${KEEP}`],
  ["gcp.creator_profiles", `select to_jsonb(p) r from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where ${KEEP}`],
  ["gcp.creator_links", `select to_jsonb(l) r from gcp.creator_links l join gcp.creators c on c.id = l.creator_id where ${KEEP}`],
  ["gcp.creator_attribute_evidence", `select to_jsonb(e) || '{"payload_id": null}'::jsonb r from gcp.creator_attribute_evidence e join gcp.creators c on c.id = e.creator_id where ${KEEP}`],
  ["gcp.enrichment_snapshots", `select to_jsonb(s) r from gcp.enrichment_snapshots s join gcp.creators c on c.id = s.creator_id where ${KEEP}`],
  ["gcp.profile_metric_snapshots", `select to_jsonb(m) || '{"raw_payload_id": null}'::jsonb r from gcp.profile_metric_snapshots m join gcp.creator_profiles p on p.id = m.profile_id join gcp.creators c on c.id = p.creator_id where ${KEEP}`],
];

const counts: Record<string, { source: number; inserted: number }> = {};
const CHUNK = 500;
await dst.begin(async (tx) => {
  for (const [table, query] of steps) {
    const rows = (await src.unsafe(query)).map((x) => x["r"] as Record<string, unknown>);
    let inserted = 0;
    if (values.apply) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await tx.unsafe(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, ($1::text)::jsonb) on conflict do nothing`, [JSON.stringify(rows.slice(i, i + CHUNK))]);
        inserted += res.count;
      }
    }
    counts[table] = { source: rows.length, inserted };
  }
  // Rows already in staging are kept, but what changed since the last load is applied (2026-10-21: a reassessment
  // flagged 3 already-loaded creators as possible minors). The minor flag only escalates (never cleared here); a
  // creator that is no longer active locally is hidden in staging too; assessment and evidence-based fields follow.
  const changed = (await src.unsafe(`select jsonb_build_object('id', c.id, 'is_minor', c.is_minor, 'minor_reason', c.minor_reason,
      'minor_flagged_at', c.minor_flagged_at, 'status', c.status, 'authenticity_score', c.authenticity_score, 'assessment_status', c.assessment_status,
      'niches', c.niches, 'city', c.city, 'country', c.country, 'last_enriched_at', c.last_enriched_at) r from gcp.creators c`)).map((x) => x["r"]);
  let synced = 0;
  if (values.apply) {
    for (let i = 0; i < changed.length; i += CHUNK) {
      const res = await tx.unsafe(
        `update gcp.creators d set
           is_minor = d.is_minor or s.is_minor,
           minor_reason = coalesce(d.minor_reason, s.minor_reason),
           minor_flagged_at = coalesce(d.minor_flagged_at, s.minor_flagged_at),
           status = case when s.status <> 'active' and d.status = 'active' then s.status else d.status end,
           authenticity_score = s.authenticity_score, assessment_status = s.assessment_status,
           niches = s.niches, city = s.city, country = s.country, last_enriched_at = s.last_enriched_at
         from jsonb_to_recordset(($1::text)::jsonb) as s(id uuid, is_minor boolean, minor_reason text, minor_flagged_at timestamptz, status text,
           authenticity_score integer, assessment_status text, niches text[], city text, country text, last_enriched_at timestamptz)
         where d.id = s.id and (d.is_minor is distinct from (d.is_minor or s.is_minor) or (s.status <> 'active' and d.status = 'active')
           or d.authenticity_score is distinct from s.authenticity_score or d.assessment_status is distinct from s.assessment_status
           or d.niches is distinct from s.niches or d.city is distinct from s.city or d.country is distinct from s.country)`,
        [JSON.stringify(changed.slice(i, i + CHUNK))],
      );
      synced += res.count;
    }
  }
  counts["gcp.creators (changed rows synced)"] = { source: changed.length, inserted: synced };
});
await src.end();
await dst.end();

let projection: string = "not run (dry run)";
if (values.apply) {
  // The search projection is derived from the creator rows, as the worker's indexer does from the outbox.
  const db = createDatabase(target, { max: 2, applicationName: "catalog-staging-load", caPem });
  await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "warn", name: "catalog-staging-load" }), sourcePolicy: loadWorkerConfig(process.env).sourcePolicy }).reconcile();
  await db.close();
  projection = "rebuilt";
}
console.log(JSON.stringify({ target: `${ref.slice(0, 4)}…`, tlsVerified: Boolean(caPem), applied: values.apply, counts, projection }));
