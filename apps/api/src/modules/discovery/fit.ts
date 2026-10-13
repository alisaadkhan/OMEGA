import type { LiveSearch } from "@mushin/contracts";
import { meaningfulTopics, norm, topicMatch } from "./topic-evidence";
import type { StandardProfile } from "../creators/index";
import type { Kept } from "./live/relevance";

export type CampaignFit = {
  version: "mushin-live-fit-v1";
  score: number | null;
  confidence: number;
  eligible: boolean;
  gate: string | null;
  topicScore: number | null;
  sampleSize: number;
  sourceUrl: string;
  fetchedAt: string;
  evidence: string[];
};

const DAY = 86_400_000;
const PERSON = /\b(creator|influencer|blogger|vlogger|artist|makeup artist|photographer|comedian|musician|singer|chef|writer|author|educator|coach)\b/i;
const BUSINESS = /\b(shop|store|brand|company|restaurant|agency|school|university|news|magazine|mall|boutique|clinic|salon|order|delivery|wholesale)\b/i;
const ROMAN_URDU_CREATOR = /\b(?:main|mein|meri|mujhe)\b.{0,40}\b(?:content|video|vlog|blog|makeup|beauty|fashion|creator|banat[ai]|kart[ai])\b|\b(?:content|video|vlog|blog|makeup|beauty|fashion)\b.{0,30}\b(?:banat[ai]|kart[ai](?:\s+(?:hun|hoon))?)\b/i;
const LATIN_WORD = /[a-z]+/gi;
const ROMAN_URDU_MARKERS = new Set("main mein mera meri mujhe hum ham aap ap tum tera teri hai hain tha thi thay hoon hun houn karta karti karte kiya kiye banata banati banate aaj kal ka ki ke ko se mein par nahi nahin raha rahi rahe".split(" "));
const ROMAN_URDU_GRAMMAR = new Set("main mein mera meri mujhe hum ham aap ap tum tera teri hai hain tha thi thay hoon hun houn karta karti karte kiya kiye banata banati banate ka ki ke ko se nahi nahin raha rahi rahe".split(" "));
const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  urdu: /[\u0600-\u06ff]/u,
  english: /\b[a-z]{2,}\b/i,
  punjabi: /[\u0a00-\u0a7f]/u,
  pashto: /[\u0600-\u06ff]/u,
};

function isRomanUrdu(text: string): boolean {
  const words = (text.match(LATIN_WORD) ?? []).map((word) => word.toLowerCase());
  const markers = new Set(words.filter((word) => ROMAN_URDU_MARKERS.has(word)));
  return markers.size >= 2 && [...markers].some((word) => ROMAN_URDU_GRAMMAR.has(word));
}

function hasLanguage(text: string, language: string): boolean {
  return language === "roman urdu" ? isRomanUrdu(text) : Boolean(LANGUAGE_PATTERNS[language]?.test(text));
}

