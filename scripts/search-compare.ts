/**
 * Catalog search backend comparison: PostgreSQL projection vs Meilisearch, on the same data, through the real search
 * service (index query + RLS hydration + ranking), so both answer exactly what a user would see.
 *
 *   TEST_DATABASE_URL=<local disposable db> MEILISEARCH_TEST_HOST=... MEILISEARCH_TEST_KEY=... \
 *     node --import tsx scripts/search-compare.ts 1000 10000
 *
 * DESTRUCTIVE for the test database only: it empties application tables (the same guard as the integration tests:
 * localhost and a database name containing "test"/"disposable"). The corpus is generated; probe creators carry known
 * answers. This measures mechanics, filters and latency; it is not the human-labelled relevance panel (QA-001).
 */
import { randomUUID } from "node:crypto";
import { searchRequestSchema, type SearchRequest } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, testSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../apps/api/src/modules/billing/index";
import { createCreatorIndexer, createCreatorsService, createPostgresCatalogSearch, insertCreator } from "../apps/api/src/modules/creators/index";

const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (sizes.length === 0) sizes.push(1000);
const REPEATS = 15;

const db = createTestDatabase();
const index = testSearchIndex();
const logger = createLogger({ level: "silent" });
const billing = createBillingService({ db, payments: new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} }), cache: new MemoryAccessCache(), logger });
const llm = new MockLlm(() => ({}));
const key = Buffer.alloc(32, 9);
const indexer = createCreatorIndexer({ db, index, logger });
const backends = {
  postgres: createCreatorsService({ db, index, nativeSearch: createPostgresCatalogSearch(db), llm, billing, encryptionKey: key, logger }),
  meilisearch: createCreatorsService({ db, index, llm, billing, encryptionKey: key, logger }),
};
type Backend = keyof typeof backends;

const req = (text: string, filters: Record<string, unknown> = {}, page = 1): SearchRequest => searchRequestSchema.parse({ text, filters, page });
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] ?? 0;

/** Bulk corpus in SQL (fast at 50k), shaped like the real catalog: Pakistani names, cities, niches, bios. */
async function corpus(n: number) {
  await ownerQuery(`
    insert into gcp.creators (display_name, primary_handle, primary_platform, city, country, niches, verified)
      select (array['Hira','Sana','Bilal','Usman','Zainab','Fatima','Ahmed','Hamza','Mahnoor','Ali'])[1 + g % 10] || ' ' ||
             (array['Malik','Butt','Sheikh','Chaudhry','Raza','Iqbal','Akhtar','Javed'])[1 + (g / 10) % 8],
        'corpus_' || g, (array['instagram','tiktok','youtube'])[1 + g % 3],
        (array['Lahore','Karachi','Islamabad','Faisalabad','Multan'])[1 + g % 5], 'PK',
        array[(array['Food','Fashion','Tech','Beauty','Travel','Fitness'])[1 + g % 6]], g % 17 = 0
      from generate_series(1, ${n}) g;
    insert into gcp.creator_profiles (creator_id, platform, handle, canonical_url, followers, engagement_rate, followers_updated_at, bio)
      select c.id, c.primary_platform, c.primary_handle, 'https://compare.test/' || c.primary_handle,
        1000 + (abs(hashtext(c.primary_handle)) % 900000), (abs(hashtext(c.primary_handle || 'e')) % 1000) / 100.0,
        now() - ((abs(hashtext(c.primary_handle || 'd')) % 40) || ' days')::interval,
        c.niches[1] || ' creator from ' || c.city || '. Daily ' || lower(c.niches[1]) || ' content and reviews.'
      from gcp.creators c where c.primary_handle like 'corpus_%';`);
}

type Probe = { handle?: string; city?: string; niches?: string[]; nameVariants?: string[]; bio?: string };
function probe(displayName: string, o: Probe = {}): Promise<string> {
  const handle = o.handle ?? `probe_${randomUUID().slice(0, 8)}`;
  return db.withSystem((tx) =>
    insertCreator(
      tx,
      {
        displayName,
        primaryHandle: handle,
        primaryPlatform: "instagram",
        city: o.city ?? "Lahore",
        country: "PK",
        niches: o.niches ?? ["Fashion"],
        tags: [],
        ...(o.nameVariants ? { nameVariants: o.nameVariants } : {}),
        profiles: [{ platform: "instagram", handle, followers: 40_000, engagementRate: 4, bio: o.bio ?? "Creator" }],
      },
      key,
    ),
  );
}

