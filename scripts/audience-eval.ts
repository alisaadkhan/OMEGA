/**
 * Repeatable evaluation of the audience-estimate method (spec 2026-10-13-audience-estimate-design §6).
 *
 *   node --env-file-if-exists=.env --import tsx scripts/audience-eval.ts --panel panel.json --out report.json
 *        [--split test|dev|all] [--orders time,relevance] [--truth truth.json]
 *
 * panel.json: [{ "handle": "@name", "subscribers": 120000, "split": "dev" | "test" }]
 * truth.json (optional, consented): { "@name": { "source": "YouTube Analytics geography (views), 28 days", "countries": { "PK": 0.81, "AE": 0.06 } } }
 *
 * Uses the YouTube Data API (quota only, $0). Prints and writes aggregates only: no commenter ids, names or texts.
 * Only run it where the operator may derive metrics from YouTube API data (see the spec's policy section).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createLogger } from "@mushin/core";
import { createYouTubeAudienceSource, MemoryProviderCallSink, type YouTubeCommentSample } from "@mushin/integrations";
import { buildEstimate, countryDimension, METHOD, selectCommenters } from "../apps/api/src/modules/audience/index";

type PanelEntry = { handle: string; subscribers: number; split: "dev" | "test" };
type Truth = Record<string, { source: string; countries: Record<string, number> }>;
type Row = {
  handle: string; band: string; split: string; order: string; outcome: string; failed: string | null;
  sampled: number; classified: number; coverage: number; topCountry: string | null; topShare: number | null; topHalfWidth: number | null;
  splitHalfDelta: number | null; quotaUnits: number; seconds: number;
  truth?: { topShareError: number | null; tvd: number; topMatch: boolean } | null;
};

const { values: args } = parseArgs({ options: { panel: { type: "string" }, out: { type: "string" }, split: { type: "string", default: "all" }, orders: { type: "string", default: "time" }, truth: { type: "string" } } });
if (!args.panel || !args.out) throw new Error("--panel and --out are required");
const panel = (JSON.parse(readFileSync(args.panel, "utf8")) as PanelEntry[]).filter((p) => args.split === "all" || p.split === args.split);
const truth: Truth = args.truth ? (JSON.parse(readFileSync(args.truth, "utf8")) as Truth) : {};
const orders = (args.orders ?? "time").split(",").map((o) => o.trim()) as ("time" | "relevance")[];
const source = createYouTubeAudienceSource({ apiKey: process.env.YOUTUBE_API_KEY ?? null, sink: new MemoryProviderCallSink(), logger: createLogger({ level: "silent" }) });

const band = (n: number) => (n < 10_000 ? "<10K" : n < 100_000 ? "10K-100K" : n < 1_000_000 ? "100K-1M" : "1M+");
const half = (s: YouTubeCommentSample, parity: 0 | 1): YouTubeCommentSample => ({ ...s, videos: s.videos.filter((_, i) => i % 2 === parity) });
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

/** Share of `code` among classified commenters of a sub-sample, or null below 15 classified. */
function shareOf(s: YouTubeCommentSample, countries: Map<string, string | null>, code: string): number | null {
  const known = selectCommenters(s).commenterIds.map((id) => countries.get(id) ?? null).filter((c): c is string => c !== null);
  return known.length < 15 ? null : known.filter((c) => c === code).length / known.length;
}

function compareTruth(dist: Map<string, number>, t: Record<string, number>, top: string | null) {
  const codes = new Set([...dist.keys(), ...Object.keys(t)]);
  let tvd = 0;
  for (const c of codes) tvd += Math.abs((dist.get(c) ?? 0) - (t[c] ?? 0));
  const trueTop = Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { topShareError: top ? r3(Math.abs((dist.get(top) ?? 0) - (t[top] ?? 0))) : null, tvd: r3(tvd / 2) ?? 0, topMatch: top !== null && top === trueTop };
}

