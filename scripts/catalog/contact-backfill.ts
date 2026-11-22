/**
 * Free contact backfill on the local operational catalogue (owner, 22 Nov, step 2), before any page is crawled:
 *   A. Stored Instagram and TikTok scraper results are read again with today's contact rules (enrichment/links.ts):
 *      WhatsApp links the creator set (wa.me, api.whatsapp.com), and emails and Pakistani mobile numbers in the bio, or
 *      in recent captions under the existing rule (in 2+ of the last 5, or right after a business cue). YouTube results
 *      are not read again: YouTube API data is kept 30 days only, and its contacts were extracted when it was fetched.
 *   B. Linked profiles: when a creator's own profile links to another platform profile in the catalogue that belongs to
 *      a separate creator record, and the two are shown to be the same person (the other profile links back, or the
 *      names match), each inherits the other's contacts (source "linked_profile"). One-way links to a different name
 *      (a collaborator, a brand) are never followed.
 * New contacts only: an existing one (same creator, kind and value) is left as it is. Values are encrypted with
 * DATA_ENCRYPTION_KEY and hashed as the pipeline does; only counts are printed. Dry run by default; --apply commits.
 *
 *   node --env-file=.env --import tsx scripts/catalog/contact-backfill.ts --db mushin_catalog_v4 [--apply]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { decryptSecret, encryptSecret, sha256Hex } from "@mushin/core";
import postgres from "postgres";
import { extractContacts, type ContactSource, type ExtractedContact } from "../../apps/api/src/modules/creators/enrichment/links";
import { standardize } from "../../apps/api/src/modules/creators/enrichment/standardize";
import { maskContact } from "../../apps/api/src/modules/creators/rules";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const key = Buffer.from(process.env["DATA_ENCRYPTION_KEY"] ?? "", "base64");
if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be set (32 bytes, base64)");
const storageRoot = path.resolve(import.meta.dirname, "../../.catalog-storage", dbName, "raw-payloads");
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });

type New = { creatorId: string; kind: "email" | "phone"; value: string; trust: ExtractedContact["trust"]; source: ContactSource };
const report: Record<string, unknown> = { applied: values.apply };
const nameKey = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");

class DryRun extends Error {}
try {
  await sql.begin(async (tx) => {
    const existing = new Set((await tx<{ k: string }[]>`select creator_id || ':' || kind || ':' || value_hash k from gcp.creator_contacts`).map((r) => r.k));
    const found: New[] = [];
    const add = (n: New) => {
      const k = `${n.creatorId}:${n.kind}:${sha256Hex(n.value.trim().toLowerCase())}`;
      if (existing.has(k)) return false;
      existing.add(k);
      found.push(n);
      return true;
    };

    // A. Stored Instagram and TikTok results, the newest per profile, attributed through the profile they belong to.
    const payloads = await tx<{ creator_id: string; platform: "instagram" | "tiktok"; handle: string; storage_key: string }[]>`
      select distinct on (p.id) p.creator_id, p.platform, p.handle, r.storage_key
      from platform.raw_payloads r join gcp.creator_profiles p on p.canonical_url = r.canonical_url and p.platform = r.platform
      where r.provider = 'apify' and r.platform in ('instagram', 'tiktok')
      order by p.id, r.fetched_at desc`;
    const fromRaw: Record<string, number> = {};
    let unreadable = 0;
    for (const p of payloads) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path.join(storageRoot, p.storage_key), "utf8"));
      } catch {
        unreadable += 1;
        continue;
      }
      const std = standardize(p.platform, p.handle, raw, { maxPosts: 12 });
      if (std.kind !== "ok") continue;
      for (const c of extractContacts(std.profile)) {
        if (add({ creatorId: p.creator_id, kind: c.kind, value: c.value, trust: c.trust, source: c.source })) fromRaw[`${c.kind}:${c.source}`] = (fromRaw[`${c.kind}:${c.source}`] ?? 0) + 1;
      }
    }
    report["A_storedResults"] = { profilesRead: payloads.length, unreadable, newContacts: fromRaw };

    // B. Linked profiles of the same person kept as separate creator records.
    const pairs = await tx<{ a: string; b: string; a_name: string; b_name: string; a_handle: string; b_handle: string; back: boolean }[]>`
      select distinct l.creator_id a, t.creator_id b, ca.display_name a_name, cb.display_name b_name, pa.handle a_handle, t.handle b_handle,
        exists (select 1 from gcp.creator_links lb join gcp.creator_profiles pa2 on pa2.canonical_url = lb.url and pa2.creator_id = l.creator_id
                where lb.creator_id = t.creator_id) back
      from gcp.creator_links l
      join gcp.creator_profiles t on t.canonical_url = l.url and t.creator_id <> l.creator_id
      join gcp.creators ca on ca.id = l.creator_id join gcp.creators cb on cb.id = t.creator_id
      join lateral (select handle from gcp.creator_profiles x where x.creator_id = l.creator_id order by x.followers desc nulls last limit 1) pa on true
      where l.platform in ('instagram', 'tiktok', 'youtube') and l.source in ('profile_link', 'bio')
        and ca.status = 'active' and cb.status = 'active'`;
    const same = pairs.filter((x) => x.back || nameKey(x.a_name) === nameKey(x.b_name) || nameKey(x.a_handle) === nameKey(x.b_handle));
    const contacts = await tx<{ creator_id: string; kind: "email" | "phone"; value_encrypted: string }[]>`
      select creator_id, kind, value_encrypted from gcp.creator_contacts where status <> 'invalid'`;
    const byCreator = new Map<string, { kind: "email" | "phone"; value: string }[]>();
    for (const c of contacts) byCreator.set(c.creator_id, [...(byCreator.get(c.creator_id) ?? []), { kind: c.kind, value: decryptSecret(c.value_encrypted, key) }]);
    // Contacts found in step A count too.
    for (const n of found) byCreator.set(n.creatorId, [...(byCreator.get(n.creatorId) ?? []), { kind: n.kind, value: n.value }]);
    const linked: Record<string, number> = {};
    const gaining = new Set<string>();
    for (const x of same) {
      for (const [to, from] of [[x.a, x.b], [x.b, x.a]] as const) {
        for (const c of byCreator.get(from) ?? []) {
          if (add({ creatorId: to, kind: c.kind, value: c.value, trust: "unverified", source: "linked_profile" })) {
            linked[c.kind] = (linked[c.kind] ?? 0) + 1;
            gaining.add(to);
          }
        }
      }
    }
    report["B_linkedProfiles"] = { crossCreatorLinks: pairs.length, samePerson: same.length, oneWayDifferentName: pairs.length - same.length, newContacts: linked, creatorsGaining: gaining.size };

    for (let i = 0; i < found.length; i += 500) {
      await tx`insert into gcp.creator_contacts ${tx(found.slice(i, i + 500).map((n) => ({
        creator_id: n.creatorId, kind: n.kind, value_encrypted: encryptSecret(n.value, key), value_hash: sha256Hex(n.value.trim().toLowerCase()),
        masked: maskContact(n.kind, n.value), trust: n.trust, source: n.source,
      })))} on conflict (creator_id, kind, value_hash) do nothing`;
    }
    const [after] = await tx<{ any: number; email: number; phone: number }[]>`select count(distinct creator_id)::int any,
      count(distinct creator_id) filter (where kind = 'email' and status <> 'invalid')::int email,
      count(distinct creator_id) filter (where kind = 'phone' and status <> 'invalid')::int phone from gcp.creator_contacts`;
    report["newContactsTotal"] = found.length;
    report["catalogueAfter"] = after;
    if (!values.apply) throw new DryRun("dry run");
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
}
await sql.end();
console.log(JSON.stringify(report, null, 2));
