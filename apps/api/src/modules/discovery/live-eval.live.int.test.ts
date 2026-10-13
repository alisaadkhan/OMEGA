/**
 * Opt-in Live Discovery quality evaluation (real Serper, hosted LLM, Apify and the YouTube Data API).
 *
 * It runs the production query planner, candidate collection, cheap gate, LLM relevance filter, scraper,
 * standardizer and Campaign Fit gate over a matrix of briefs and writes every candidate's disposition to
 * LIVE_EVAL_OUT. Provider responses are cached in that directory (outside the repository), so a re-run after a
 * code change replays the same search results, relevance decisions and profiles and pays only for new work.
 *
 * LIVE_EVAL_YT_NATIVE=1 adds YouTube Data API video and channel searches (quota only, $0) for briefs that include YouTube;
 * LIVE_EVAL_EXTRACT_YT=<n> changes how many YouTube channels are evaluated per brief (default 10; extraction is free).
 *
 * LIVE_DISCOVERY_EVAL=1 LIVE_EVAL_OUT=<dir> LIVE_EVAL_APIFY_BUDGET_USD=0.5 [LIVE_EVAL_BRIEFS=id,id] [LIVE_EVAL_LABEL=baseline]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { searchFiltersSchema, type LiveSearch } from "@mushin/contracts";
import { createLogger, loadWorkerConfig, sha256Hex } from "@mushin/core";
import { createDbProviderCallSink, providerCallsSince } from "@mushin/db";
import { createTestDatabase } from "@mushin/db/testing";
import { createBudgetGuard, createLlm, createProfileScraper, createSearchLimitGuard, createSerperSearch, createYouTubeSearch, type Llm, type WebResult } from "@mushin/integrations";
import { normalizeProfileUrl, standardize, type CreatorPlatform } from "../creators/index";
import { evaluateCampaignFit } from "./fit";
import { collectCandidates, spreadByPlatform } from "./live/candidates";
import { buildQueries, type PlannedQuery } from "./live/queries";
import { classifyCandidates, filterRelevant, type Kept } from "./live/relevance";

const enabled = process.env["LIVE_DISCOVERY_EVAL"] === "1";
const OUT = process.env["LIVE_EVAL_OUT"] ?? "";
const LABEL = process.env["LIVE_EVAL_LABEL"] ?? "run";
const APIFY_BUDGET_USD = Number(process.env["LIVE_EVAL_APIFY_BUDGET_USD"] ?? "0");
const ONLY = new Set((process.env["LIVE_EVAL_BRIEFS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
/** Production sampling (platform.enrichment_settings): 12 Instagram posts / YouTube videos, 6 TikTok videos. */
const MAX_POSTS: Record<CreatorPlatform, number> = { instagram: 12, tiktok: 6, youtube: 12 };
/** Bounded extraction per brief and platform; YouTube reads are free (quota only). */
const EXTRACT: Record<CreatorPlatform, number> = { instagram: 8, tiktok: 4, youtube: Number(process.env["LIVE_EVAL_EXTRACT_YT"] ?? "10") };
const YT_NATIVE = process.env["LIVE_EVAL_YT_NATIVE"] === "1";
/** Apify list prices observed on this account's runs (USD per profile at the sampling above). */
const UNIT_USD: Record<CreatorPlatform, number> = { instagram: 0.0026, tiktok: 0.003 * MAX_POSTS.tiktok, youtube: 0 };

type Brief = { id: string; group: string; language: "en" | "ur" | "roman_urdu" | "mixed"; text: string; filters: Record<string, unknown> };