/** Conservative campaign gate. Every score component is derived from profile or sampled-post evidence. */
export function evaluateCampaignFit(search: LiveSearch, candidate: Kept, profile: StandardProfile, isMinor: boolean, now: Date, fetchedAt: Date = now): CampaignFit {
  const evidence: string[] = [];
  // Use profile-owned identity fields and the result title; search snippets may describe a linked post or ad.
  const accountText = `${candidate.title} ${profile.displayName} ${profile.bio}`;
  const hasPersonCue = PERSON.test(accountText) || ROMAN_URDU_CREATOR.test(accountText);
  const hasBusinessCue = BUSINESS.test(accountText);
  const individual = hasPersonCue === hasBusinessCue ? null : hasPersonCue ? 1 : 0;
  const recent = profile.recentPosts.filter((p) => now.getTime() - p.postedAt.getTime() >= 0 && now.getTime() - p.postedAt.getTime() <= 90 * DAY);
  const latest = profile.recentPosts[0];
  const daysSinceLast = latest ? Math.floor((now.getTime() - latest.postedAt.getTime()) / DAY) : null;
  const followerRangeRequested = search.filters.followersMin !== undefined || search.filters.followersMax !== undefined;
  if (followerRangeRequested && profile.followers === null) evidence.push("Follower count unknown from the source profile");
  const gate = isMinor ? "minor_or_unclear" : individual === null ? "individual_creator_unverified" : individual < 0.3 ? "business_or_non_creator" : daysSinceLast === null || daysSinceLast > 90 ? "inactive_or_unverified" : search.filters.platform && search.filters.platform !== profile.platform ? "platform_mismatch" : followerRangeRequested && profile.followers === null ? "follower_count_unavailable" : null;
  if (individual !== null) evidence.push(`Individual-creator lexical signal from public title/bio (${individual === 1 ? ROMAN_URDU_CREATOR.test(accountText) && !PERSON.test(accountText) ? "Roman Urdu first-person creator cue" : "creator cue" : "business cue"})`);
  evidence.push(`${recent.length} sampled public posts dated within 90 days`);
  if (daysSinceLast !== null) evidence.push(`Most recent sampled post: ${daysSinceLast} days ago`);

  const topics = meaningfulTopics(search);
  const topicShares = topics.map((topic) => recent.length ? recent.filter((post) => topicMatch(`${post.caption} ${post.hashtags.join(" ")}`, topic)).length / recent.length : null);
  const topicShare = recent.length && topics.length
    ? topicShares.reduce<number>((sum, share) => sum + Math.min(1, (share ?? 0) / 0.25), 0) / topics.length
    : null;
  if (topicShare !== null) topics.forEach((topic, index) => evidence.push(`${topic}: ${Math.round((topicShares[index] ?? 0) * 100)}% of ${recent.length} sampled posts`));
  const gateWithTopic = gate ?? (topicShare === null ? "topic_evidence_unavailable" : topicShare < 0.2 ? "off_topic" : null);
  if (gateWithTopic) return { version: "mushin-live-fit-v1", score: 0, confidence: 0, eligible: false, gate: gateWithTopic, topicScore: topicShare, sampleSize: recent.length, sourceUrl: candidate.canonicalUrl, fetchedAt: fetchedAt.toISOString(), evidence };

  const components: { score: number; weight: number; evidenced: boolean }[] = [];
  const requestedCity = search.filters.creatorCity;
  const requestedCountry = search.filters.creatorCountry;
  if (requestedCity || requestedCountry) {
    const declared = `${profile.bio} ${profile.country ?? ""}`;
    const geo = requestedCity ? (norm(declared).includes(norm(requestedCity)) ? 1 : profile.country && requestedCountry === profile.country ? 0.6 : 0.5) : profile.country === requestedCountry ? 1 : profile.country ? 0 : 0.5;
    components.push({ score: geo, weight: 0.2, evidenced: geo !== 0.5 });
    evidence.push(geo === 0.5 ? "Location unknown from public profile evidence" : `Location signal matched public profile evidence (${requestedCity ?? requestedCountry})`);
  }
  const language = /\broman\s+urdu\b/i.test(search.text)
    ? "roman urdu"
    : Object.keys(LANGUAGE_PATTERNS).find((key) => new RegExp(`\\b${key}\\b`, "i").test(search.text));
  if (language) {
    const total = recent.filter((p) => p.caption.trim()).length;
    const share = total ? recent.filter((p) => hasLanguage(p.caption, language)).length / total : null;
    components.push({ score: share ?? 0.5, weight: 0.1, evidenced: share !== null });
    evidence.push(share === null ? `No caption sample to assess ${language}` : `${Math.round(share * 100)}% of sampled captions contain ${language} script/language signal (${total} captions)`);
  }
  if (search.filters.followersMin !== undefined || search.filters.followersMax !== undefined) {
    const f = profile.followers;
    const lo = search.filters.followersMin ?? 0;
    const hi = search.filters.followersMax ?? Number.MAX_SAFE_INTEGER;
    let size = 0.5;
    if (f !== null) {
      size = 1;
      if (f < lo) size = lo > 0 && f > 0 ? Math.max(0, 1 - Math.abs(Math.log10(f / lo))) : 0;
      if (f > hi) size = hi > 0 ? Math.max(0, 1 - Math.abs(Math.log10(f / hi))) : 0;
    }
    components.push({ score: size, weight: 0.1, evidenced: profile.followers !== null });
    if (profile.followers !== null) evidence.push(`Follower count ${f} checked against requested range`);
  }
  components.push({ score: individual ?? 0.5, weight: 0.1, evidenced: individual !== null });
  const activity = 0.5 * Math.min(1, recent.length / 12) + 0.5 * Math.max(0, Math.min(1, ((90 - (daysSinceLast ?? 90)) / 76)));
  components.push({ score: activity, weight: 0.1, evidenced: recent.length > 0 });
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const context = components.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight;
  const confidence = components.reduce((sum, c) => sum + (c.evidenced ? c.weight : 0), 0) / totalWeight;
  const score = Math.round(100 * (topicShare ?? 0) * (0.4 + 0.6 * context));
  return { version: "mushin-live-fit-v1", score, confidence: Math.round(confidence * 100) / 100, eligible: score >= 50, gate: score >= 50 ? null : "below_min_fit", topicScore: topicShare, sampleSize: recent.length, sourceUrl: candidate.canonicalUrl, fetchedAt: fetchedAt.toISOString(), evidence };
}
