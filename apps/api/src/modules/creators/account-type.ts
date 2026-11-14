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
  [/^(clothing \(brand\)|brand|retail company|e-commerce website|product\/service|shopping & retail|app page|game|video game|software)$/i, "BRAND_ACCOUNT"],
  [/^(company|sports team|sports club|amateur sports team|professional sports team)$/i, "COMPANY_CORPORATE"],
  [/^(magazine|media\/news company|news & media website|tv channel|broadcasting & media production company|radio station|newspaper|media)$/i, "MEDIA_PUBLICATION"],
  [/^(marketing agency|advertising\/marketing|advertising agency|public relations agency|school|college & university|education|university|hospital|medical center|medical & health|non-governmental organization \(ngo\)|nonprofit organization|government organization|community organization|company|business service|real estate company|app page|software company|internet company|telecommunication company|bank|financial service|sports team)$/i, "COMPANY_CORPORATE"],
  [/^(digital creator|video creator|blogger|personal blog|gaming video creator|gamer|reel creator|creator|creators & celebrities|food critic|makeup artist|fitness trainer|photographer|comedian|fashion designer|nutritionist)$/i, "INDIVIDUAL_CREATOR"],
  [/^(actor|actress|musician|musician\/band|singer|athlete|sportsperson|politician|political candidate|news personality|tv show host|film director|producer)$/i, "CELEBRITY_PUBLIC_FIGURE"],
];

// What a creator says they make: keeps famous creators individual (safeguard).
const CREATOR_WORDS = /\b(youtuber|you tuber|vlogger|vlogs?|blogger|content creator|digital creator|creator|influencer|streamer|gamer|podcaster|podcast host|tiktoker|reels?|food reviewer|makeup artist|mua|fitness coach|tech reviewer|educator)\b/i;
const FAN_WORDS = /\b(fan ?page|fan ?account|fan club|fanclub|fans? of|not affiliated|unofficial|updates? (?:page|account)|daily updates|credits? (?:to|go to) (?:the )?owners?|dm for (?:credit|removal)|repost(?:s|ing)?)\b/i;
const FAN_HANDLE = /(fanpage|fan_page|_fans?$|^fans?_|fanclub|updates$|_updates|\.updates|memes?$|_memes|viral|lovers$)/i;

const MEDIA_WORDS = /\b(entertainment channel|(?:tv|television|news) channel|news (?:platform|network|agency|portal)|digital news|media (?:house|group|network)|newspaper|official (?:news|broadcaster))\b/i;
const SHOP_WORDS = /\b(beauty (?:store|shop|parlou?r|salon)|online (?:store|shop)|shipping (?:all over|nationwide|worldwide|across)|cash on delivery|100% original products|wholesale|parlou?r|salon|boutique|order (?:now|online|via))\b/i;

const CORPORATE_WORDS = /\b(official (?:account|instagram|page|handle) of|download (?:now|the app)|order online|nationwide delivery|cash on delivery|customer (?:care|support|service)|helpline|uan\s*:?\s*\d)/i;
const CELEBRITY_WORDS = /\b((?:tv |film |drama |television )?actor|actress|film star|drama serial|politician|member of (?:the )?(?:national|provincial) assembly|mna\b|mpa\b|senator|chief minister|federal minister|cricketer|national (?:team|athlete)|olympian|playback singer)\b/i;
const BRANDS = ["pubg", "bgmi", "freefire", "garena", "codm", "playstation", "xbox", "samsung", "xiaomi", "infinix", "tecno", "oppo", "vivo", "realme", "apple", "daraz", "foodpanda", "kfc", "mcdonalds", "pepsi", "cocacola", "jazz", "zong", "telenor", "ufone", "pakwheels", "zameen", "ary", "geonews", "humtv", "samaa", "bolnetwork", "expressnews", "dawnnews", "pcb", "psl", "zalmi", "qalandars", "sultans", "kings", "united", "gladiators"];
const QUALIFIERS = ["official", "pk", "pakistan", "mobile", "esports", "store", "shop", "tv", "news", "network"];
/** "pubgm_pk_official" or "Samsung Pakistan": a brand token together with a corporate qualifier token. */
function officialBrandHandle(handle: string, displayName: string): string | null {
  for (const text of [handle, displayName]) {
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const brand = tokens.find((t) => BRANDS.some((b) => t === b || (t.startsWith(b) && t.length <= b.length + 2)));
    const qualifier = tokens.find((t) => QUALIFIERS.includes(t) && t !== brand);
    if (brand && qualifier) return `"${text}"`;
    // Joined forms: "pubgmobilepk", "samsungpakistan".
    const joined = tokens.join("");
    const b = BRANDS.find((x) => joined.startsWith(x));
    if (b && QUALIFIERS.some((q) => joined.endsWith(q) || joined.slice(b.length).startsWith(q)) && joined.length <= b.length + 14) return `"${text}"`;
  }
  return null;
}

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
  // No category and no creator word: the bio's own wording names a shop or a media outlet (owner directive 2026-11-04:
  // Khaadi, HUM TV, "Beauty Store… Shipping all over Pakistan" stayed UNKNOWN and so in search).
  // Plan 2026-11-14 Phase 5: corporate / storefront boilerplate, an official game/brand/media handle, or a traditional
  // celebrity described as such, with no creator word anywhere (Ducky Bhai or Irfan Junejo stay creators).
  const boiler = CORPORATE_WORDS.exec(bio)?.[0];
  if (boiler) return { type: "BRAND_ACCOUNT", source: "rules", confidence: "medium", evidence: `Bio says "${boiler}"` };
  const brand = officialBrandHandle(o.handle, o.displayName);
  if (brand) return { type: "BRAND_ACCOUNT", source: "rules", confidence: "medium", evidence: `Official brand, game or media account: ${brand}` };
  const celeb = CELEBRITY_WORDS.exec(bio)?.[0];
  if (celeb) return { type: "CELEBRITY_PUBLIC_FIGURE", source: "rules", confidence: "medium", evidence: `Bio says "${celeb}" and names no creator work` };
  const media = MEDIA_WORDS.exec(bio)?.[0];
  if (media) return { type: "MEDIA_PUBLICATION", source: "rules", confidence: "medium", evidence: `Bio says "${media}"` };
  const shop = SHOP_WORDS.exec(bio)?.[0];
  if (shop) return { type: "BUSINESS_STORE", source: "rules", confidence: "medium", evidence: `Bio says "${shop}"` };
  return { type: "UNKNOWN", source: null, confidence: null, evidence: null };
}
