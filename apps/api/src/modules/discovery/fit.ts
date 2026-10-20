import type { LiveSearch } from "@mushin/contracts";
import { anyTermCounts, KNOWN_CITIES, meaningfulTopics, norm, topicMatch, usesTermsV2 } from "./topic-evidence";
import type { StandardProfile } from "../creators/index";
import type { Kept } from "./live/relevance";

export const FIT_VERSION = "mushin-live-fit-v2";

export type CampaignFit = {
  version: typeof FIT_VERSION;
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
// Measured 2026-10-13 (live evaluation, 149 extracted profiles): the earlier either/or cue test rejected about half of
// genuine individual creators, e.g. "Lahore Food Blogger … Restaurant Reviews" or "Owner @junoonrestaurant".
const PERSON = /\b(?:creator|influencer|blogger|vlogger|vlogs?|youtuber|tiktoker|artist|makeup artist|mua|photographer|videographer|comedian|musician|singer|rapper|chef|writer|author|educator|teacher|tutor|coach|trainer|nutritionist|dietitian|stylist|reviewer|critic|connoisseur|foodie|traveller|traveler|storyteller|host|anchor|presenter|journalist|actor|actress|dancer|gamer|streamer|biker)s?\b|contentcreator|digitalcreator/i;
const BUSINESS = /\b(?:shop|store|brand|company|restaurant|cafe|agency|school|academy|institute|university|news|magazine|media|mall|boutique|clinic|salon|order|orders|delivery|shipping|wholesale|rental|pvt|ltd|llc|tours|marketplace|platform|outlet|branches)\b/i;
/** In an account name (not a bio, where creators describe their audience) these name a group or page, not a person. */
const GROUP_NAME = /\b(?:community|group|network|club)\b/i;
/** Business words that describe a creator's subject or audience rather than what the account is. */
const TOPIC_PHRASES = /\b(?:brand|business|restaurant|cafe|food|shop|store|product)s?\s+(?:collab\w*|partnerships?|reviews?|reviewer|hopping|hunting|deals|inquir\w*|enquir\w*|quer\w*|promotions?)\b|\bfor\s+(?:brand|business)\b/gi;
// Self-promotion is a creator's voice too (TikTok bios are often only "Follow me on YT" or "Follow for more comedy").
const FIRST_PERSON = /\b(?:i am|i'm|my name is|mera naam|welcome to my|join me|i (?:make|share|create|post|review|cook|travel|help|love|explore|talk)|follow me on (?:yt|youtube|insta|instagram|ig|tiktok|fb|facebook|snap(?:chat)?)|follow (?:me )?for more)\b/i;
// Measured 2026-10-13 (98 unverified YouTube channels): channels describe their videos ("we do tech reviews", "on this
// channel you will find videos") and write in Urdu script ("میرا نام" = my name, "میرے چینل" = my channel).
const CHANNEL_VOICE = /\b(?:we|i)\s+(?:make|create|do|upload|share|post|review|bring(?: you)?)\b[^.\n]{0,40}\b(?:videos?|content|reviews?|vlogs?|tutorials?|recipes?|unboxings?|shorts)\b|\b(?:this|my|our)\s+(?:youtube\s+)?channel\b[^.\n]{0,60}\b(?:videos?|vlogs?|recipes?|reviews?|tutorials?)\b/i;
const URDU_FIRST_PERSON = /میرا نام|میرے (?:یوٹیوب )?چینل|ہمارے چینل|میں آپ کو|میری ویڈیو/u;
const COLLAB = /\b(?:collab(?:s|oration|orations)?|paid partnerships?|paid promotions?|sponsorships?|business (?:inquiries|enquiries|queries)|work queries|managed by)\b/i;
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

// The category the owner declared on the platform is stronger evidence than bio wording (2026-10-13: 30 "Digital
// creator", 9 "Blogger" against "Clothing (Brand)", "Travel agency", "Magazine"…). Business categories are checked
// first; anything else ("Photography Videography", "Finance", "Design & fashion") falls back to the bio rules.
const BUSINESS_CATEGORY = /\b(?:brand|store|shop|shopping|company|agency|restaurant|cafe|bakery|hotel|clinic|salon|services?|retail|magazine|media|news|real estate|hospitality|school|college|university|product|clothing|boutique|organization|non-profit|ngo|business|jewelry|cosmetics)\b/i;
const CREATOR_CATEGORY = /\b(?:digital creator|creator|blogger|personal blog|video creator|reel creator|gamer|public figure|artist|musician|actor|actress|comedian|photographer|videographer|fitness trainer|personal trainer|coach|food critic|chef|journalist|writer|author|makeup artist|model|athlete|entrepreneur|just for fun|influencer|stylist|teacher|youtuber)\b/i;

/** Mentions, links and hashtags name other accounts or topics; they never say what this account is. */
const withoutRefs = (text: string): string => text.replace(/https?:\/\/\S+|[@#][\p{L}\p{N}._]+/gu, " ");
const ownText = (text: string): string => withoutRefs(text).replace(TOPIC_PHRASES, " ");

/**
 * 1 = individual creator, 0 = business or non-creator account, null = unverified. Deterministic: a business word in the
 * account's own name outweighs everything except a first-person statement; first-person and collaboration cues only
 * break ties between conflicting or missing cues.
 */
export function individualSignal(o: { name: string; title: string; bio: string; category?: string | null; seller?: boolean }): { value: 1 | 0 | null; cue: string } {
  const text = `${o.title} ${o.name} ${o.bio}`;
  const own = ownText(text);
  const roman = ROMAN_URDU_CREATOR.test(text);
  const person = PERSON.test(text) || roman;
  const business = BUSINESS.test(own) || o.seller === true;
  const firstPerson = FIRST_PERSON.test(own) || ROMAN_URDU_CREATOR.test(own) || CHANNEL_VOICE.test(own) || URDU_FIRST_PERSON.test(own);
  const businessName = (BUSINESS.test(ownText(o.name)) || GROUP_NAME.test(ownText(o.name))) && !firstPerson;
  if (o.category) {
    if (BUSINESS_CATEGORY.test(o.category)) return { value: 0, cue: `platform category: ${o.category}` };
    if (CREATOR_CATEGORY.test(o.category) && !businessName && o.seller !== true) return { value: 1, cue: `platform category: ${o.category}` };
  }
  if (businessName) return { value: 0, cue: "business name" };
  if (person && !business) return { value: 1, cue: roman && !PERSON.test(text) ? "Roman Urdu first-person creator cue" : "creator cue" };
  if (!person && business) return { value: 0, cue: "business cue" };
  if (firstPerson) return { value: 1, cue: "first-person creator cue" };
  if (!business && COLLAB.test(withoutRefs(text))) return { value: 1, cue: "creator collaboration cue" };
  return { value: null, cue: person ? "conflicting creator and business cues" : "no creator or business cue" };
}

/** Conservative campaign gate. Every score component is derived from profile or sampled-post evidence. */
export function evaluateCampaignFit(search: LiveSearch, candidate: Kept, profile: StandardProfile, isMinor: boolean, now: Date, fetchedAt: Date = now): CampaignFit {
  const evidence: string[] = [];
  // Use profile-owned identity fields and the result title; search snippets may describe a linked post or ad.
  const signal = individualSignal({ name: profile.displayName, title: candidate.title, bio: profile.bio, category: profile.accountCategory ?? null, ...(profile.seller ? { seller: true } : {}) });
  const individual = signal.value;
  const recent = profile.recentPosts.filter((p) => now.getTime() - p.postedAt.getTime() >= 0 && now.getTime() - p.postedAt.getTime() <= 90 * DAY);
  const latest = profile.recentPosts[0];
  const daysSinceLast = latest ? Math.floor((now.getTime() - latest.postedAt.getTime()) / DAY) : null;
  const followerRangeRequested = search.filters.followersMin !== undefined || search.filters.followersMax !== undefined;
  const requestedCity = search.filters.creatorCity;
  const requestedCountry = search.filters.creatorCountry;
  // Only a platform-declared country is strong enough to exclude; a missing country stays unknown.
  const countryMismatch = Boolean(requestedCountry && profile.country && profile.country !== requestedCountry);
  if (followerRangeRequested && profile.followers === null) evidence.push("Follower count unknown from the source profile");
  const gate = isMinor ? "minor_or_unclear"
    : individual === null ? "individual_creator_unverified"
    : individual === 0 ? "business_or_non_creator"
    : daysSinceLast === null || daysSinceLast > 90 ? "inactive_or_unverified"
    : search.filters.platform && search.filters.platform !== profile.platform ? "platform_mismatch"
    : countryMismatch ? "location_mismatch"
    : followerRangeRequested && profile.followers === null ? "follower_count_unavailable"
    : null;
  evidence.push(`Individual-creator lexical signal from public title/bio (${signal.cue})`);
  if (countryMismatch) evidence.push(`Platform-declared country ${profile.country} differs from requested ${requestedCountry}`);
  evidence.push(`${recent.length} sampled public posts dated within 90 days`);
  if (daysSinceLast !== null) evidence.push(`Most recent sampled post: ${daysSinceLast} days ago`);

  const topics = meaningfulTopics(search);
  const topicMode = anyTermCounts(search) ? "any" : "most";
  const declared = `${profile.displayName} ${profile.bio}`;
  const topicShares = topics.map((topic) => recent.length ? recent.filter((post) => topicMatch(`${post.caption} ${post.hashtags.join(" ")}`, topic, topicMode, usesTermsV2(search))).length / recent.length : null);
  // Sampled posts are the evidence. A bio that declares the topic adds partial credit only when at least one sampled
  // post also matches; a declaration alone never passes the topic gate.
  const components = topics.map((topic, index) => {
    const share = topicShares[index] ?? 0;
    const fromPosts = Math.min(1, share / 0.25);
    return share > 0 && topicMatch(declared, topic, topicMode, usesTermsV2(search)) ? Math.max(fromPosts, 0.5) : fromPosts;
  });
  const topicShare = recent.length && topics.length ? components.reduce((sum, c) => sum + c, 0) / topics.length : null;
  if (topicShare !== null) {
    topics.forEach((topic, index) => evidence.push(`${topic}: ${Math.round((topicShares[index] ?? 0) * 100)}% of ${recent.length} sampled posts${topicMatch(declared, topic, topicMode, usesTermsV2(search)) ? "; declared in profile bio/name" : ""}`));
  }
  const gateWithTopic = gate ?? (topicShare === null ? "topic_evidence_unavailable" : topicShare < 0.2 ? "off_topic" : null);
  if (gateWithTopic) return { version: FIT_VERSION, score: 0, confidence: 0, eligible: false, gate: gateWithTopic, topicScore: topicShare, sampleSize: recent.length, sourceUrl: candidate.canonicalUrl, fetchedAt: fetchedAt.toISOString(), evidence };

  const scored: { score: number; weight: number; evidenced: boolean }[] = [];
  if (requestedCity || requestedCountry) {
    const bio = norm(`${profile.bio} ${profile.displayName}`);
    const otherCity = requestedCity ? KNOWN_CITIES.find((city) => city !== norm(requestedCity) && ` ${bio} `.includes(` ${city} `)) : undefined;
    const geo = requestedCity
      ? (bio.includes(norm(requestedCity)) ? 1 : otherCity ? 0 : profile.country && requestedCountry === profile.country ? 0.6 : 0.5)
      : profile.country === requestedCountry ? 1 : profile.country ? 0 : 0.5;
    scored.push({ score: geo, weight: 0.2, evidenced: geo !== 0.5 });
    // Say what actually matched: a matching platform country is not evidence of the requested city.
    evidence.push(geo === 0.5 ? "Location unknown from public profile evidence"
      : otherCity && geo === 0 ? `Profile names ${otherCity}, not the requested ${requestedCity}`
      : geo === 0.6 ? `Profile country matches (${profile.country ?? ""}); ${requestedCity ?? ""} is not named in the public profile`
      : geo === 0 ? `Profile country ${profile.country ?? "unknown"} differs from the requested ${requestedCountry ?? "country"}`
      : requestedCity ? `Profile names the requested location (${requestedCity})`
      : `Profile country matches the requested ${requestedCountry}`);
  }
  const language = /\broman\s+urdu\b/i.test(search.text)
    ? "roman urdu"
    : Object.keys(LANGUAGE_PATTERNS).find((key) => new RegExp(`\\b${key}\\b`, "i").test(search.text));
  if (language) {
    const total = recent.filter((p) => p.caption.trim()).length;
    const share = total ? recent.filter((p) => hasLanguage(p.caption, language)).length / total : null;
    scored.push({ score: share ?? 0.5, weight: 0.1, evidenced: share !== null });
    evidence.push(share === null ? `No caption sample to assess ${language}` : `${Math.round(share * 100)}% of sampled captions contain ${language} script/language signal (${total} captions)`);
  }
  if (followerRangeRequested) {
    const f = profile.followers;
    const lo = search.filters.followersMin ?? 0;
    const hi = search.filters.followersMax ?? Number.MAX_SAFE_INTEGER;
    let size = 0.5;
    if (f !== null) {
      size = 1;
      if (f < lo) size = lo > 0 && f > 0 ? Math.max(0, 1 - Math.abs(Math.log10(f / lo))) : 0;
      if (f > hi) size = hi > 0 ? Math.max(0, 1 - Math.abs(Math.log10(f / hi))) : 0;
    }
    scored.push({ score: size, weight: 0.1, evidenced: profile.followers !== null });
    if (profile.followers !== null) evidence.push(`Follower count ${f} checked against requested range`);
  }
  scored.push({ score: individual ?? 0, weight: 0.1, evidenced: true });
  const activity = 0.5 * Math.min(1, recent.length / 12) + 0.5 * Math.max(0, Math.min(1, ((90 - (daysSinceLast ?? 90)) / 76)));
  scored.push({ score: activity, weight: 0.1, evidenced: recent.length > 0 });
  const totalWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const context = scored.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight;
  const confidence = scored.reduce((sum, c) => sum + (c.evidenced ? c.weight : 0), 0) / totalWeight;
  const score = Math.round(100 * (topicShare ?? 0) * (0.4 + 0.6 * context));
  return { version: FIT_VERSION, score, confidence: Math.round(confidence * 100) / 100, eligible: score >= 50, gate: score >= 50 ? null : "below_min_fit", topicScore: topicShare, sampleSize: recent.length, sourceUrl: candidate.canonicalUrl, fetchedAt: fetchedAt.toISOString(), evidence };
}
