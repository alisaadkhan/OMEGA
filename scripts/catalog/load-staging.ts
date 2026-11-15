/**
 * Loads the validated operational catalogue into staging (owner decisions 2026-10-20: catalogue built locally, then
 * staging; staging is the yknp… project, never production). One transaction, idempotent, and only public catalogue data:
 *   loaded:   active, non-minor, unmerged, assessed creators; their profiles, links, attribute evidence, metric and assessment
 *             snapshots; then the search projection is rebuilt from them;
 *   excluded: contacts (encrypted with the local key), raw payloads and avatar copies (local files; avatar and payload
 *             references are cleared), every workspace, job, ledger and the catalog_build schema.
 *   updated:  creators and profiles staging already has, under the rules in live-sync.ts (fresher data wins, staff
 *             decisions kept, no YouTube API data older than 30 days, identity merges replayed);
 *   Then run scripts/catalog/sync-avatars.ts: it uploads the profile photos and links them (photos are always kept).
 * Dry run by default: everything runs in the transaction, is counted, then rolled back; --apply commits, removes the
 * photos of cleared YouTube profiles and rebuilds the search projection. DIRECT_URL must point at the staging project.
 *
 *   node --env-file=.env --import tsx scripts/catalog/load-staging.ts --db mushin_catalog_v2 --expect-ref yknp [--apply]
 */
import { parseArgs } from "node:util";
import { createLogger, loadWorkerConfig, readCaFile } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { AVATAR_BUCKET, SupabaseStorage } from "@mushin/integrations";
import postgres from "postgres";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";
import { syncExisting, YT_CUTOFF } from "./live-sync";

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

// A YouTube-primary creator whose channel was read more than 30 days ago is not copied (YouTube API retention), nor are
// expired YouTube profile readings, snapshots, or links read from video descriptions.
const YT_PROFILE_EXPIRED = (p: string) => `(${p}.platform = 'youtube' and coalesce(${p}.last_scraped_at, ${p}.created_at) < ${YT_CUTOFF})`;
const YT_PRIMARY_EXPIRED = `(c.primary_platform = 'youtube' and exists (select 1 from gcp.creator_profiles y where y.creator_id = c.id and ${YT_PROFILE_EXPIRED("y")}))`;
// A creator whose AI assessment is still pending has had no minor check: staging (no worker to finish it) never gets it
// as a new creator until the assessment is complete (2026-11-15: 750 new channels were saved pending under rate limits).
// Likewise a new 100K+ account whose type the rules could not decide waits for the AI account check (owner directive
// 2026-11-15 §2.2: every 100K+ account is checked, celebrities hide there).
const UNREVIEWED_LARGE = `(coalesce(c.account_type, 'UNKNOWN') = 'UNKNOWN' and coalesce((select max(p.followers) from gcp.creator_profiles p where p.creator_id = c.id), 0) >= 100000)`;
const KEEP = `c.status = 'active' and not c.is_minor and c.merged_into_id is null and c.assessment_status is distinct from 'pending' and not ${UNREVIEWED_LARGE} and not ${YT_PRIMARY_EXPIRED}`;
const YT_CLEARED = JSON.stringify(Object.fromEntries(["followers", "following", "posts", "engagement_rate", "avg_likes", "avg_comments", "avg_views", "bio",
  "followers_updated_at", "engagement_updated_at", "median_views", "median_engagement_rate", "performance_views_sample", "performance_engagement_sample",
  "performance_format", "performance_from", "performance_to", "performance_at", "post_locations", "avatar_url", "avatar_key", "caption_country_evidence",
  "country", "country_source", "country_confidence", "country_checked_at"].map((k) => [k, null])));