const BRIEFS: Brief[] = [
  { id: "ig-food-khi", group: "food", language: "en", text: "Pakistani food blogger in Karachi", filters: { platform: "instagram", creatorCity: "Karachi", niches: ["Food"] } },
  { id: "ig-restaurant-lhr", group: "food", language: "en", text: "Lahore restaurant reviewers", filters: { platform: "instagram", creatorCity: "Lahore", niches: ["Food"] } },
  { id: "ig-food-multan", group: "food", language: "en", text: "Multan food creators", filters: { platform: "instagram", creatorCity: "Multan", niches: ["Food"] } },
  { id: "ig-skincare-micro-khi", group: "beauty", language: "en", text: "micro-influencers making skincare content in Karachi", filters: { platform: "instagram", creatorCity: "Karachi", niches: ["Beauty"], followersMin: 5000, followersMax: 100000 } },
  { id: "ig-bridal-lhr-urdu", group: "beauty", language: "ur", text: "لاہور دلہن میک اپ آرٹسٹ", filters: { platform: "instagram", creatorCity: "Lahore", niches: ["Bridal"] } },
  { id: "ig-fashion-isb", group: "fashion", language: "en", text: "fashion stylist Islamabad", filters: { platform: "instagram", creatorCity: "Islamabad", niches: ["Fashion"] } },
  { id: "ig-fitness-pk", group: "fitness", language: "en", text: "Pakistani fitness coach", filters: { platform: "instagram", creatorCountry: "PK", niches: ["Wellness"] } },
  { id: "ig-travel-north", group: "travel", language: "en", text: "Hunza Gilgit northern areas travel", filters: { platform: "instagram", creatorCountry: "PK", niches: ["Travel"] } },
  { id: "ig-photo-khi", group: "photography", language: "en", text: "Karachi photographer videographer", filters: { platform: "instagram", creatorCity: "Karachi" } },
  { id: "ig-parenting-pk", group: "parenting", language: "en", text: "Pakistani mom blogger parenting", filters: { platform: "instagram", creatorCountry: "PK", niches: ["Lifestyle"] } },
  { id: "ig-realestate-pk", group: "business", language: "en", text: "real estate property advisor Pakistan", filters: { platform: "instagram", creatorCountry: "PK", niches: ["Finance"] } },
  { id: "tt-motorcycle-pk", group: "automotive", language: "en", text: "motorcycles bike riders Pakistan", filters: { platform: "tiktok", creatorCountry: "PK" } },
  { id: "tt-comedy-pk", group: "comedy", language: "en", text: "Pakistani comedy creators", filters: { platform: "tiktok", creatorCountry: "PK", niches: ["Comedy"] } },
  { id: "tt-makeup-lhr", group: "beauty", language: "en", text: "Pakistani makeup artist creator in Lahore", filters: { platform: "tiktok", creatorCity: "Lahore", niches: ["Beauty"] } },
  { id: "tt-streetfood-khi-roman", group: "food", language: "roman_urdu", text: "Karachi street food wala videos", filters: { platform: "tiktok", creatorCity: "Karachi", niches: ["Food"] } },
  { id: "tt-education-urdu", group: "education", language: "en", text: "Urdu speaking educational creators", filters: { platform: "tiktok", creatorCountry: "PK" } },
  { id: "yt-budget-phones", group: "tech", language: "en", text: "budget phones review in Urdu", filters: { platform: "youtube", creatorCountry: "PK", niches: ["Tech"] } },
  { id: "yt-roman-tech", group: "tech", language: "roman_urdu", text: "Roman Urdu tech reviewer", filters: { platform: "youtube", creatorCountry: "PK", niches: ["Tech"] } },
  { id: "yt-cooking-urdu", group: "food", language: "ur", text: "پاکستانی کھانا ریسپی", filters: { platform: "youtube", creatorCountry: "PK", niches: ["Food"] } },
  { id: "yt-career-pk", group: "education", language: "en", text: "career advice and study abroad guidance Pakistan", filters: { platform: "youtube", creatorCountry: "PK" } },
  { id: "yt-gaming-pk", group: "gaming", language: "en", text: "Pakistani gaming YouTuber", filters: { platform: "youtube", creatorCountry: "PK" } },
  { id: "yt-finance-urdu", group: "business", language: "en", text: "personal finance and investing in Urdu", filters: { platform: "youtube", creatorCountry: "PK", niches: ["Finance"] } },
  { id: "yt-cars-pk", group: "automotive", language: "en", text: "car reviews Pakistan", filters: { platform: "youtube", creatorCountry: "PK" } },
  { id: "all-food-lhr-roman", group: "food", language: "roman_urdu", text: "Lahore ke khana bloggers", filters: { creatorCity: "Lahore", creatorCountry: "PK", niches: ["Food"] } },
  { id: "all-food-peshawar", group: "food", language: "en", text: "Peshawar food vlogger", filters: { creatorCity: "Peshawar", creatorCountry: "PK", niches: ["Food"] } },
];

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** "12.5K Followers", "1,234 subscribers", "3M Followers" in a Google snippet; an independent observation of the count. */
function snippetAudience(text: string): number | null {
  const m = /(\d[\d,.]*)\s*([KMB])?\+?\s*(?:followers|subscribers)\b/i.exec(text);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1));
}