async function syncAll() {
  const ids = (await ownerQuery<{ id: string }>(`select id from gcp.creators`)).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 1000) await indexer.sync(ids.slice(i, i + 1000));
}

type Row = { check: string; postgres: string; meilisearch: string };

async function run(n: number) {
  await resetTables();
  await index.remove([...(await index.listIds()).keys()]);
  await corpus(n);
  const ayesha = await probe("Ayesha Siddiqui", { nameVariants: ["Aisha Siddiqui", "عائشہ صدیقی"], bio: "Modest fashion and bridal styling" });
  const biryani = await probe("Karachi Biryani Diaries", { handle: "karachibiryanidiaries", city: "Karachi", niches: ["Food"], bio: "Biryani and street food reviews across Karachi" });
  const modest = await probe("Noor Ul Ain", { bio: "Modest fashion lookbooks for everyday wear" });
  const minor = await probe("Hidden Teen Creator");
  const renamed = await probe("Old Name Vlogs");
  const removed = await probe("Removed Creator Example");
  const started = performance.now();
  await syncAll();
  const indexMs = performance.now() - started;
  const c: TenantContext = { ...(await createTestWorkspace()), requestId: "compare", role: "owner" };
  const rows: Row[] = [];
  const both = async (check: string, f: (b: Backend) => Promise<string>) => rows.push({ check, postgres: await f("postgres"), meilisearch: await f("meilisearch") });
  const ids = async (b: Backend, r: SearchRequest) => (await backends[b].search(c, r)).results.map((x) => x.id);
  const rankOf = async (b: Backend, text: string, id: string) => {
    const at = (await ids(b, req(text))).indexOf(id);
    return at < 0 ? "not found" : at < 5 ? `found (#${at + 1})` : `low (#${at + 1})`;
  };

  // Relevance probes (known answers)
  await both("exact name: Ayesha Siddiqui", (b) => rankOf(b, "Ayesha Siddiqui", ayesha));
  await both("stored name variant: Aisha Siddiqui", (b) => rankOf(b, "Aisha Siddiqui", ayesha));
  await both("typo: Ayesah Siddiqui", (b) => rankOf(b, "Ayesah Siddiqui", ayesha));
  await both("partial term: Siddiq", (b) => rankOf(b, "Siddiq", ayesha));
  await both("Urdu script variant: عائشہ", (b) => rankOf(b, "عائشہ", ayesha));
  await both("exact handle: karachibiryanidiaries", (b) => rankOf(b, "karachibiryanidiaries", biryani));
  await both("bio keywords: karachi biryani", (b) => rankOf(b, "karachi biryani", biryani));
  await both("bio phrase: modest fashion (2 probes)", async (b) => {
    const got = await ids(b, req("modest fashion"));
    return `${[ayesha, modest].filter((id) => got.slice(0, 5).includes(id)).length}/2 in top 5`;
  });

  // Filters: every returned card must satisfy them, and both backends must agree on the set.
  const filterCases: [string, Record<string, unknown>][] = [
    ["tiktok + Karachi", { platform: "tiktok", creatorCity: "Karachi" }],
    ["Food + 10k–100k followers + ER ≥ 4", { niches: ["Food"], followersMin: 10_000, followersMax: 100_000, engagementMin: 4 }],
    ["verified only + youtube", { verifiedOnly: true, platform: "youtube" }],
  ];
  const sets: Record<string, Record<Backend, string[]>> = {};
  for (const [name, filters] of filterCases) {
    await both(`filter: ${name}`, async (b) => {
      const out = await backends[b].search(c, req("", filters));
      const bad = out.results.filter((r) =>
        (filters["platform"] && r.platform !== filters["platform"]) || (filters["creatorCity"] && r.city !== filters["creatorCity"]) ||
        (filters["followersMin"] && (r.followers ?? 0) < (filters["followersMin"] as number)) || (filters["followersMax"] && (r.followers ?? 0) > (filters["followersMax"] as number)) ||
        (filters["engagementMin"] && (r.engagementRate ?? 0) < (filters["engagementMin"] as number)) || (filters["verifiedOnly"] && !r.verified));
      (sets[name] ??= { postgres: [], meilisearch: [] })[b] = out.results.map((r) => r.id);
      return `${out.total} total, ${bad.length} violating`;
    });
  }
  for (const [name, s] of Object.entries(sets)) {
    const same = s.postgres.length === s.meilisearch.length && s.postgres.every((id, i) => id === s.meilisearch[i]);
    rows.push({ check: `same page-1 order: ${name}`, postgres: same ? "identical" : "differs", meilisearch: same ? "identical" : "differs" });
  }
  await both("browse: total, pages disjoint, repeatable", async (b) => {
    const p1 = await backends[b].search(c, req(""));
    const p1again = await ids(b, req(""));
    const p2 = await ids(b, req("", {}, 2));
    const disjoint = p2.every((id) => !p1.results.some((r) => r.id === id));
    const stable = p1again.join() === p1.results.map((r) => r.id).join();
    return `${p1.total} total; disjoint ${disjoint}; stable ${stable}`;
  });

  // Lifecycle: hide, rename and remove, then re-sync as the worker does on creator.changed.
  await ownerQuery(`update gcp.creators set is_minor = true where id = '${minor}';
    update gcp.creators set display_name = 'Zubair Qureshi Vlogs', updated_at = now() where id = '${renamed}';
    update gcp.creators set status = 'removal_requested', updated_at = now() where id = '${removed}';`);
  await indexer.sync([minor, renamed, removed]);
  await both("hidden possible minor excluded", async (b) => ((await ids(b, req("Hidden Teen Creator"))).includes(minor) ? "LEAKED" : "excluded"));
  await both("rename: new name found / old gone", async (b) => `${(await rankOf(b, "Zubair Qureshi", renamed))} / ${(await ids(b, req("Old Name Vlogs"))).includes(renamed) ? "old still matches" : "old gone"}`);
  await both("removal requested excluded", async (b) => ((await ids(b, req("Removed Creator Example"))).includes(removed) ? "LEAKED" : "excluded"));

  // Latency through the full service path, warm.
  // Statistics as production would have them (autovacuum analyzes a bulk load only later).
  await ownerQuery("analyze gcp.creators; analyze gcp.creator_profiles; analyze gcp.creator_search_documents;");
  const queries: [string, SearchRequest][] = [
    ["text: rare name", req("Ayesha")],
    ["text: common word (17% match)", req("food")],
    ["filter: platform", req("", { platform: "tiktok" })],
    ["filter: niche + followers", req("", { niches: ["Food"], followersMin: 10_000 })],
    ["text + country", req("karachi biryani", { creatorCountry: "PK" })],
    ["text: partial word", req("Siddiq")],
  ];
  const times: Record<Backend, number[]> = { postgres: [], meilisearch: [] };
  const perQuery: Record<string, Record<Backend, number[]>> = {};
  for (const b of ["postgres", "meilisearch"] as Backend[]) await backends[b].search(c, req(""));
  for (let i = 0; i < REPEATS; i++) {
    for (const [name, q] of queries) {
      for (const b of ["postgres", "meilisearch"] as Backend[]) {
        const t = performance.now();
        await backends[b].search(c, q);
        const ms = performance.now() - t;
        times[b].push(ms);
        ((perQuery[name] ??= { postgres: [], meilisearch: [] })[b]).push(ms);
      }
    }
  }
  const lat = (xs: number[]) => `p50 ${pct(xs, 50).toFixed(0)} ms · p95 ${pct(xs, 95).toFixed(0)} ms · max ${Math.max(...xs).toFixed(0)} ms`;
  rows.push({ check: `latency, all ${times.postgres.length} warm searches`, postgres: lat(times.postgres), meilisearch: lat(times.meilisearch) });
  for (const [name, t] of Object.entries(perQuery)) rows.push({ check: `latency, ${name}`, postgres: lat(t.postgres), meilisearch: lat(t.meilisearch) });

  const visible = (await ownerQuery<{ n: string }>(`select count(*) n from gcp.creator_search_documents`))[0]?.n;
  console.log(`\n### Corpus ${n.toLocaleString("en")} generated + 6 probes (${visible} visible after lifecycle checks; initial sync ${(indexMs / 1000).toFixed(1)} s)\n`);
  console.log("| Check | PostgreSQL | Meilisearch |\n|---|---|---|");
  for (const r of rows) console.log(`| ${r.check} | ${r.postgres} | ${r.meilisearch} |`);
}

const invalid = [
  ["page 0", { text: "x", page: 0 }],
  ["negative followersMin", { text: "", filters: { followersMin: -5 } }],
  ["unknown platform", { text: "", filters: { platform: "myspace" } }],
  ["oversized text", { text: "x".repeat(5000) }],
] as const;
console.log("Malformed input (schema, both backends): " + invalid.map(([name, body]) => `${name}: ${searchRequestSchema.safeParse(body).success ? "ACCEPTED" : "rejected"}`).join("; "));
try {
  await index.ensureSettings();
  for (const n of sizes) await run(n);
} finally {
  await index.drop();
  await db.close();
}
