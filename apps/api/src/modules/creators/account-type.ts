import { organisationCategory } from "./rules";

/**
 * Account-type classification (owner master directive 2026-11-03, Part 5). Deterministic rules decide the obvious cases
 * from the platform's own category, the bio and the handle; everything else is UNKNOWN (never silently "individual") and
 * may go to an AI review. Famous creator safeguard: follower count, a verification badge or brand deals never make a
 * creator a celebrity; a bio that says what the person makes ("YouTuber", "vlogger", "content creator") keeps them an
 * individual creator.
 */
export const ACCOUNT_TYPES = [
  "INDIVIDUAL_CREATOR",
  "CELEBRITY_PUBLIC_FIGURE",
  "COMPANY_CORPORATE",
  "BRAND_ACCOUNT",
  "BUSINESS_STORE",
  "MEDIA_PUBLICATION",
  "FAN_PAGE_AGGREGATOR",
  "UNKNOWN",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountTypeDecision = { type: AccountType; source: "platform_category" | "rules" | "ai" | "staff" | null; confidence: "high" | "medium" | "low" | null; evidence: string | null };

/** Account types kept out of ordinary customer creator search (their rows and history stay). */
export const NON_TARGET_TYPES: ReadonlySet<AccountType> = new Set(["CELEBRITY_PUBLIC_FIGURE", "COMPANY_CORPORATE", "BRAND_ACCOUNT", "BUSINESS_STORE", "MEDIA_PUBLICATION", "FAN_PAGE_AGGREGATOR"]);

const CATEGORY_TYPE: [RegExp, AccountType][] = [
  [/^(restaurants?|cafe|café|coffee shop|bakery|dessert shop|fast food restaurant|pizza place|caterer|hotel|hotel resort|hospitality service|private members club|event venue|night club|bar|beauty salon|hair salon|spa|gym\/physical fitness center|clothing store|cosmetics store|shopping & retail|jewelry\/watches|real estate|car dealership|travel agency|travel company|local business)$/i, "BUSINESS_STORE"],
  [/^(clothing \(brand\)|brand|retail company|e-commerce website|product\/service)$/i, "BRAND_ACCOUNT"],
  [/^(magazine|media\/news company|news & media website|tv channel|broadcasting & media production company|radio station|newspaper|media)$/i, "MEDIA_PUBLICATION"],
  [/^(marketing agency|advertising\/marketing|advertising agency|public relations agency|school|college & university|education|university|hospital|medical center|medical & health|non-governmental organization \(ngo\)|nonprofit organization|government organization|community organization|company|business service|real estate company|app page|software company|internet company|telecommunication company|bank|financial service|sports team)$/i, "COMPANY_CORPORATE"],
  [/^(digital creator|video creator|blogger|personal blog|gaming video creator|gamer|reel creator|creator|creators & celebrities|food critic|makeup artist|fitness trainer|photographer|comedian|artist|fashion designer|nutritionist)$/i, "INDIVIDUAL_CREATOR"],
  [/^(actor|actress|musician|musician\/band|singer|athlete|sportsperson|politician|political candidate|news personality|tv show host|film director|producer)$/i, "CELEBRITY_PUBLIC_FIGURE"],
];

// What a creator says they make: keeps famous creators individual (safeguard).
const CREATOR_WORDS = /\b(youtuber|you tuber|vlogger|vlogs?|blogger|content creator|digital creator|creator|influencer|streamer|gamer|podcaster|podcast host|tiktoker|reels?|food reviewer|makeup artist|mua|fitness coach|tech reviewer|educator)\b/i;
const FAN_WORDS = /\b(fan ?page|fan ?account|fan club|fanclub|fans? of|not affiliated|unofficial|updates? (?:page|account)|daily updates|credits? (?:to|go to) (?:the )?owners?|dm for (?:credit|removal)|repost(?:s|ing)?)\b/i;
const FAN_HANDLE = /(fanpage|fan_page|_fans?$|^fans?_|fanclub|updates$|_updates|\.updates|memes?$|_memes|viral|lovers$)/i;

export function classifyAccountType(o: { category: string | null; bio: string; handle: string; displayName: string }): AccountTypeDecision {
  const bio = o.bio ?? "";
  if (FAN_WORDS.test(bio) || FAN_HANDLE.test(o.handle)) {
    const m = FAN_WORDS.exec(bio)?.[0] ?? o.handle;
    return { type: "FAN_PAGE_AGGREGATOR", source: "rules", confidence: "medium", evidence: `Fan page or repost account: "${m}"` };
  }
  const cat = o.category?.trim() ?? "";
  const creatorWord = CREATOR_WORDS.exec(bio)?.[0] ?? null;
  if (cat) {
    for (const [re, type] of CATEGORY_TYPE) {
      if (!re.test(cat)) continue;
      // Safeguard: a person whose bio says they create content is a creator even under a celebrity category.
      if (type === "CELEBRITY_PUBLIC_FIGURE" && creatorWord) return { type: "INDIVIDUAL_CREATOR", source: "rules", confidence: "medium", evidence: `Bio says "${creatorWord}" (platform category: ${cat})` };
      return { type, source: "platform_category", confidence: organisationCategory(cat) || type === "INDIVIDUAL_CREATOR" ? "high" : "medium", evidence: `Platform category: ${cat}` };
    }
  }
  if (creatorWord) return { type: "INDIVIDUAL_CREATOR", source: "rules", confidence: "medium", evidence: `Bio says "${creatorWord}"` };
  return { type: "UNKNOWN", source: null, confidence: null, evidence: null };
}