const db = createTestDatabase();
afterAll(() => db.close());

describe.skipIf(!enabled)("Live Discovery quality evaluation (real providers, bounded)", () => {
  it("records the full funnel and every candidate's disposition for each brief", async () => {
    if (!OUT) throw new Error("LIVE_EVAL_OUT must name an output directory outside the repository");
    const config = loadWorkerConfig(process.env);
    if (!config.scraping.serperApiKey || config.llm.length === 0) throw new Error("Serper and hosted LLM credentials are required");
    const logger = createLogger({ level: "silent" });
    const sink = createDbProviderCallSink(db);
    for (const dir of ["serp", "llm", "raw/instagram", "raw/tiktok", "raw/youtube", "ytsearch"]) await mkdir(join(OUT, dir), { recursive: true });
    const yt = createYouTubeSearch({ apiKey: config.scraping.youtubeApiKey, sink, logger });
    /** YouTube-native query: the brief's Latin-script topic words (or niches) plus place; Urdu requested → ur relevance. */
    async function ytNative(b: Brief, type: "video" | "channel"): Promise<{ results: WebResult[]; query: string; cached: boolean }> {
      const niches = ((b.filters["niches"] as string[] | undefined) ?? []).join(" ");
      const latin = b.text.split(/\s+/).filter((w) => /^[\p{Script=Latin}\p{N}-]+$/u.test(w)).join(" ");
      const place = (b.filters["creatorCity"] as string | undefined) ?? "Pakistan";
      const base = latin || niches;
      const query = base.toLowerCase().includes(place.toLowerCase()) ? base : `${base} ${place}`;
      const lang = b.language === "ur" || b.language === "roman_urdu" || /urdu/i.test(b.text) ? "ur" : undefined;
      const file = join(OUT, "ytsearch", `${sha256Hex(`${type}|${lang ?? ""}|${query}`)}.json`);
      const hit = await readJson<{ results: WebResult[] }>(file);
      if (hit) return { results: hit.results, query, cached: true };
      const results = await yt.search({ query, type, regionCode: "PK", ...(lang ? { relevanceLanguage: lang } : {}), max: 25 });
      spend.youtubeSearches++;
      await writeFile(file, JSON.stringify({ query, type, lang, results, at: new Date().toISOString() }));
      return { results, query, cached: false };
    }
    const web = createSerperSearch({
      apiKey: config.scraping.serperApiKey,
      limit: createSearchLimitGuard({ limit: config.scraping.serperMonthlySearchLimit, countSince: (since) => providerCallsSince(db, "serper", since) }),
      sink,
      logger,
    });
    const realLlm = createLlm(config.llm, { sink, logger });
    const spend = { apifyUsd: 0, serperLive: 0, serperCached: 0, llmLive: 0, llmCached: 0, llmErrors: 0, youtubeReads: 0, youtubeSearches: 0 };
    const scraper = createProfileScraper({
      apify: config.scraping.apifyToken
        ? { token: config.scraping.apifyToken, instagramActor: config.scraping.instagramActor, tiktokActor: config.scraping.tiktokActor,
            ...(config.scraping.instagramBuild ? { instagramBuild: config.scraping.instagramBuild } : {}),
            ...(config.scraping.tiktokBuild ? { tiktokBuild: config.scraping.tiktokBuild } : {}) }
        : null,
      youtubeApiKey: config.scraping.youtubeApiKey,
      tiktokVideos: MAX_POSTS.tiktok,
      youtubeVideos: MAX_POSTS.youtube,
      // The evaluation has its own hard cap below; the account cap is enforced by Apify itself.
      spendGuard: createBudgetGuard({ budgetUsd: APIFY_BUDGET_USD, spentSince: async () => spend.apifyUsd }),
      sink,
      logger,
    });

    async function search(q: PlannedQuery): Promise<{ results: WebResult[]; cached: boolean; ms: number }> {
      const file = join(OUT, "serp", `${sha256Hex(`${q.country}|${q.hl}|${q.num}|${q.query}`)}.json`);
      const hit = await readJson<{ results: WebResult[] }>(file);
      if (hit) {
        spend.serperCached++;
        return { results: hit.results, cached: true, ms: 0 };
      }
      const t = Date.now();
      const results = await web.search({ query: q.query, country: q.country, hl: q.hl, num: q.num, autocorrect: false });
      spend.serperLive++;
      await writeFile(file, JSON.stringify({ query: q, results, at: new Date().toISOString() }));
      return { results, cached: false, ms: Date.now() - t };
    }

    /** Relevance decisions are replayed for an identical prompt so code changes are compared on the same LLM output. */
    const llm: Llm = {
      async complete(req) {
        const file = join(OUT, "llm", `${sha256Hex(`${req.feature}|${req.system}|${req.input}`)}.json`);
        const hit = await readJson<{ value: unknown }>(file);
        if (hit) {
          spend.llmCached++;
          return { value: req.schema.parse(hit.value), model: "replay" };
        }
        try {
          const out = await realLlm.complete(req);
          spend.llmLive++;
          await writeFile(file, JSON.stringify({ value: out.value }));
          return out;
        } catch (err) {
          spend.llmErrors++;
          throw err;
        }
      },
    } as Llm;

    async function extract(platform: CreatorPlatform, handles: string[]): Promise<Map<string, { raw: unknown; fetchedAt: string } | "budget">> {
      const out = new Map<string, { raw: unknown; fetchedAt: string } | "budget">();
      const missing: string[] = [];
      for (const h of handles) {
        const hit = await readJson<{ raw: unknown; fetchedAt: string }>(join(OUT, "raw", platform, `${h}.json`));
        if (hit) out.set(h, hit);
        else missing.push(h);
      }
      const affordable = UNIT_USD[platform] === 0 ? missing : missing.slice(0, Math.max(0, Math.floor((APIFY_BUDGET_USD - spend.apifyUsd) / UNIT_USD[platform] + 1e-9)));
      for (const h of missing.filter((m) => !affordable.includes(m))) out.set(h, "budget");
      if (affordable.length === 0) return out;
      const batch = await scraper.fetchProfiles({ platform, handles: affordable });
      spend.apifyUsd += batch.costUsd;
      if (platform === "youtube") spend.youtubeReads += affordable.length;
      const fetchedAt = new Date().toISOString();
      for (const h of affordable) {
        const raw = batch.profiles.find((p) => p.handle === h.toLowerCase())?.raw ?? [];
        await writeFile(join(OUT, "raw", platform, `${h}.json`), JSON.stringify({ raw, fetchedAt }));
        out.set(h, { raw, fetchedAt });
      }
      return out;
    }

    const report: unknown[] = [];
    for (const brief of BRIEFS.filter((b) => ONLY.size === 0 || ONLY.has(b.id))) {
      const startedAt = Date.now();
      const s: LiveSearch = { text: brief.text, filters: searchFiltersSchema.parse(brief.filters) };
      // 1–2. All three planner rounds are executed for diagnosis; `runnerStopsAfterRound` records what production does.
      const queries: unknown[] = [];
      const groups: { platform: CreatorPlatform; results: WebResult[] }[] = [];
      const firstSeen = new Map<string, { round: number; query: string }>();
      let runnerStopsAfterRound: number | null = null;
      let serpMs = 0;
      for (const round of [1, 2, 3] as const) {
        for (const q of buildQueries(s, round)) {
          const r = await search(q);
          serpMs += r.ms;
          groups.push({ platform: q.platform, results: r.results });
          let profileUrls = 0;
          let newProfiles = 0;
          const nonProfile: string[] = [];
          for (const res of r.results) {
            const n = normalizeProfileUrl(res.link);
            if (!n || n.platform !== q.platform) {
              nonProfile.push(res.link);
              continue;
            }
            profileUrls++;
            if (!firstSeen.has(n.canonicalUrl)) {
              firstSeen.set(n.canonicalUrl, { round, query: q.query });
              newProfiles++;
            }
          }
          queries.push({ round, platform: q.platform, hl: q.hl, query: q.query, results: r.results.length, profileUrls, newProfiles, nonProfile: nonProfile.slice(0, 5), cached: r.cached });
        }
        if (runnerStopsAfterRound === null && collectCandidates(groups, 60).length >= 8) runnerStopsAfterRound = round;
      }
      // YouTube-native discovery, recorded as its own query family so its new unique channels can be counted.
      if (YT_NATIVE && (!brief.filters["platform"] || brief.filters["platform"] === "youtube")) {
        for (const type of ["video", "channel"] as const) {
          const r = await ytNative(brief, type);
          const query = `yt_api_${type}: ${r.query}`;
          groups.push({ platform: "youtube", results: r.results });
          let newProfiles = 0;
          for (const res of r.results) {
            const n = normalizeProfileUrl(res.link);
            if (n && !firstSeen.has(n.canonicalUrl)) {
              firstSeen.set(n.canonicalUrl, { round: 1, query });
              newProfiles++;
            }
          }
          queries.push({ round: 1, platform: "youtube", hl: "api", query, results: r.results.length, profileUrls: r.results.length, newProfiles, nonProfile: [], cached: r.cached });
        }
      }
      const allCandidates = collectCandidates(groups, 1000);
      const runnerCandidates = collectCandidates(groups);
      // 3. Cheap gate then LLM relevance, exactly as the runner calls them.
      const gated = classifyCandidates(s, runnerCandidates);
      let reviewed: Kept[] = [];
      let relevanceError: string | null = null;
      try {
        reviewed = await filterRelevant({ llm, search: s, candidates: gated.ambiguous, logger });
      } catch (err) {
        relevanceError = err instanceof Error ? err.message.slice(0, 200) : String(err);
      }
      const kept = [...gated.possible, ...reviewed];
      const keptUrls = new Set(kept.map((k) => k.canonicalUrl));
      const businessDropped = runnerCandidates.filter((c) => !keptUrls.has(c.canonicalUrl) && !gated.ambiguous.some((a) => a.canonicalUrl === c.canonicalUrl));
      // 4–7. Extract a bounded sample in runner order and run the Fit gate on every extracted profile.
      const order = spreadByPlatform(kept);
      const toExtract: Kept[] = [];
      for (const p of ["instagram", "tiktok", "youtube"] as const) {
        const limit = brief.filters["platform"] ? EXTRACT[p] : Math.ceil(EXTRACT[p] / 2);
        toExtract.push(...order.filter((k) => k.platform === p).slice(0, limit));
      }
      const candidates: unknown[] = [];
      const fitCounts: Record<string, number> = {};
      let extractedOk = 0;
      let eligible = 0;
      for (const platform of ["instagram", "tiktok", "youtube"] as const) {
        const list = toExtract.filter((k) => k.platform === platform);
        if (list.length === 0) continue;
        let fetched: Awaited<ReturnType<typeof extract>>;
        try {
          fetched = await extract(platform, list.map((k) => k.handle));
        } catch (err) {
          for (const k of list) candidates.push({ platform, handle: k.handle, url: k.canonicalUrl, extraction: `error: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` });
          fitCounts["extraction_error"] = (fitCounts["extraction_error"] ?? 0) + list.length;
          continue;
        }
        for (const k of list) {
          const f = fetched.get(k.handle);
          const base = { platform, handle: k.handle, url: k.canonicalUrl, title: k.title, snippet: k.snippet, gateReason: k.reason, snippetAudience: snippetAudience(`${k.title} ${k.snippet}`), firstSeen: firstSeen.get(k.canonicalUrl) };
          if (!f || f === "budget") {
            candidates.push({ ...base, extraction: "skipped_budget" });
            fitCounts["skipped_budget"] = (fitCounts["skipped_budget"] ?? 0) + 1;
            continue;
          }
          const std = standardize(platform, k.handle, f.raw, { maxPosts: MAX_POSTS[platform] });
          if (std.kind !== "ok") {
            candidates.push({ ...base, extraction: std.kind });
            fitCounts[std.kind] = (fitCounts[std.kind] ?? 0) + 1;
            continue;
          }
          extractedOk++;
          const p = std.profile;
          const fit = evaluateCampaignFit(s, k, p, false, new Date(), new Date(f.fetchedAt));
          if (fit.eligible) eligible++;
          const key = fit.eligible ? "eligible" : fit.gate ?? "below_min_fit";
          fitCounts[key] = (fitCounts[key] ?? 0) + 1;
          const latest = p.recentPosts[0]?.postedAt;
          candidates.push({
            ...base,
            extraction: "ok",
            fetchedAt: f.fetchedAt,
            profile: {
              handle: p.handle, displayName: p.displayName, bio: p.bio.slice(0, 300), followers: p.followers, following: p.following, posts: p.posts,
              verified: p.verified, country: p.country, recentPosts: p.recentPosts.length,
              daysSinceLatest: latest ? Math.floor((Date.now() - latest.getTime()) / 86_400_000) : null,
              captions: p.recentPosts.slice(0, 6).map((x) => `${x.caption.slice(0, 140)} ${x.hashtags.slice(0, 5).map((h) => `#${h}`).join(" ")}`.trim()),
              likesKnown: p.recentPosts.filter((x) => x.likes !== null).length, viewsKnown: p.recentPosts.filter((x) => x.views !== null).length,
            },
            fit: { eligible: fit.eligible, gate: fit.gate, score: fit.score, topicScore: fit.topicScore, confidence: fit.confidence, sampleSize: fit.sampleSize, evidence: fit.evidence },
          });
        }
      }
      const summary = {
        id: brief.id, group: brief.group, language: brief.language, text: brief.text, filters: brief.filters,
        funnel: {
          serpResults: groups.reduce((n, g) => n + g.results.length, 0),
          uniqueProfilesAllRounds: allCandidates.length,
          runnerStopsAfterRound,
          runnerCandidateCap60: runnerCandidates.length,
          cheapGatePossible: gated.possible.length,
          cheapGateBusinessRejected: gated.rejected,
          llmReviewed: gated.ambiguous.length,
          llmKept: reviewed.length,
          kept: kept.length,
          runnerWouldStopInsufficient: kept.length < 8,
          extractionAttempted: toExtract.length,
          extractedOk,
          eligible,
          fitCounts,
        },
        relevanceError,
        businessDropped: businessDropped.map((c) => ({ handle: c.handle, platform: c.platform, title: c.title.slice(0, 120) })),
        llmDropped: gated.ambiguous.filter((a) => !reviewed.some((r) => r.canonicalUrl === a.canonicalUrl)).map((c) => ({ handle: c.handle, platform: c.platform, title: c.title.slice(0, 120), snippet: c.snippet.slice(0, 160) })),
        notExtracted: order.filter((k) => !toExtract.includes(k)).map((k) => ({ handle: k.handle, platform: k.platform, title: k.title.slice(0, 120) })),
        queries,
        candidates,
        ms: { total: Date.now() - startedAt, serp: serpMs },
      };
      report.push(summary);
      process.stdout.write(`${JSON.stringify({ brief: brief.id, funnel: summary.funnel, relevanceError })}\n`);
      await writeFile(join(OUT, `${LABEL}.json`), JSON.stringify({ label: LABEL, at: new Date().toISOString(), spend, briefs: report }, null, 1));
    }
    process.stdout.write(`${JSON.stringify({ spend })}\n`);
    expect(spend.apifyUsd).toBeLessThanOrEqual(APIFY_BUDGET_USD + 0.02);
  }, 3_600_000);
});
