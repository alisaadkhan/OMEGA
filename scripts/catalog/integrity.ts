/**
 * Operational catalogue integrity check (search-v2), read-only. Reports, and exits 1 on a hard failure:
 *   hard: duplicate profiles (platform + handle, or canonical URL), evidence rows of missing creators, search documents
 *         that disagree with their creator (city, country, niches), a stored city or country contradicted by its own
 *         conflicting evidence;
 *   soft: possible cross-platform duplicates (one handle on two creator records; not merged without a linking
 *         profile), stored values without supporting evidence (creators from before the evidence layer), conflicting
 *         evidence left unknown, Pakistan relevance and field-level evidence quality.
 *
 *   node --import tsx scripts/catalog/integrity.ts --db mushin_catalog_v2 [--out file.json]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";

const { values } = parseArgs({ options: { db: { type: "string" }, out: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });
const one = async <T extends Record<string, unknown>>(q: string) => (await sql.unsafe(q))[0] as unknown as T;
const all = async (q: string) => [...(await sql.unsafe(q))];

const hard = {
  duplicateHandles: await all(`select platform, lower(handle) handle, count(*)::int n from gcp.creator_profiles group by 1, 2 having count(*) > 1`),
  duplicateUrls: await all(`select canonical_url, count(*)::int n from gcp.creator_profiles group by 1 having count(*) > 1`),
  orphanEvidence: (await one<{ n: number }>(`select count(*)::int n from gcp.creator_attribute_evidence e left join gcp.creators c on c.id = e.creator_id where c.id is null`)).n,
  projectionMismatch: (await one<{ n: number }>(`select count(*)::int n from gcp.creators c join gcp.creator_search_documents d on d.creator_id = c.id
    where d.city is distinct from c.city or d.country is distinct from c.country or d.niches is distinct from c.niches`)).n,
  storedAgainstConflict: await all(`select c.id, c.city, c.country from gcp.creators c where c.status = 'active' and (
    (c.city is not null and exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'city' and e.status = 'conflicting' and e.value = c.city)
      and not exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'city' and e.status = 'supported'))
    or (c.country = 'PK' and exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'country' and e.value = 'PK' and e.status = 'conflicting')
      and not exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'country' and e.status = 'supported')))`),
};
const withEvidence = `exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id)`;
const soft = {
  possibleCrossPlatformDuplicates: await all(`select lower(handle) handle, array_agg(platform::text order by platform) platforms, count(distinct creator_id)::int creators
    from gcp.creator_profiles group by 1 having count(distinct creator_id) > 1`),
  creators: await one(`select count(*)::int active, count(*) filter (where ${withEvidence})::int with_evidence,
    count(*) filter (where not ${withEvidence})::int legacy_without_evidence from gcp.creators c where c.status = 'active'`),
  storedWithoutSupport: await one(`select
    count(*) filter (where c.city is not null and not exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'city' and e.status = 'supported'))::int city,
    count(*) filter (where c.country is not null and not exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'country' and e.status = 'supported'))::int country
    from gcp.creators c where c.status = 'active' and ${withEvidence}`),
  legacyStored: await one(`select count(*) filter (where c.city is not null)::int city, count(*) filter (where c.country is not null)::int country
    from gcp.creators c where c.status = 'active' and not ${withEvidence}`),
  pakistan: await one(`select count(*) filter (where c.country = 'PK')::int stored_pk,
    count(*) filter (where exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'country' and e.value = 'PK' and e.status = 'supported'))::int pk_supported,
    count(*) filter (where exists (select 1 from gcp.creator_attribute_evidence e where e.creator_id = c.id and e.attribute = 'city' and e.status = 'supported'))::int city_supported,
    count(*) filter (where d.eligible)::int eligible_in_search
    from gcp.creators c left join gcp.creator_search_documents d on d.creator_id = c.id where c.status = 'active'`),
  evidenceQuality: await all(`select attribute, source, status, count(*)::int n from gcp.creator_attribute_evidence group by 1, 2, 3 order by 1, 2, 3`),
  eligibleByPlatform: await all(`select p.platform, count(distinct p.creator_id)::int creators, count(distinct p.creator_id) filter (where d.eligible)::int eligible
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id and c.status = 'active' left join gcp.creator_search_documents d on d.creator_id = p.creator_id group by 1 order by 1`),
};
await sql.end();
const failures = Object.entries(hard).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v > 0)).map(([k]) => k);
const report = { db: dbName, at: new Date().toISOString(), ok: failures.length === 0, failures, hard, soft };
if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ ok: report.ok, failures, creators: soft.creators, pakistan: soft.pakistan, storedWithoutSupport: soft.storedWithoutSupport, possibleCrossPlatformDuplicates: soft.possibleCrossPlatformDuplicates.length }));
if (!report.ok) process.exitCode = 1;
