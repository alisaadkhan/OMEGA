/**
 * AI account-type and niche review of large accounts (owner directive 2026-11-15, §2.2–2.3, Decision 2): active
 * creators with 100K+ followers whose rules left the account type UNKNOWN or the niche empty. Run after the
 * deterministic reassessment and evidence backfill, so their readings are final first. Dry run by default.
 *
 *   GEMINI_BILLING=free_accepted node --env-file=.env --import tsx scripts/catalog/ai-review.ts --db mushin_catalog_v4 \
 *     [--handles a,b] [--min-followers 100000] [--cap 15] [--apply] [--out <file outside the repository>]
 *
 * Writes only: account type (source "ai", never over a staff decision or a rule's type) and, when the niche is empty,
 * an estimated niche (source "post_estimated", posts_assessed 0: always shown as "AI estimate", whatever basis the model
 * claims — in the pilot it called a public-knowledge guess "profile text").
 * Possible minors are skipped. The per-creator output stays out of git (it holds YouTube channel data).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, llmSpendSince } from "@mushin/db";
import { createLlm } from "@mushin/integrations";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { aiReview, type AiReviewDecision } from "../../apps/api/src/modules/creators/enrichment/ai-review";
import { createCreatorIndexer, standardize } from "../../apps/api/src/modules/creators/index";
import { createBudgetGate } from "./budget";

const { values } = parseArgs({
  options: { db: { type: "string" }, handles: { type: "string" }, "min-followers": { type: "string", default: "100000" }, cap: { type: "string", default: "15" }, apply: { type: "boolean", default: false }, out: { type: "string" }, concurrency: { type: "string", default: "4" } },
});
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const capUsd = Number(values.cap);
if (!(capUsd > 0 && capUsd <= 25)) throw new Error("--cap must be between 0 and 25 USD");
const minFollowers = Number(values["min-followers"]);
const handles = (values.handles ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2" });
const logger = createLogger({ level: "info", name: "ai-review" });
const db = createDatabase(url, { max: 4, applicationName: "ai-review", caPem: null });
const ownerSql = postgres(url, { max: 2, onnotice: () => {} });
const gate = await createBudgetGate(ownerSql, { capUsd, since: new Date("2026-10-20T00:00:00.000Z") });
const llm = createLlm(config.llm, { sink: createDbProviderCallSink(db), logger, budget: { budgetUsd: Math.min(config.llmMonthlyBudgetUsd, capUsd), spentSince: (since) => llmSpendSince(db, since) } });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const storageRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string | null): unknown => {
  if (!key) return null;
  for (const base of storageRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};

type Creator = { id: string; display_name: string; primary_platform: "instagram" | "tiktok" | "youtube"; account_type: string | null; account_type_source: string | null; niche_main: string | null; public_country_source: string | null; followers: number };
type Profile = { platform: "instagram" | "tiktok" | "youtube"; handle: string; followers: number | null; verified: boolean; bio: string | null; key: string | null };
const onlyHandles = handles.length ? sql`and exists (select 1 from gcp.creator_profiles h where h.creator_id = c.id and lower(h.handle) in (select jsonb_array_elements_text(${JSON.stringify(handles)}::jsonb)))` : sql``;
const creators = await db.withSystem((tx) =>
  tx.execute<Creator>(sql`
    select * from (
      select c.id, c.display_name, c.primary_platform, c.account_type, c.account_type_source, c.niche_main, c.public_country_source,
        (select max(p.followers) from gcp.creator_profiles p where p.creator_id = c.id)::bigint as followers
      from gcp.creators c
      where c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null) ${onlyHandles}
        and ((coalesce(c.account_type, 'UNKNOWN') = 'UNKNOWN' and c.account_type_source is distinct from 'staff') or c.niche_main is null)
    ) x where x.followers >= ${minFollowers} order by x.followers desc`),
);
logger.info({ candidates: creators.length, apply: values.apply }, "ai review start");

type Result = { id: string; handle: string; platform: string; followers: number; before: { type: string | null; niche: string | null }; decision: AiReviewDecision | null; error?: string; postsRead: number };
const results: Result[] = [];
async function review(c: Creator): Promise<void> {
  const profiles = await db.withSystem((tx) =>
    tx.execute<Profile>(sql`
      select p.platform, p.handle, p.followers, p.verified, p.bio,
        (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.delete_after > now()
          and not (p.platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < now() - interval '30 days') order by r.fetched_at desc limit 1) key
      from gcp.creator_profiles p where p.creator_id = ${c.id} order by (p.platform = ${c.primary_platform}) desc, p.followers desc nulls last`),
  );
  const main = profiles[0];
  if (!main) return;
  const raw = payload(main.key);
  const std = raw ? standardize(main.platform, main.handle, raw, { maxPosts: 30 }) : null;
  const posts = std?.kind === "ok" ? std.profile.recentPosts.filter((x) => !x.isPinned).slice(0, 6).map((x) => `${x.caption} ${x.hashtags.map((h) => `#${h.replace(/\s+/g, "_")}`).join(" ")}`.trim()) : [];
  const postsRead = posts.filter((p) => /[\p{L}\p{N}]{3,}/u.test(p)).length;
  const r: Result = { id: c.id, handle: main.handle, platform: main.platform, followers: Number(c.followers), before: { type: c.account_type, niche: c.niche_main }, decision: null, postsRead };
  try {
    r.decision = await gate.guard(0.002, () =>
      aiReview({
        llm,
        input: {
          displayName: c.display_name, handle: main.handle, platform: main.platform, followers: main.followers, verified: main.verified,
          category: std?.kind === "ok" ? (std.profile.accountCategory ?? null) : null, bio: main.bio ?? "", posts, publicRecord: c.public_country_source,
          linkedProfiles: profiles.slice(1).map((p) => ({ platform: p.platform, handle: p.handle, bio: p.bio ?? "" })),
        },
      }),
    );
  } catch (err) {
    r.error = err instanceof Error ? err.message.slice(0, 120) : String(err);
  }
  results.push(r);
  if (!values.apply || !r.decision) return;
  const d = r.decision;
  await db.withSystem(async (tx) => {
    if (d.accountType && (c.account_type === null || c.account_type === "UNKNOWN") && c.account_type_source !== "staff") {
      await tx.execute(sql`
        update gcp.creators set account_type = ${d.accountType.type}, account_type_source = 'ai', account_type_confidence = ${d.accountType.confidence},
          account_type_evidence = ${d.accountType.evidence}, account_type_assessed_at = now(), updated_at = now()
        where id = ${c.id} and status = 'active' and coalesce(account_type, 'UNKNOWN') = 'UNKNOWN' and account_type_source is distinct from 'staff'`);
    }
    if (d.niche && c.niche_main === null) {
      await tx.execute(sql`
        update gcp.creators set niche_main = ${d.niche.label}, niches = array[${d.niche.label}]::text[], niche_status = 'classified', niche_source = 'post_estimated',
          niche_confidence = 'low', niche_posts_assessed = 0, niche_assessed_at = now(), updated_at = now()
        where id = ${c.id} and status = 'active' and niche_main is null`);
    }
  });
}

const queue = [...creators];
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) await review(c);
}));

const tally = (f: (r: Result) => string) => results.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
const summary = {
  mode: values.apply ? "apply" : "dry-run",
  candidates: creators.length,
  reviewed: results.filter((r) => r.decision).length,
  failed: results.filter((r) => r.error).length,
  accountType: tally((r) => (r.decision?.accountType ? `${r.decision.accountType.type}:${r.decision.accountType.confidence}` : r.error ? "error" : "unsure")),
  niche: tally((r) => (r.before.niche ? "already_set" : r.decision?.niche ? (r.decision.niche.fromText ? "from_text" : "from_public_knowledge") : "none")),
};
if (values.out) writeFileSync(values.out, `${JSON.stringify({ summary, results }, null, 1)}\n`);
const projection = values.apply ? await createCreatorIndexer({ db, index: null, logger }).reconcile() : null;
console.log(JSON.stringify({ ...summary, projection }));
await ownerSql.end();
await db.close();
process.exit(0);
