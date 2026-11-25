/**
 * $0 YouTube catalogue expansion (owner, 25 Nov): YouTube Data API v3 only, no Serper and no Apify.
 *   1. Channel search per seed query (search.list type=channel, regionCode=PK, maxResults=50: 100 units), with the
 *      channels' statistics in one channels.list call per 50 ids (1 unit).
 *   2. Featured channels of our qualified YouTube creators (channels.list forHandle + channelSections.list: 2 units each)
 *      and YouTube links already saved from their About sections (free).
 *   3. Channels already in the catalogue, or under 10,000 subscribers (when the count is public), are dropped before any
 *      ingest; the rest go through the normal add-by-URL path (eligibility, country, minors, contacts and links decided
 *      there, never here). regionCode only biases ranking: it is not evidence of where a creator lives.
 * Quota: every unit is counted (recorded calls plus this module's own), and the run stops before `quotaUnits`.
 */
import { sql } from "drizzle-orm";
import type { Logger, ProviderCallSink } from "@mushin/core";
import type { Db } from "@mushin/db";
import { instrumented } from "@mushin/integrations";

const API = "https://www.googleapis.com/youtube/v3";
export type Channel = { id: string; handle: string | null; subscribers: number | null; country: string | null };
export type IngestResult = { status: string; outcome: string | null; error: string | null };
export type ExpansionQuery = { text: string; vertical: string; mainNiche: string };

export function createYouTubeApi(o: { apiKey: string; sink: ProviderCallSink; logger: Logger; fetch?: typeof fetch }) {
  const doFetch = o.fetch ?? fetch;
  let units = 0;
  let quotaHit = false;
  const call = async <T>(operation: string, cost: number, path: string): Promise<T> =>
    instrumented<T>(
      { provider: "youtube", operation, timeoutMs: 20_000, retries: 1, sink: o.sink, logger: o.logger, usage: () => ({ model: "youtube-data-v3", units: cost, costUsd: 0 }), isRetryable: () => !quotaHit },
      async (signal) => {
        units += cost;
        const res = await doFetch(`${API}/${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(o.apiKey)}`, { signal });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text();
        quotaHit = /quotaExceeded|dailyLimitExceeded/.test(text);
        throw new Error(quotaHit ? "YouTube daily quota used up" : `YouTube HTTP ${res.status}`);
      },
    ).catch((err: unknown) => {
      // A used-up quota stops the run with a clear reason (never retried); other failures keep the adapter's error.
      if (quotaHit) throw new Error("YouTube daily quota used up");
      throw err;
    });
  type Ch = { id?: string; snippet?: { customUrl?: string; country?: string }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } };
  const toChannel = (c: Ch): Channel => ({
    id: c.id ?? "",
    handle: c.snippet?.customUrl && /^@[\w.-]{1,100}$/.test(c.snippet.customUrl) ? c.snippet.customUrl : null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : c.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : null,
    country: c.snippet?.country ?? null,
  });
  return {
    units: () => units,
    /** Channels for ids, 50 per call (1 unit each). */
    async channels(ids: string[]): Promise<Channel[]> {
      const out: Channel[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const r = await call<{ items?: Ch[] }>("channels_stats", 1, `channels?part=snippet,statistics&maxResults=50&id=${ids.slice(i, i + 50).join(",")}`);
        out.push(...(r.items ?? []).map(toChannel));
      }
      return out;
    },
    /** search.list type=channel, regionCode=PK (100 units), then their statistics (1 unit). */
    async searchChannels(q: string): Promise<Channel[]> {
      const r = await call<{ items?: { id?: { channelId?: string } }[] }>("search_youtube_channel", 100, `search?part=snippet&type=channel&regionCode=PK&maxResults=50&q=${encodeURIComponent(q.slice(0, 200))}`);
      const ids = [...new Set((r.items ?? []).map((i) => i.id?.channelId).filter((id): id is string => !!id && /^[\w-]{10,40}$/.test(id)))];
      return ids.length ? this.channels(ids) : [];
    },
    /** A creator's featured channels (channels.list forHandle + channelSections.list: 2 units). */
    async featured(handle: string): Promise<string[]> {
      const me = await call<{ items?: { id?: string }[] }>("channel_for_handle", 1, `channels?part=id&forHandle=${encodeURIComponent(handle.replace(/^@?/, "@"))}`);
      const id = me.items?.[0]?.id;
      if (!id) return [];
      const s = await call<{ items?: { contentDetails?: { channels?: string[] } }[] }>("channel_sections", 1, `channelSections?part=contentDetails&channelId=${id}`);
      return [...new Set((s.items ?? []).flatMap((x) => x.contentDetails?.channels ?? []))].filter((c) => c !== id);
    },
  };
}

/** Handles (lower case, with @) of YouTube channel URLs: youtube.com/@name only (channel-id URLs are resolved by id). */
export function youtubeHandleOf(url: string): string | null {
  const m = /youtube\.com\/(@[\w.-]{1,100})/i.exec(url);
  return m?.[1] ? m[1].toLowerCase() : null;
}

