/**
 * Colour levels for the MUSHIN IQ (match score) and the engagement rate (owner, 16 Nov: "different colour by level").
 * Each level also has a word, so the colour is never the only signal.
 * IQ bands are the ones the results table already used. Engagement bands are per follower, in percent: under 0.5% is
 * low, 0.5–1% fair, 1–3% good, 3% and above high.
 */
export type Level = { word: "High" | "Good" | "Fair" | "Low"; chip: string; text: string; dot: string };

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

export function erLevel(rate: number): Level {
  if (rate >= 3) return HIGH;
  if (rate >= 1) return GOOD;
  if (rate >= 0.5) return FAIR;
  return LOW;
}
