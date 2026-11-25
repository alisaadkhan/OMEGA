/**
 * Engagement Score 1.0–10.0 (owner, 25 Nov): the per-follower engagement rate made comparable across platforms, so a
 * normal YouTube 0.15% and a normal Instagram 0.55% both read 5.0. Piecewise linear between anchors set from the
 * qualified Pakistani catalogue (low 10% / median / top 10% per platform). The raw ER % and typical views stay the
 * measured facts; this score only compares them. Null when the rate is unknown (fewer than 3 usable posts).
 */
export type ScorePlatform = "instagram" | "youtube" | "tiktok";

/** [rate %, score] anchors, ascending. Bands: <low 1.0–2.4, low–mid 2.5–4.4, mid 4.5–6.9, strong 7.0–8.9, top 9.0–10. */
const ANCHORS: Record<ScorePlatform, [number, number][]> = {
  instagram: [[0, 1], [0.1, 2.5], [0.3, 4.5], [0.55, 5], [1, 7], [3, 9], [6, 10]],
  youtube: [[0, 1], [0.02, 2.5], [0.08, 4.5], [0.15, 5], [0.4, 7], [1.15, 9], [2.5, 10]],
  tiktok: [[0, 1], [0.09, 2.5], [0.2, 4.5], [0.25, 5], [0.6, 7], [2.5, 9], [5, 10]],
};

export function engagementScore(ratePct: number | null | undefined, platform: ScorePlatform): number | null {
  if (ratePct === null || ratePct === undefined || !Number.isFinite(ratePct) || ratePct < 0) return null;
  const a = ANCHORS[platform];
  let score = 10;
  for (let i = 1; i < a.length; i++) {
    const [r1, s1] = a[i] as [number, number];
    if (ratePct < r1) {
      const [r0, s0] = a[i - 1] as [number, number];
      score = s0 + ((ratePct - r0) / (r1 - r0)) * (s1 - s0);
      break;
    }
  }
  return Math.round(Math.min(10, Math.max(1, score)) * 10) / 10;
}

export type ScoreTier = "top" | "strong" | "typical" | "low" | "unknown";
export const SCORE_TIER_LABEL: Record<ScoreTier, string> = { top: "Top 10%", strong: "Strong", typical: "Typical", low: "Low", unknown: "Not enough data" };

export function scoreTier(score: number | null): ScoreTier {
  if (score === null) return "unknown";
  if (score >= 9) return "top";
  if (score >= 7) return "strong";
  if (score >= 4.5) return "typical";
  return "low";
}