// [target table, source query returning one jsonb row per record]
const steps: [string, string][] = [
  ["gcp.creators", `select to_jsonb(c) || '{"avatar_url": null, "avatar_key": null, "minor_override_by_staff_id": null}'::jsonb r from gcp.creators c where ${KEEP}`],
  ["gcp.creator_profiles", `select to_jsonb(p) || case when ${YT_PROFILE_EXPIRED("p")} then '${YT_CLEARED}'::jsonb || '{"country_status": "unknown"}'::jsonb else '{}'::jsonb end r
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where ${KEEP}`],
  ["gcp.creator_links", `select to_jsonb(l) r from gcp.creator_links l join gcp.creators c on c.id = l.creator_id where ${KEEP}
    and not (l.source = 'video_description' and exists (select 1 from gcp.creator_profiles y where y.creator_id = c.id and ${YT_PROFILE_EXPIRED("y")}))`],
  ["gcp.creator_attribute_evidence", `select to_jsonb(e) || '{"payload_id": null}'::jsonb r from gcp.creator_attribute_evidence e join gcp.creators c on c.id = e.creator_id where ${KEEP}`],
  ["gcp.enrichment_snapshots", `select to_jsonb(s) r from gcp.enrichment_snapshots s join gcp.creators c on c.id = s.creator_id where ${KEEP}`],
  ["gcp.profile_metric_snapshots", `select to_jsonb(m) || '{"raw_payload_id": null}'::jsonb r from gcp.profile_metric_snapshots m join gcp.creator_profiles p on p.id = m.profile_id join gcp.creators c on c.id = p.creator_id
    where ${KEEP} and not (p.platform = 'youtube' and m.captured_at < ${YT_CUTOFF})`],
];

const counts: Record<string, { source: number; inserted: number }> = {};
let report: Record<string, unknown> = {};
let expiredAvatarKeys: string[] = [];
const CHUNK = 500;
class DryRun extends Error {}
try {
  await dst.begin(async (tx) => {
    for (const [table, query] of steps) {
      const rows = (await src.unsafe(query)).map((x) => x["r"] as Record<string, unknown>);
      // Generated columns (0081 pakistani_diaspora) are computed by the target, never inserted.
      const [schema, name] = table.split(".");
      const cols = (await tx.unsafe(`select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns
        where table_schema = $1 and table_name = $2 and is_generated = 'NEVER'`, [schema ?? "", name ?? ""]))[0]?.["c"] as string;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await tx.unsafe(`insert into ${table} (${cols}) select ${cols} from jsonb_populate_recordset(null::${table}, ($1::text)::jsonb) on conflict do nothing`, [JSON.stringify(rows.slice(i, i + CHUNK))]);
        inserted += res.count;
      }
      counts[table] = { source: rows.length, inserted };
    }
    // Every local creator and profile, for the update rules (contacts and photo references are not read).
    const creators = (await src.unsafe(`select to_jsonb(c) - 'avatar_url' - 'avatar_key' r from gcp.creators c`)).map((x) => x["r"]);
    const profiles = (await src.unsafe(`select to_jsonb(p) - 'avatar_url' - 'avatar_key' r from gcp.creator_profiles p`)).map((x) => x["r"]);
    ({ report, expiredAvatarKeys } = await syncExisting(tx, { creators, profiles }));
    if (!values.apply) throw new DryRun("dry run: rolled back");
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
}
await src.end();
await dst.end();

let photosRemoved = 0;
if (values.apply && expiredAvatarKeys.length && !local) {
  // The cleared YouTube profiles' photo copies are YouTube API data too (0084): removed from storage as the worker does.
  const storageUrl = process.env["SUPABASE_URL"] ?? "";
  if (!new URL(storageUrl).hostname.startsWith(values["expect-ref"] ?? "")) throw new Error("SUPABASE_URL is not the expected staging project");
  await new SupabaseStorage({ url: storageUrl, serviceKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "" }).remove(AVATAR_BUCKET, expiredAvatarKeys);
  photosRemoved = expiredAvatarKeys.length;
}

let projection: string = "not run (dry run)";
if (values.apply) {
  // The search projection is derived from the creator rows, as the worker's indexer does from the outbox.
  const db = createDatabase(target, { max: 2, applicationName: "catalog-staging-load", caPem });
  await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "warn", name: "catalog-staging-load" }), sourcePolicy: loadWorkerConfig(process.env).sourcePolicy }).reconcile();
  await db.close();
  projection = "rebuilt";
}
console.log(JSON.stringify({ target: `${ref.slice(0, 4)}…`, tlsVerified: Boolean(caPem), applied: values.apply, inserts: counts, updates: report, photosRemoved, projection }, null, 2));
