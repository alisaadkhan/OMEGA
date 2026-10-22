/**
 * Copies the operational catalogue's profile photos to staging (the step load-staging.ts leaves out: locally the photos
 * are files, so the loader clears their references). Every scrape keeps a copy because platform photo links expire;
 * a catalogue moved to staging must carry them too (owner, 2026-10-22).
 *   uploads:  each local copy to the public `creator-avatars` bucket of the staging project, under the same key;
 *   links:    the staging creator to it, only where staging has no photo yet (a newer photo from a real scrape wins);
 *   skips:    YouTube-primary creators whose YouTube profile was not refreshed within 30 days on staging (YouTube API
 *             retention, migration 0031: their photo may not be kept), and creators staging does not have.
 * Dry run by default (counts only); --apply writes. DIRECT_URL and SUPABASE_URL must be the staging project (checked by ref).
 *
 *   node --env-file=.env --import tsx scripts/catalog/sync-avatars.ts --db mushin_catalog_v2 --expect-ref yknp [--apply]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readCaFile } from "@mushin/core";
import { AVATAR_BUCKET, SupabaseStorage } from "@mushin/integrations";
import postgres from "postgres";

const { values } = parseArgs({ options: { db: { type: "string" }, "expect-ref": { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const expect = values["expect-ref"] ?? "";
const target = new URL(process.env["DIRECT_URL"] ?? "");
const dbRef = target.username.split(".")[1] ?? target.hostname.split(".")[0] ?? "";
const storageUrl = process.env["SUPABASE_URL"] ?? "";
const storageRef = storageUrl ? new URL(storageUrl).hostname.split(".")[0] ?? "" : "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
if (!expect || !dbRef.startsWith(expect) || !storageRef.startsWith(expect)) throw new Error("DIRECT_URL and SUPABASE_URL must both be the expected staging project (--expect-ref)");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

const root = join(process.cwd(), ".catalog-storage", dbName, AVATAR_BUCKET);
const caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
const src = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });
const dst = postgres(target.toString(), { max: 1, onnotice: () => {}, ssl: caPem ? { ca: caPem, rejectUnauthorized: true } : { rejectUnauthorized: false } });
const storage = new SupabaseStorage({ url: storageUrl, serviceKey });
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

try {
  const local = await src<{ id: string; key: string }[]>`
    select id::text, avatar_key key from gcp.creators
    where avatar_key is not null and status = 'active' and not is_minor and merged_into_id is null`;
  const ids = local.map((r) => r.id);
  // Staging decides eligibility: present, no photo yet, and (YouTube-primary) refreshed within the retention window.
  const eligible = new Set(
    (
      await dst<{ id: string }[]>`
        select c.id::text from gcp.creators c
        where c.id = any(${ids}::uuid[]) and c.avatar_url is null and c.status = 'active'
          and (c.primary_platform <> 'youtube' or exists (
            select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.platform = 'youtube'
              and coalesce(p.last_scraped_at, p.created_at) >= now() - interval '30 days'))`
    ).map((r) => r.id),
  );
  const todo = local.filter((r) => eligible.has(r.id));
  console.log(`local photos ${local.length}; to copy ${todo.length}; skipped ${local.length - todo.length} (not on staging, already has a photo, or past YouTube retention)`);
  if (!values.apply) {
    console.log("Dry run: nothing changed. Add --apply to copy and link them.");
  } else {
    await storage.ensureBucket(AVATAR_BUCKET, { public: true });
    const done: { id: string; key: string; url: string }[] = [];
    const failed: string[] = [];
    let next = 0;
    // A few uploads at a time: the bucket is flat-fee infrastructure, but the network is the slow part.
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < todo.length) {
          const row = todo[next++];
          if (!row) break;
          try {
            const ext = row.key.split(".").pop()?.toLowerCase() ?? "";
            const type = TYPES[ext];
            if (!type || row.key.includes("..")) throw new Error(`unexpected key ${row.key}`);
            await storage.put(AVATAR_BUCKET, row.key, await readFile(join(root, ...row.key.split("/"))), type);
            done.push({ ...row, url: storage.publicUrl(AVATAR_BUCKET, row.key) });
          } catch (err) {
            failed.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160));
          }
        }
      }),
    );
    // Link in one transaction; the "still no photo" condition keeps a photo a real scrape added meanwhile.
    const linked = await dst.begin(async (tx) => {
      let n = 0;
      for (let i = 0; i < done.length; i += 500) {
        const part = done.slice(i, i + 500);
        const r = await tx`
          update gcp.creators c set avatar_url = v.url, avatar_key = v.key, updated_at = now()
          from (select unnest(${part.map((d) => d.id)}::uuid[]) id, unnest(${part.map((d) => d.url)}::text[]) url, unnest(${part.map((d) => d.key)}::text[]) key) v
          where c.id = v.id and c.avatar_url is null`;
        n += r.count;
      }
      return n;
    });
    console.log(`uploaded ${done.length}; linked ${linked}; failed ${failed.length}`);
    for (const f of failed.slice(0, 10)) console.log(`  failed ${f}`);
  }
} finally {
  await src.end();
  await dst.end();
}