export async function runYouTubeExpansion(o: {
  db: Db;
  api: ReturnType<typeof createYouTubeApi>;
  queries: ExpansionQuery[];
  ingest: (url: string) => Promise<IngestResult>;
  quotaUnits: number;
  /** YouTube units recorded since the run started (this module's calls and the ingest pipeline's, from provider_calls). */
  recordedUnits: () => Promise<number>;
  featuredFrom: number;
  minSubscribers?: number;
  /** At most this many channels are ingested (a small test run). */
  maxIngest?: number;
  logger: Logger;
}) {
  const min = o.minSubscribers ?? 10_000;
  const used = () => o.recordedUnits();
  const known = new Set([...(await o.db.withSystem((tx) => tx.execute<{ h: string }>(sql`select lower(handle) h from gcp.creator_profiles where platform = 'youtube'`)))].map((r) => (r.h.startsWith("@") ? r.h : `@${r.h}`)));
  const candidates = new Map<string, { channel: Channel; source: string; query?: ExpansionQuery }>();
  const report = { searches: [] as Record<string, unknown>[], featuredFrom: 0, featuredFound: 0, aboutLinks: 0, droppedKnown: 0, droppedSmall: 0, ingested: [] as Record<string, unknown>[], stoppedFor: null as string | null };
  const consider = (c: Channel, source: string, query?: ExpansionQuery) => {
    if (!c.handle) return;
    const h = c.handle.toLowerCase();
    if (known.has(h) || candidates.has(h)) return void (report.droppedKnown += 1);
    if (c.subscribers !== null && c.subscribers < min) return void (report.droppedSmall += 1);
    candidates.set(h, { channel: c, source, ...(query ? { query } : {}) });
  };
  // Keep ~3 units per candidate for the ingest (one channel + videos read), and stop searching when that is all that is left.
  const reserve = () => Math.max(600, candidates.size * 3);
  try {
    for (const q of o.queries) {
      if ((await used()) + 101 + reserve() > o.quotaUnits) { report.stoppedFor = "quota reserved for ingest"; break; }
      const found = await o.api.searchChannels(q.text);
      const before = candidates.size;
      for (const c of found) consider(c, "search", q);
      report.searches.push({ query: q.text, vertical: q.vertical, results: found.length, newCandidates: candidates.size - before });
      o.logger.info(report.searches.at(-1), "youtube search");
    }
    // Featured channels and About links of qualified YouTube creators (largest first).
    const sources = await o.db.withSystem((tx) => tx.execute<{ handle: string; links: string[] }>(sql`
      select p.handle, array(select l.url from gcp.creator_links l where l.creator_id = p.creator_id and l.url ilike '%youtube.com/%') links
      from gcp.creator_profiles p join gcp.creator_search_documents d on d.creator_id = p.creator_id
      where p.platform = 'youtube' and d.eligible order by p.followers desc nulls last limit ${o.featuredFrom}`));
    const featuredIds: string[] = [];
    for (const s of sources) {
      for (const l of s.links) {
        const h = youtubeHandleOf(l);
        if (h && !known.has(h) && !candidates.has(h)) { report.aboutLinks += 1; featuredIds.push(`handle:${h}`); }
      }
      if ((await used()) + 2 + reserve() > o.quotaUnits) { report.stoppedFor = "quota reserved for ingest"; break; }
      featuredIds.push(...(await o.api.featured(s.handle)));
      report.featuredFrom += 1;
    }
    const ids = [...new Set(featuredIds.filter((x) => !x.startsWith("handle:")))];
    report.featuredFound = ids.length;
    if (ids.length && (await used()) + Math.ceil(ids.length / 50) + reserve() <= o.quotaUnits) for (const c of await o.api.channels(ids)) consider(c, "featured");
    // About-link handles have no statistics yet: ingest decides their size.
    for (const x of featuredIds.filter((f) => f.startsWith("handle:"))) consider({ id: "", handle: x.slice(7), subscribers: null, country: null }, "about_link");
    o.logger.info({ candidates: candidates.size, droppedKnown: report.droppedKnown, droppedSmall: report.droppedSmall }, "youtube candidates");
    // Channels that declare Pakistan first, then those that declare nothing; a channel declaring another country is tried
    // last (eligibility reads the declared country, so it rarely qualifies, yet a diaspora creator is never dropped here).
    const rank = (c: Channel) => (c.country === "PK" ? 0 : c.country === null ? 1 : 2);
    const queue = [...candidates].sort((a, b) => rank(a[1].channel) - rank(b[1].channel) || (b[1].channel.subscribers ?? 0) - (a[1].channel.subscribers ?? 0));
    for (const [h, c] of queue) {
      if ((await used()) + 4 > o.quotaUnits) { report.stoppedFor = "quota"; break; }
      if (report.ingested.length >= (o.maxIngest ?? Infinity)) { report.stoppedFor = "ingest limit"; break; }
      const r = await o.ingest(`https://www.youtube.com/${c.channel.handle ?? h}`);
      report.ingested.push({ handle: h, source: c.source, vertical: c.query?.vertical ?? null, declaredCountry: c.channel.country, subscribers: c.channel.subscribers, ...r });
      o.logger.info(report.ingested.at(-1), "youtube ingest");
    }
  } catch (err) {
    report.stoppedFor = err instanceof Error ? err.message : String(err);
    o.logger.warn({ err: report.stoppedFor }, "youtube expansion stopped");
  }
  return { ...report, unitsUsed: await used() };
}
