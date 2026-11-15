/**
 * AI account-type and niche review of large accounts (owner directive 2026-11-15, §2.2–2.3, Decision 2): active
 * creators with 100K+ followers whose rules left the account type UNKNOWN or the niche empty. Run after the
 * deterministic reassessment and evidence backfill, so their readings are final first. Dry run by default.
 *
 *   GEMINI_BILLING=free_accepted node --env-file=.env --import tsx scripts/catalog/ai-review.ts --db mushin_catalog_v4 \
 *     [--handles a,b] [--min-followers 100000] [--cap 15] [--rereview-ai] [--apply] [--out <file outside the repository>]
 *
 * Each account's name is looked up on Wikipedia first (§2.3); name-matched articles go to the model as evidence.
 * --rereview-ai also re-asks earlier AI decisions, but only where Wikipedia now has an article for the name (no new
 * evidence, no new call) or a weaker model than gpt-oss-120b made them; a newer AI decision may replace an older AI one,
 * never a staff or rule decision. --models keeps only the chain entries whose model contains one of the given names.
 * --wikipedia-only asks the model only where Wikipedia has an article for the name (the evidence a smaller model can use
 * reliably when gpt-oss-120b's free daily token limit, 200K, is spent); the rest wait for a 120B pass.
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
import { aiReview, lookupWikipedia, type AiReviewDecision, type WikipediaArticle } from "../../apps/api/src/modules/creators/enrichment/ai-review";
import { createCreatorIndexer, standardize } from "../../apps/api/src/modules/creators/index";
import { createBudgetGate } from "./budget";

const { values } = parseArgs({
  options: { db: { type: "string" }, handles: { type: "string" }, "min-followers": { type: "string", default: "100000" }, cap: { type: "string", default: "15" }, apply: { type: "boolean", default: false }, "rereview-ai": { type: "boolean", default: false }, "wikipedia-only": { type: "boolean", default: false }, models: { type: "string" }, out: { type: "string" }, concurrency: { type: "string", default: "4" } },
});
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const capUsd = Number(values.cap);
if (!(capUsd > 0 && capUsd <= 25)) throw new Error("--cap must be between 0 and 25 USD");
const minFollowers = Number(values["min-followers"]);
const rereview = values["rereview-ai"] === true;
const handles = (values.handles ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const config = loadWorkerConfig({ ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL_CA_FILE: "", SEARCH_PROFILE: "v2" });
const logger = createLogger({ level: "info", name: "ai-review" });
const db = createDatabase(url, { max: 4, applicationName: "ai-review", caPem: null });
const ownerSql = postgres(url, { max: 2, onnotice: () => {} });
const gate = await createBudgetGate(ownerSql, { capUsd, since: new Date("2026-10-20T00:00:00.000Z") });
const onlyModels = (values.models ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const chain = onlyModels.length ? config.llm.filter((p) => onlyModels.some((m) => p.model.includes(m))) : config.llm;
if (chain.length === 0) throw new Error(`--models ${values.models} matches no configured model`);
const llm = createLlm(chain, { sink: createDbProviderCallSink(db), logger, budget: { budgetUsd: Math.min(config.llmMonthlyBudgetUsd, capUsd), spentSince: (since) => llmSpendSince(db, since) } });
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const storageRoots = existsSync(join(root, ".catalog-storage")) ? readdirSync(join(root, ".catalog-storage")).map((d) => join(root, ".catalog-storage", d, "raw-payloads")) : [];
const payload = (key: string | null): unknown => {
  if (!key) return null;
  for (const base of storageRoots) if (existsSync(join(base, key))) return JSON.parse(readFileSync(join(base, key), "utf8"));
  return null;
};

type Creator = { id: string; display_name: string; primary_platform: "instagram" | "tiktok" | "youtube"; account_type: string | null; account_type_source: string | null; account_type_evidence: string | null; niche_main: string | null; public_country_source: string | null; followers: number };
type Profile = { platform: "instagram" | "tiktok" | "youtube"; handle: string; followers: number | null; verified: boolean; bio: string | null; key: string | null };
const onlyHandles = handles.length ? sql`and exists (select 1 from gcp.creator_profiles h where h.creator_id = c.id and lower(h.handle) in (select jsonb_array_elements_text(${JSON.stringify(handles)}::jsonb)))` : sql``;
const creators = await db.withSystem((tx) =>
  tx.execute<Creator>(sql`
    select * from (
      select c.id, c.display_name, c.primary_platform, c.account_type, c.account_type_source, c.account_type_evidence, c.niche_main, c.public_country_source,
        (select max(p.followers) from gcp.creator_profiles p where p.creator_id = c.id)::bigint as followers
      from gcp.creators c
      where c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null) ${onlyHandles}
        and ((coalesce(c.account_type, 'UNKNOWN') = 'UNKNOWN' and c.account_type_source is distinct from 'staff') or c.niche_main is null
          or (${rereview} and c.account_type_source = 'ai'))
    ) x where x.followers >= ${minFollowers} order by x.followers desc`),
);
logger.info({ candidates: creators.length, apply: values.apply }, "ai review start");

const MAX_ATTEMPTS = 8;
const WAIT_MS = 20_000;
type Result = { id: string; handle: string; platform: string; followers: number; before: { type: string | null; niche: string | null }; decision: AiReviewDecision | null; error?: string; postsRead: number; wikipedia: string[]; wikipediaFailed?: true; skipped?: string };
const results: Result[] = [];
let withdrawn = 0;
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
  // Already re-reviewed with the Wikipedia check: a rerun (after a rate-limit stop) does not ask again.
  if (c.account_type_source === "ai" && c.niche_main !== null && /\[Wikipedia:/.test(c.account_type_evidence ?? "")) return;
  const raw = payload(main.key);
  const std = raw ? standardize(main.platform, main.handle, raw, { maxPosts: 30 }) : null;
  const posts = std?.kind === "ok" ? std.profile.recentPosts.filter((x) => !x.isPinned).slice(0, 6).map((x) => `${x.caption} ${x.hashtags.map((h) => `#${h.replace(/\s+/g, "_")}`).join(" ")}`.trim()) : [];
  const postsRead = posts.filter((p) => /[\p{L}\p{N}]{3,}/u.test(p)).length;
  let found: WikipediaArticle[] | null = null;
  // Wikipedia answers 429 to bursts of searches (seen 2026-11-15): back off 5 s, 20 s, 45 s, and pace every lookup.
  for (let attempt = 1; attempt <= 3 && found === null; attempt++) {
    found = await lookupWikipedia(fetch, c.display_name, main.handle);
    await new Promise((resolveWait) => setTimeout(resolveWait, found === null ? 5_000 * attempt * attempt : 3_000));
  }
  const wikipedia = found ?? [];
  const r: Result = { id: c.id, handle: main.handle, platform: main.platform, followers: Number(c.followers), before: { type: c.account_type, niche: c.niche_main }, decision: null, postsRead, wikipedia: wikipedia.map((w) => `${w.title}: ${w.description}`), ...(found === null ? { wikipediaFailed: true as const } : {}) };
  if (found === null) logger.warn({ event: "wikipedia_lookup_failed", handle: main.handle }, "Wikipedia lookup failed three times");
  if (values["wikipedia-only"] && wikipedia.length === 0) {
    r.skipped = found === null ? "Wikipedia lookup failed; left for a later pass" : "no Wikipedia article; left for a 120B pass";
    results.push(r);
    return;
  }
  if (c.account_type_source === "ai" && c.niche_main !== null && wikipedia.length === 0 && /gpt-oss-120b/.test(c.account_type_evidence ?? "")) {
    r.skipped = found === null ? "earlier AI decision kept: Wikipedia lookup failed" : "earlier AI decision kept: same model, no Wikipedia article for the name";
    results.push(r);
    return;
  }
  // When every model is cooling down (Groq's tokens-per-minute limit; Ollama answered 402 in the first full run), wait
  // and try again rather than failing the creator: 462 of 474 failed in under a minute that way (2026-11-15).
  for (let attempt = 1; ; attempt++) {
    try {
      r.decision = await gate.guard(0.002, () =>
        aiReview({
          llm,
          input: {
            displayName: c.display_name, handle: main.handle, platform: main.platform, followers: main.followers, verified: main.verified,
            category: std?.kind === "ok" ? (std.profile.accountCategory ?? null) : null, bio: main.bio ?? "", posts, publicRecord: c.public_country_source,
            linkedProfiles: profiles.slice(1).map((p) => ({ platform: p.platform, handle: p.handle, bio: p.bio ?? "" })),
            wikipedia,
          },
        }),
      );
      delete r.error;
      break;
    } catch (err) {
      r.error = err instanceof Error ? err.message.slice(0, 120) : String(err);
      const unavailable = /unavailable right now/i.test(r.error);
      if (!unavailable || attempt >= MAX_ATTEMPTS) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, WAIT_MS * attempt));
    }
  }
  results.push(r);
  if (!values.apply || !r.decision) return;
  const d = r.decision;
  // Every decision of this pass carries the Wikipedia tag (titles or "none"): it records the evidence and tells a rerun
  // this account was already reviewed with the check.
  const tag = ` [Wikipedia: ${wikipedia.map((w) => w.title).join("; ").slice(0, 120) || "none"}]`;
  const withTag = (text: string) => `${text.slice(0, 300 - tag.length)}${tag}`;
  await db.withSystem(async (tx) => {
    if (d.accountType && (c.account_type === null || c.account_type === "UNKNOWN" || c.account_type_source === "ai") && c.account_type_source !== "staff") {
      await tx.execute(sql`
        update gcp.creators set account_type = ${d.accountType.type}, account_type_source = 'ai', account_type_confidence = ${d.accountType.confidence},
          account_type_evidence = ${withTag(d.accountType.evidence)}, account_type_assessed_at = now(), updated_at = now()
        where id = ${c.id} and status = 'active' and (coalesce(account_type, 'UNKNOWN') = 'UNKNOWN' or account_type_source = 'ai') and account_type_source is distinct from 'staff'`);
    } else if (!d.accountType && c.account_type_source === "ai" && c.account_type !== "UNKNOWN") {
      // The stronger re-review cannot confirm an earlier AI decision (e.g. a weaker model's "fashion influencer" for a
      // singer): the honest state is UNKNOWN, not a medium-confidence guess.
      withdrawn++;
      await tx.execute(sql`
        update gcp.creators set account_type = 'UNKNOWN', account_type_source = 'ai', account_type_confidence = 'low',
          account_type_evidence = ${withTag(`AI review unsure, earlier AI decision withdrawn: ${d.reply.reason}`)}, account_type_assessed_at = now(), updated_at = now()
        where id = ${c.id} and status = 'active' and account_type_source = 'ai'`);
    }
    if (d.niche && c.niche_main === null) {
      await tx.execute(sql`
        update gcp.creators set niche_main = ${d.niche.label}, niches = array[${d.niche.label}]::text[], niche_status = 'classified', niche_source = 'post_estimated',
          niche_confidence = 'low', niche_posts_assessed = 0, niche_assessed_at = now(), updated_at = now()
        where id = ${c.id} and status = 'active' and niche_main is null`);
    }
  });
}

// Stop cleanly when the models stay unavailable (e.g. a daily token limit): each failure already waited ~12 minutes,
// and a rerun picks up only what is left.
const STOP_AFTER_FAILURES = 4;
let failuresInARow = 0;
const queue = [...creators];
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  for (let c = queue.shift(); c && failuresInARow < STOP_AFTER_FAILURES; c = queue.shift()) {
    await review(c);
    const last = results.find((r) => r.id === c?.id);
    failuresInARow = last?.error ? failuresInARow + 1 : last?.decision ? 0 : failuresInARow;
  }
}));
const stoppedEarly = queue.length > 0;
if (stoppedEarly) logger.warn({ event: "ai_review_stopped", left: queue.length }, `stopped after ${STOP_AFTER_FAILURES} failures in a row; rerun to continue`);

const tally = (f: (r: Result) => string) => results.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
const summary = {
  mode: values.apply ? "apply" : "dry-run",
  candidates: creators.length,
  stoppedEarly,
  left: queue.length,
  reviewed: results.filter((r) => r.decision).length,
  failed: results.filter((r) => r.error).length,
  keptWithoutNewEvidence: results.filter((r) => r.skipped).length,
  withWikipedia: results.filter((r) => r.wikipedia.length).length,
  wikipediaFailed: results.filter((r) => r.wikipediaFailed).length,
  withdrawnToUnknown: withdrawn,
  changedType: results.filter((r) => r.decision?.accountType && r.before.type !== r.decision.accountType.type).length,
  accountType: tally((r) => (r.decision?.accountType ? `${r.decision.accountType.type}:${r.decision.accountType.confidence}` : r.error ? "error" : r.skipped ? "kept" : "unsure")),
  niche: tally((r) => (r.before.niche ? "already_set" : r.decision?.niche ? (r.decision.niche.fromText ? "from_text" : "from_public_knowledge") : "none")),
};
if (values.out) writeFileSync(values.out, `${JSON.stringify({ summary, results }, null, 1)}\n`);
const projection = values.apply ? await createCreatorIndexer({ db, index: null, logger }).reconcile() : null;
console.log(JSON.stringify({ ...summary, projection }));
await ownerSql.end();
await db.close();
process.exit(0);
