import { AUDIENCE_ESTIMATE_LABEL, type AudienceDimension, type AudienceEstimateBody, type AudienceShare } from "@mushin/contracts";
import type { YouTubeCommentSample } from "@mushin/integrations";

/**
 * Method `yt-commenter-country-v1` (spec 2026-10-13-audience-estimate-design §3). Its parameters are starting values to be
 * evaluated by the harness, not proven thresholds; changing one changes the version.
 */
export const METHOD = {
  version: "yt-commenter-country-v1",
  windowDays: 180,
  maxVideos: 12,
  commentsPerVideo: 100,
  /** At most this many new commenters per video, so one viral upload cannot dominate the sample. */
  perVideoCap: 60,
  maxCommenters: 600,
  /** Fewer classified commenters than this is reported as insufficient evidence. */
  minClassified: 30,
  /** A country is listed on its own from this many commenters; smaller ones are grouped as "Other". */
  listMin: 2,
  maxListed: 6,
  /** Shares are shown to the whole percent only from this many classified commenters (otherwise to 5 points). */
  wholePercentFrom: 100,
  /** "moderate" confidence needs every listed share's 95% interval within ±10 points; never "high" before validation. */
  moderateHalfWidth: 0.1,
  estimatedTtlDays: 30,
  insufficientTtlDays: 7,
} as const;
export type MethodParams = { [K in keyof typeof METHOD]: (typeof METHOD)[K] extends number ? number : string };

export const AGE_GENDER_REASON =
  "No permitted public signal. Commenters almost never state their age or gender (0 of 780 in MUSHIN's feasibility sample), and MUSHIN does not infer them from names, photos or writing. YouTube's derived-metrics policy also forbids estimating protected attributes of an audience, such as age.";

const URL_TEXT = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|xyz|link|ly|io|me|pk|shop|site|online|top)\b)/i;
const normalized = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

export type CommenterSelection = {
  commenterIds: string[];
  commentsRead: number;
  uniqueCommenters: number;
  excludedCreator: number;
  excludedLikelySpam: number;
  videosSampled: number;
  videosCommentsOff: number;
};

/**
 * Deduplicated sample of recent commenters: each counted once however often they comment, at most `perVideoCap` new ones
 * per video and `maxCommenters` overall; the creator's own comments are skipped. Likely spam is dropped: any commenter who
 * posted a link, or text copied word for word by three or more different commenters.
 */
export function selectCommenters(sample: YouTubeCommentSample, p: Pick<MethodParams, "perVideoCap" | "maxCommenters"> = METHOD): CommenterSelection {
  const owner = sample.channelId;
  let commentsRead = 0;
  let excludedCreator = 0;
  const authorsOfText = new Map<string, Set<string>>();
  const linkPosters = new Set<string>();
  for (const v of sample.videos) {
    for (const c of v.comments) {
      commentsRead += 1;
      if (c.authorId === owner) continue;
      if (URL_TEXT.test(c.text)) linkPosters.add(c.authorId);
      const t = normalized(c.text);
      if (t.length >= 12) authorsOfText.set(t, (authorsOfText.get(t) ?? new Set<string>()).add(c.authorId));
    }
  }
  const copyPasters = new Set<string>();
  for (const authors of authorsOfText.values()) if (authors.size >= 3) for (const a of authors) copyPasters.add(a);

  const chosen = new Set<string>();
  for (const v of sample.videos) {
    let fromVideo = 0;
    for (const c of v.comments) {
      if (c.authorId === owner) {
        excludedCreator += 1;
        continue;
      }
      if (chosen.has(c.authorId) || fromVideo >= p.perVideoCap || chosen.size >= p.maxCommenters) continue;
      chosen.add(c.authorId);
      fromVideo += 1;
    }
  }
  const spam = [...chosen].filter((a) => linkPosters.has(a) || copyPasters.has(a));
  const kept = [...chosen].filter((a) => !linkPosters.has(a) && !copyPasters.has(a));
  return {
    commenterIds: kept,
    commentsRead,
    uniqueCommenters: chosen.size,
    excludedCreator,
    excludedLikelySpam: spam.length,
    videosSampled: sample.videos.filter((v) => !v.commentsOff).length,
    videosCommentsOff: sample.videos.filter((v) => v.commentsOff).length,
  };
}

