/**
 * Colour levels for the MUSHIN IQ (match score) and the engagement rate (owner, 16 Nov: "different colour by level").
 * Each level also has a word, so the colour is never the only signal.
 * IQ bands are the ones the results table already used. Engagement (per follower, %) is calibrated per platform from the
 * catalogue's own distribution (owner, 25 Nov), so a normal 0.3% YouTube rate never reads as poor:
 *   Instagram ≥ 2.5 High, ≥ 0.5 Typical; YouTube ≥ 0.8 / ≥ 0.15; TikTok ≥ 1.0 / ≥ 0.2; otherwise Low.
 * TikTok engagement per view (likes + comments + shares over plays) uses ≥ 4.0 High, ≥ 1.5 Typical.
 */
export type Level = { word: "High" | "Good" | "Fair" | "Typical" | "Low"; chip: string; text: string; dot: string };

const HIGH: Level = { word: "High", chip: "bg-emerald-100 text-emerald-800", text: "text-emerald-700", dot: "fill-emerald-400 text-emerald-400" };
const GOOD: Level = { word: "Good", chip: "bg-cyan-100 text-cyan-800", text: "text-cyan-700", dot: "fill-[#06B6D4] text-[#06B6D4]" };
const FAIR: Level = { word: "Fair", chip: "bg-amber-100 text-amber-800", text: "text-amber-700", dot: "fill-amber-400 text-amber-400" };
const LOW: Level = { word: "Low", chip: "bg-rose-100 text-rose-700", text: "text-rose-600", dot: "fill-rose-400 text-rose-400" };

export function iqLevel(score: number): Level {
  if (score >= 90) return HIGH;
  if (score >= 75) return GOOD;
  if (score >= 60) return FAIR;
  return LOW;
}

const TYPICAL: Level = { word: "Typical", chip: "bg-cyan-100 text-cyan-800", text: "text-cyan-700", dot: "fill-[#06B6D4] text-[#06B6D4]" };
export type ErPlatform = "instagram" | "tiktok" | "youtube";
const ER_BANDS: Record<ErPlatform, [high: number, typical: number]> = { instagram: [2.5, 0.5], youtube: [0.8, 0.15], tiktok: [1.0, 0.2] };

/** Engagement level per follower; without a platform the Instagram bands apply (the strictest). */
export function erLevel(rate: number, platform: ErPlatform = "instagram"): Level {
  const [high, typical] = ER_BANDS[platform];
  if (rate >= high) return HIGH;
  if (rate >= typical) return TYPICAL;
  return LOW;
}

/** TikTok engagement per view (owner, 25 Nov). */
export function perViewLevel(rate: number): Level {
  if (rate >= 4) return HIGH;
  if (rate >= 1.5) return TYPICAL;
  return LOW;
}
