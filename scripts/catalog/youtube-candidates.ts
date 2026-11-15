/**
 * Candidate YouTube channels for catalogue growth, from the official YouTube Data API (search.list type=channel,
 * regionCode=PK; channels.list for the handle and subscriber count). Writes a seed manifest for build.ts seed, which
 * fetches each channel through the add-by-link path and applies every existing rule (country, eligibility, account type,
 * niche, engagement). Channels already in the catalogue and channels under 10K subscribers (never searchable under the
 * existing 10K rule) are left out, so no fetch is spent on them. The manifest holds handles and links only, never API
 * figures, and is written outside the repository. Each API call is recorded in platform.provider_calls (quota units).
 *
 *   node --env-file=.env --import tsx scripts/catalog/youtube-candidates.ts --db mushin_catalog_v4 --out <file> \
 *     --queries "pakistani food vlog,urdu tech review" [--pages 1]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createDatabase, createDbProviderCallSink } from "@mushin/db";
import { sql } from "drizzle-orm";

const { values } = parseArgs({ options: { db: { type: "string" }, out: { type: "string" }, queries: { type: "string" }, pages: { type: "string", default: "1" }, "min-subscribers": { type: "string", default: "10000" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
if (!values.out) throw new Error("--out <manifest file> is required");
const key = process.env["YOUTUBE_API_KEY"];
if (!key) throw new Error("YOUTUBE_API_KEY is not set");
const queries = (values.queries ?? "").split(",").map((q) => q.trim()).filter(Boolean);
if (queries.length === 0) throw new Error("--queries is required");
const url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
const db = createDatabase(url, { max: 2, applicationName: "youtube-candidates", caPem: null });
const sink = createDbProviderCallSink(db);
const logger = createLogger({ level: "info", name: "youtube-candidates" });

async function api<T>(operation: string, units: number, path: string, params: Record<string, string>): Promise<T> {
  const started = Date.now();
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: key as string })}`, { signal: AbortSignal.timeout(20_000) });
  const ok = res.ok;
  await sink.record({ provider: "youtube", operation, model: null, tokensIn: null, tokensOut: null, units, latencyMs: Date.now() - started, status: ok ? "ok" : "error", costUsd: 0, errorCode: ok ? null : `http_${res.status}`, workspaceId: null, jobId: null, requestId: null });
  if (!ok) throw new Error(`YouTube ${path} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

const known = new Set(
  [...(await db.withSystem((tx) => tx.execute<{ h: string }>(sql`select lower(handle) h from gcp.creator_profiles where platform = 'youtube'`)))].map((r) => r.h),
);
const suppressed = new Set(
  [...(await db.withSystem((tx) => tx.execute<{ h: string }>(sql`select url_hash h from gcp.creator_suppressions`)))].map((r) => r.h),
);
const ids = new Map<string, string>(); // channel id -> first query that found it
for (const q of queries) {
  let pageToken: string | undefined;
  for (let page = 0; page < Number(values.pages); page++) {
    try {
      const r = await api<{ items?: { id?: { channelId?: string } }[]; nextPageToken?: string }>("channel_search", 100, "search", { part: "snippet", type: "channel", regionCode: "PK", maxResults: "50", q, ...(pageToken ? { pageToken } : {}) });
      for (const it of r.items ?? []) if (it.id?.channelId && !ids.has(it.id.channelId)) ids.set(it.id.channelId, q);
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    } catch (err) {
      logger.warn({ q, err: (err as Error).message }, "search failed");
      break;
    }
  }
}
const candidates: { handle: string; url: string; query: string }[] = [];
let tooSmall = 0;
let alreadyKnown = 0;
const all = [...ids.keys()];
for (let i = 0; i < all.length; i += 50) {
  const batch = all.slice(i, i + 50);
  const r = await api<{ items?: { id: string; snippet?: { customUrl?: string }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>("channel_lookup", 1, "channels", { part: "snippet,statistics", id: batch.join(","), maxResults: "50" });
  for (const ch of r.items ?? []) {
    const handle = (ch.snippet?.customUrl ?? "").replace(/^@/, "").toLowerCase();
    if (!handle) continue;
    if (known.has(handle)) {
      alreadyKnown++;
      continue;
    }
    const subs = ch.statistics?.hiddenSubscriberCount ? null : Number(ch.statistics?.subscriberCount ?? "0");
    if (subs !== null && subs < Number(values["min-subscribers"])) {
      tooSmall++;
      continue;
    }
    const link = `https://www.youtube.com/@${handle}`;
    const hash = (await import("node:crypto")).createHash("sha256").update(link.toLowerCase()).digest("hex");
    if (suppressed.has(hash)) continue;
    candidates.push({ handle, url: link, query: ids.get(ch.id) ?? "" });
  }
}
writeFileSync(values.out, `${JSON.stringify({ platform: "youtube", prepared: new Date().toISOString().slice(0, 10), method: "YouTube Data API channel search (regionCode=PK) over niche queries; each channel is fetched and judged by the MUSHIN rules, a search result is not evidence of nationality.", candidates }, null, 1)}\n`);
console.log(JSON.stringify({ queries: queries.length, channelsFound: ids.size, alreadyKnown, under10k: tooSmall, candidates: candidates.length }));
await db.close();