const rows: Row[] = [];
for (const p of panel) {
  for (const order of orders) {
    const t0 = Date.now();
    const base = { handle: p.handle, band: band(p.subscribers), split: p.split, order };
    try {
      const sample = await source.sampleComments({ handle: p.handle, maxVideos: METHOD.maxVideos, windowDays: METHOD.windowDays, commentsPerVideo: METHOD.commentsPerVideo, now: new Date(), order });
      const sel = selectCommenters(sample);
      const looked = await source.channelCountries({ channelIds: sel.commenterIds });
      const countries = sel.commenterIds.map((id) => looked.countries.get(id) ?? null);
      const est = buildEstimate(sel, countries, sample.videosConsidered);
      const dim = countryDimension(countries);
      const top = dim.status === "estimated" ? (dim.shares.find((s) => s.code !== "OTHER") ?? null) : null;
      const a = top ? shareOf(half(sample, 0), looked.countries, top.code) : null;
      const b = top ? shareOf(half(sample, 1), looked.countries, top.code) : null;
      const known = countries.filter((c): c is string => c !== null);
      const dist = new Map<string, number>();
      for (const c of known) dist.set(c, (dist.get(c) ?? 0) + 1 / known.length);
      const t = truth[p.handle];
      rows.push({
        ...base, outcome: est.outcome, failed: null, sampled: sel.commenterIds.length, classified: est.sample.classifiable, coverage: est.sample.coverage,
        topCountry: top?.code ?? null, topShare: r3(top?.share ?? null), topHalfWidth: top ? r3((top.high - top.low) / 2) : null,
        splitHalfDelta: a !== null && b !== null ? r3(Math.abs(a - b)) : null,
        quotaUnits: sample.quotaUnits + looked.quotaUnits, seconds: Math.round((Date.now() - t0) / 100) / 10,
        truth: t && dim.status === "estimated" ? compareTruth(dist, t.countries, top?.code ?? null) : null,
      });
    } catch (err) {
      const cause = (err as { cause?: { reason?: string } }).cause;
      rows.push({ ...base, outcome: "failed", failed: cause?.reason ?? (err instanceof Error ? err.message.slice(0, 80) : "error"), sampled: 0, classified: 0, coverage: 0, topCountry: null, topShare: null, topHalfWidth: null, splitHalfDelta: null, quotaUnits: 0, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    }
    const r = rows[rows.length - 1];
    console.log(JSON.stringify({ band: r?.band, split: r?.split, order: r?.order, outcome: r?.outcome, sampled: r?.sampled, classified: r?.classified, coverage: r?.coverage, top: r?.topCountry, share: r?.topShare, halfDelta: r?.splitHalfDelta, units: r?.quotaUnits, s: r?.seconds }));
  }
}

const groups = new Map<string, Row[]>();
for (const r of rows) for (const key of [`${r.order} | all`, `${r.order} | ${r.band}`]) groups.set(key, [...(groups.get(key) ?? []), r]);
const summary = [...groups.entries()].map(([key, rs]) => {
  const est = rs.filter((r) => r.outcome === "estimated");
  const withTruth = rs.filter((r) => r.truth);
  return {
    group: key,
    channels: rs.length,
    estimated: est.length,
    insufficient: rs.filter((r) => r.outcome === "insufficient").length,
    failed: rs.filter((r) => r.outcome === "failed").length,
    medianSampled: median(rs.filter((r) => !r.failed).map((r) => r.sampled)),
    medianClassified: median(rs.filter((r) => !r.failed).map((r) => r.classified)),
    medianCoverage: r3(median(rs.filter((r) => r.sampled > 0).map((r) => r.coverage))),
    medianTopHalfWidth: r3(median(est.map((r) => r.topHalfWidth ?? 0))),
    medianSplitHalfDelta: r3(median(est.flatMap((r) => (r.splitHalfDelta === null ? [] : [r.splitHalfDelta])))),
    medianSeconds: median(rs.map((r) => r.seconds)),
    totalQuotaUnits: rs.reduce((s, r) => s + r.quotaUnits, 0),
    truth: withTruth.length === 0 ? "no ground truth: accuracy not measured" : {
      creators: withTruth.length,
      topShareMAE: r3(mean(withTruth.map((r) => r.truth?.topShareError ?? 0))),
      medianTVD: r3(median(withTruth.map((r) => r.truth?.tvd ?? 0))),
      topCountryCorrect: r3(withTruth.filter((r) => r.truth?.topMatch).length / withTruth.length),
    },
  };
});
writeFileSync(args.out, JSON.stringify({ method: METHOD, ranAt: new Date().toISOString(), split: args.split, orders, rows, summary }, null, 1));
console.table(summary.map(({ truth: t, ...rest }) => ({ ...rest, truth: typeof t === "string" ? "none" : `${t.creators} creators` })));
