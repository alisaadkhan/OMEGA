import type { Creator } from "./CreatorProfilePanel";
import type { ContactTrust, Freshness, SourceKind } from "./states";

/**
 * Shared creator-intelligence model.
 *
 * The prototype has no backend, so instead of fabricating numbers per screen we
 * derive a *consistent* intelligence record for each creator from its stable
 * fields (handle hash + score + fake %). This keeps the spec's freshness /
 * source / contact-trust / recommendation vocabulary honest and identical
 * everywhere a creator appears. When a real backend lands, only this file changes.
 */

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pick<T>(seed: number, arr: T[]): T {
  return arr[seed % arr.length];
}

export type FieldFreshness = {
  value: Freshness;
  updated: string;
};

export type AudienceRow = {
  label: string;
  value: number;
  source: SourceKind;
  confidence?: "low" | "medium" | "high";
};

export type ContactChannel = {
  kind: "email" | "phone";
  value: string;
  masked: string;
  trust: ContactTrust;
  source: string;
  firstSeen: string;
  lastSeen: string;
  lastVerified: string | null;
};

export type Recommendation = {
  label: "Best match" | "Strong match" | "Possible match" | "Needs review";
  fit: string;
  reason: string;
  pros: string[];
  watchOuts: string[];
  confidence: "low" | "medium" | "high";
};

export type CreatorIntel = {
  followersFreshness: FieldFreshness;
  engagementFreshness: FieldFreshness;
  audienceFreshness: FieldFreshness;
  lastUpdated: string;
  age: AudienceRow[];
  gender: { female: number; male: number; source: SourceKind };
  cities: AudienceRow[];
  contacts: ContactChannel[];
  recommendation: Recommendation;
};

const AGES = ["18–24", "25–34", "35–44", "45+"];
const UPDATED = ["2 hours ago", "yesterday", "4 days ago", "2 weeks ago", "1 month ago"];

function freshnessFrom(seed: number): FieldFreshness {
  const buckets: Freshness[] = ["current", "current", "aging", "stale"];
  const value = pick(seed, buckets);
  const updated =
    value === "current" ? pick(seed, UPDATED.slice(0, 2)) :
    value === "aging" ? pick(seed, UPDATED.slice(2, 4)) :
    UPDATED[4];
  return { value, updated };
}

export function getCreatorIntel(c: Creator): CreatorIntel {
  const seed = hash(c.handle);
  const followersFreshness = freshnessFrom(seed);
  const engagementFreshness = freshnessFrom(seed >> 3);
  const audienceFreshness = freshnessFrom(seed >> 6);

  // Age distribution — deterministic, tagged as estimated public-signal data.
  const base = [22, 40, 22, 16];
  const shift = seed % 10;
  const age: AudienceRow[] = AGES.map((label, i) => ({
    label,
    value: Math.max(4, base[i] + (i === 1 ? shift - 4 : i === 0 ? 4 - shift : 0)),
    source: "estimated",
    confidence: c.authenticity >= 90 ? "high" : c.authenticity >= 75 ? "medium" : "low",
  }));

  const female = 45 + (seed % 25);
  const cities: AudienceRow[] = [
    { label: "Karachi", value: 30 + (seed % 12), source: "public" },
    { label: "Lahore", value: 22 + ((seed >> 2) % 10), source: "public" },
    { label: "Islamabad", value: 12 + ((seed >> 4) % 8), source: "public" },
  ];

  // Contact channels with honest, mixed trust states.
  const emailTrust: ContactTrust = pick(seed, [
    "verified",
    "contactable",
    "unverified",
    "stale",
  ]) as ContactTrust;
  const phoneTrust: ContactTrust = pick(seed >> 5, [
    "contactable",
    "unverified",
    "stale",
    "invalid",
  ]) as ContactTrust;

  const emailDomain = c.platform === "youtube" ? "gmail.com" : `${c.handle}.pk`;
  const contacts: ContactChannel[] = [
    {
      kind: "email",
      value: `${c.handle}@${emailDomain}`,
      masked: `${c.handle.slice(0, 2)}•••@${emailDomain}`,
      trust: emailTrust,
      source: "Public creator bio",
      firstSeen: "Mar 2026",
      lastSeen: pick(seed, UPDATED),
      lastVerified: emailTrust === "verified" ? "1 week ago" : null,
    },
    {
      kind: "phone",
      value: `+92 3${(seed % 90) + 10} ${(seed % 900) + 100} ${(seed % 9000) + 1000}`,
      masked: "+92 3•• ••• ••••",
      trust: phoneTrust,
      source: "Agency roster",
      firstSeen: "Jan 2026",
      lastSeen: pick(seed >> 3, UPDATED),
      lastVerified: null,
    },
  ];

  // Recommendation — labelled by score, reasons cite real factors.
  const label: Recommendation["label"] =
    c.score >= 90 ? "Best match" :
    c.score >= 82 ? "Strong match" :
    c.score >= 70 ? "Possible match" : "Needs review";

  const pros: string[] = [];
  if (c.authenticity >= 85) pros.push("High audience authenticity");
  if (c.engagement >= 5) pros.push(`Strong engagement rate (${c.engagement.toFixed(1)}%)`);
  if (female >= 55) pros.push("Female-leaning audience — good for beauty/fashion");
  if (c.followersNum >= 100_000) pros.push("Broad reach in target cities");
  if (pros.length === 0) pros.push("Niche relevance to campaign category");

  const watchOuts: string[] = [];
  if (c.fake > 8) watchOuts.push(`Elevated flagged interactions (${c.fake}%)`);
  if (audienceFreshness.value !== "current") watchOuts.push("Audience data is not recent — refresh before deciding");
  if (emailTrust === "stale" || emailTrust === "unverified") watchOuts.push("Contact is not yet verified through outreach");
  if (watchOuts.length === 0) watchOuts.push("No major concerns from available data");

  return {
    followersFreshness,
    engagementFreshness,
    audienceFreshness,
    lastUpdated: followersFreshness.updated,
    age,
    gender: { female, male: 100 - female, source: "estimated" },
    cities,
    contacts,
    recommendation: {
      label,
      fit: `${label} for a ${c.niche.toLowerCase()} campaign targeting ${female >= 55 ? "women" : "a mixed audience"} in ${c.city}.`,
      reason: `Ranked on niche fit (${c.niche}), engagement rate (${c.engagement.toFixed(1)}%), audience authenticity (${c.authenticity}%) and city match (${c.city}).`,
      pros,
      watchOuts,
      confidence: c.authenticity >= 88 ? "high" : c.authenticity >= 75 ? "medium" : "low",
    },
  };
}

/** One short sentence explaining why a creator matches a query (§7.4 fit). */
export function fitSentence(c: Creator, query?: string): string {
  const q = (query ?? "").toLowerCase();
  const bits: string[] = [];
  if (q && c.niche && q.includes(c.niche.toLowerCase().split(" ")[0])) bits.push(`${c.niche} focus`);
  if (q && q.includes(c.city.toLowerCase())) bits.push(`based in ${c.city}`);
  if (c.engagement >= 5) bits.push(`${c.engagement.toFixed(1)}% engagement`);
  if (c.authenticity >= 88) bits.push("clean audience");
  if (bits.length === 0) bits.push(`${c.niche} creator in ${c.city}`);
  return bits.slice(0, 3).join(", ").replace(/^./, (m) => m.toUpperCase()) + ".";
}