/** 95% Wilson score interval of k successes in n. */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Country shares among commenters who state one; unknowns are never assigned a country. */
export function countryDimension(countries: (string | null)[], p: Pick<MethodParams, "minClassified" | "listMin" | "maxListed" | "wholePercentFrom" | "moderateHalfWidth"> = METHOD): AudienceDimension {
  const known = countries.filter((c): c is string => c !== null);
  const n = known.length;
  if (n < p.minClassified) {
    return {
      status: "insufficient",
      classified: n,
      required: p.minClassified,
      reason:
        countries.length === 0
          ? "There are no public comments from other accounts on this creator's recent videos (or comments are turned off)."
          : `Only ${n} of ${countries.length} sampled commenters state a country on their channel; at least ${p.minClassified} are needed for an estimate.`,
    };
  }
  const counts = new Map<string, number>();
  for (const c of known) counts.set(c, (counts.get(c) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const listed = ordered.filter(([, k]) => k >= p.listMin).slice(0, p.maxListed);
  const other = n - listed.reduce((s, [, k]) => s + k, 0);
  const share = (code: string, k: number): AudienceShare => {
    const ci = wilson(k, n);
    return { code, count: k, share: round4(k / n), low: round4(ci.low), high: round4(ci.high) };
  };
  const shares = [...listed.map(([code, k]) => share(code, k)), ...(other > 0 ? [share("OTHER", other)] : [])];
  const widest = Math.max(...shares.map((s) => (s.high - s.low) / 2));
  return {
    status: "estimated",
    confidence: widest <= p.moderateHalfWidth ? "moderate" : "low",
    classified: n,
    shares,
    displayStep: n >= p.wholePercentFrom ? 1 : 5,
  };
}

/** The stored, aggregate-only estimate. `countries` holds one entry per kept commenter (null = no country stated). */
export function buildEstimate(sel: CommenterSelection, countries: (string | null)[], videosConsidered: number, p: MethodParams = METHOD): AudienceEstimateBody {
  const country = countryDimension(countries, p);
  const classifiable = countries.filter((c) => c !== null).length;
  const eligible = countries.length;
  const coverage = eligible === 0 ? 0 : round4(classifiable / eligible);
  const limitations = [
    `Describes ${eligible} recent commenters, not the creator's followers or viewers; no validated method links commenters to the wider audience.`,
    `Only ${Math.round(coverage * 100)}% of sampled commenters state a country; those who do may differ from those who don't.`,
    "A channel's country is chosen by its owner and may be outdated; YouTube does not verify it.",
    "Not yet validated against platform analytics: use as experimental decision support, not as a campaign eligibility filter.",
  ];
  if (sel.videosCommentsOff > 0) limitations.push(`Comments were turned off on ${sel.videosCommentsOff} of the recent videos.`);
  if (sel.excludedLikelySpam > 0) limitations.push(`${sel.excludedLikelySpam} commenters were left out as likely spam (links or copied text).`);
  return {
    methodVersion: p.version,
    provenance: "mushin_estimate",
    label: AUDIENCE_ESTIMATE_LABEL,
    population: "sampled_recent_commenters",
    outcome: country.status === "estimated" ? "estimated" : "insufficient",
    source: `YouTube Data API: public top-level comments on the creator's uploads from the last ${p.windowDays} days, and the country each commenter's channel declares.`,
    sample: {
      windowDays: p.windowDays,
      videosConsidered,
      videosSampled: sel.videosSampled,
      videosCommentsOff: sel.videosCommentsOff,
      commentsRead: sel.commentsRead,
      uniqueCommenters: sel.uniqueCommenters,
      excludedCreator: sel.excludedCreator,
      excludedLikelySpam: sel.excludedLikelySpam,
      classifiable,
      coverage,
    },
    country,
    age: { status: "not_estimable", reason: AGE_GENDER_REASON },
    gender: { status: "not_estimable", reason: AGE_GENDER_REASON },
    limitations,
  };
}
