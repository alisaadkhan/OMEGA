import type { NICHE_TAXONOMY } from "./terminology";

/**
 * Catalogue expansion query matrix (owner, 24 Nov): 16 verticals and their sub-niches × Pakistani cities and regional
 * languages × the three platforms, TikTok and Instagram first (where the qualified pool is smallest). Each cell is one
 * live-discovery search; every sub-niche maps to a canonical Main Niche from the taxonomy plus a specific secondary
 * label, so search filters stay organised. Deterministic order, so a run resumes from where it stopped (build.ts skips
 * cells already built). Every query has three or more words, as live search requires (owner, 22 Nov).
 */
type Main = (typeof NICHE_TAXONOMY)[number];
export type SeedPlatform = "tiktok" | "instagram" | "youtube";
export type SeedCell = { key: string; platform: SeedPlatform; text: string; city: string | null; mainNiche: Main; secondaryNiche: string; vertical: string };

/** [vertical, [main niche, secondary label, search phrase][]]. The phrase is what a person would type to find them. */
export const SEED_VERTICALS: [string, [Main, string, string][]][] = [
  ["Tech, AI & Software", [["Tech", "AI tools & tutorials", "AI tools tutorial creator"], ["Tech", "Coding & software engineering", "coding software engineer creator"], ["Tech", "Cybersecurity", "cybersecurity awareness creator"], ["Tech", "Mobile & laptop reviews", "mobile phone review creator"], ["Tech", "PC builds", "gaming PC build creator"], ["Tech", "Budget tech", "budget tech gadgets review"], ["Tech", "SaaS & indie makers", "indie SaaS founder creator"]]],
  ["Finance, Career & Business", [["Finance", "PSX stock market", "PSX stock market investing"], ["Finance", "Halal investing & personal finance", "halal investing personal finance"], ["Finance", "Crypto & Web3 education", "crypto web3 education creator"], ["Business & Ecommerce", "Freelancing", "freelancing Upwork Fiverr tips"], ["Business & Ecommerce", "E-commerce", "Daraz Shopify Amazon ecommerce"], ["Business & Ecommerce", "Startup founders", "startup founder vlog creator"], ["Education & How-to", "Career & CV coaching", "career CV interview coaching"]]],
  ["Education, Study & Self-Improvement", [["Education & How-to", "CSS & PMS exam prep", "CSS PMS exam preparation"], ["Education & How-to", "MDCAT, ECAT & FSc", "MDCAT ECAT FSc preparation"], ["Education & How-to", "O & A Levels", "O Level A Level teacher"], ["Education & How-to", "IELTS & study abroad", "IELTS study abroad guidance"], ["Education & How-to", "Spoken English", "spoken English teacher creator"], ["Education & How-to", "Productivity & study-with-me", "study with me productivity"], ["Education & How-to", "Science & math explainers", "science math explainer creator"]]],
  ["Lifestyle, Family & Daily Vlogs", [["Lifestyle", "Family & couple vlogs", "family couple daily vlogs"], ["Lifestyle", "Motherhood & parenting", "motherhood parenting mom vlogger"], ["Lifestyle", "Student & hostel life", "university hostel student life"], ["Lifestyle", "Home decor & organisation", "home decor organization creator"], ["Lifestyle", "Minimalist daily vlogs", "aesthetic minimalist daily vlog"]]],
  ["Food & Culinary", [["Food", "Street food reviews", "street food review vlogger"], ["Food", "Desi home cooking", "desi home cooking recipes"], ["Food", "Baking & desserts", "baking desserts home baker"], ["Food", "Cafe & restaurant reviews", "cafe restaurant review blogger"], ["Food", "Regional food", "Peshawari Lahori Balochi food"], ["Food", "Budget eats", "budget eats cheap food"]]],
  ["Fashion, Modest Wear & Beauty", [["Fashion", "Modest & hijab fashion", "modest hijab fashion creator"], ["Fashion", "Men's fashion & grooming", "men fashion grooming creator"], ["Bridal", "Bridal & festive styling", "bridal festive styling creator"], ["Beauty", "Skincare science & dermatology", "dermatologist skincare science creator"], ["Beauty", "Makeup artistry", "makeup artist tutorial creator"], ["Fashion", "Thrift & streetwear", "thrift streetwear fashion creator"]]],
  ["Fitness, Health & Wellness", [["Wellness", "Gym, bodybuilding & calisthenics", "gym bodybuilding calisthenics creator"], ["Wellness", "Nutrition & dietitians", "dietitian nutrition advice creator"], ["Wellness", "Doctors & medical awareness", "doctor medical awareness creator"], ["Wellness", "Mental health & psychology", "mental health psychology creator"], ["Wellness", "Women's home fitness", "women home workout fitness"], ["Wellness", "Yoga & physiotherapy", "yoga physiotherapy exercises creator"]]],
  ["Travel, Adventure & Culture", [["Travel", "Northern areas road trips", "northern areas road trip"], ["Travel", "Moto-vlogging", "motovlog bike travel creator"], ["Travel", "Trekking & camping", "trekking camping hiking creator"], ["Travel", "Budget backpacking", "budget backpacking travel vlogger"], ["History", "Cultural heritage & architecture", "cultural heritage architecture explorer"], ["Travel", "Expat & diaspora stories", "Pakistani expat diaspora vlog"]]],
  ["Automotive & Mobility", [["Automotive", "Car & bike reviews", "car bike review creator"], ["Automotive", "Restoration & modifications", "car restoration modification creator"], ["Automotive", "EVs & hybrids", "electric vehicle hybrid review"], ["Automotive", "Auctions & buying guides", "used car buying guide"]]],
  ["Gaming & Esports", [["Gaming", "PUBG Mobile", "PUBG Mobile gamer streamer"], ["Gaming", "Tekken", "Tekken player esports creator"], ["Gaming", "Valorant & PC gaming", "Valorant PC gaming streamer"], ["Gaming", "Live streaming", "gaming live streamer creator"], ["Gaming", "Gaming commentary & hardware", "gaming commentary hardware review"]]],
  ["Podcasts, Commentary & Journalism", [["News & Commentary", "Video podcasts", "long form video podcast"], ["News & Commentary", "Social commentary", "social commentary creator vlog"], ["News & Commentary", "Geopolitics & current affairs", "geopolitics current affairs analysis"], ["Entertainment", "Book & film analysis", "book film review analysis"]]],
  ["Arts, Design & Creative Skills", [["Arts & Design", "Graphic & UI/UX design", "graphic design UI UX tutorial"], ["Arts & Design", "Video editing & filmmaking", "video editing filmmaking tutorial"], ["Arts & Design", "Photography", "photography tips photographer creator"], ["Arts & Design", "Calligraphy", "Urdu Arabic calligraphy artist"], ["Arts & Design", "Illustration & digital art", "digital art illustration artist"], ["Lifestyle", "Architecture & interior design", "architecture interior design creator"]]],
  ["Literature, History & Religion", [["Literature", "Urdu poetry & spoken word", "Urdu poetry shayari spoken word"], ["History", "Pakistani & Islamic history", "Pakistani Islamic history storyteller"], ["Literature", "Storytelling", "Urdu storytelling kahani creator"], ["Religion", "Islamic reminders & scholarship", "Islamic reminders scholar creator"]]],
  ["Agriculture, Rural & Off-Grid Living", [["Agriculture", "Modern farming & agritech", "modern farming agritech creator"], ["Agriculture", "Livestock & dairy", "livestock dairy goat farming"], ["Agriculture", "Home gardening", "home gardening plants creator"], ["Agriculture", "Solar & off-grid", "solar off grid setup"], ["Lifestyle", "Village life", "rural village life vlog"]]],
  ["Sports & Athletics", [["Sports", "Cricket analysis & podcasts", "cricket analysis podcast creator"], ["Sports", "Football", "football skills creator Pakistan"], ["Sports", "MMA, boxing & martial arts", "MMA boxing martial arts"], ["Sports", "Running & cycling", "running cycling fitness athlete"]]],
  ["Real Estate & Construction", [["Real Estate", "Housing society tours", "housing society tour vlog"], ["Real Estate", "Construction cost guides", "house construction cost guide"], ["Real Estate", "Home tours", "home tour architecture creator"]]],
];

export const SEED_CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Peshawar", "Faisalabad", "Multan", "Sialkot", "Quetta", "Gujranwala", "Sargodha", "Bahawalpur", "Abbottabad", "Swat", "Gilgit Hunza", "Mirpur AJK"] as const;
/** Regional languages and cultures, crossed with a few broad verticals where the language itself finds the audience. */
export const SEED_LANGUAGES = ["Urdu", "Punjabi", "Pashto", "Sindhi", "Saraiki", "Pakistani diaspora"] as const;
const LANGUAGE_PHRASES: [Main, string, string][] = [["Comedy", "Comedy", "comedy creator"], ["Food", "Home cooking", "cooking recipes creator"], ["Lifestyle", "Family vlogs", "family vlog creator"], ["Literature", "Poetry", "poetry creator"], ["News & Commentary", "Commentary", "commentary podcast creator"]];
export const SEED_PLATFORMS: readonly SeedPlatform[] = ["tiktok", "instagram", "youtube"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Every cell, breadth first: all sub-niches nationally ("… Pakistan"), then the language rows, then each city in turn,
 * each across TikTok, Instagram, YouTube. A run that stops early has still covered every vertical once.
 */
export function seedMatrix(o: { platforms?: readonly SeedPlatform[] } = {}): SeedCell[] {
  const platforms = o.platforms ?? SEED_PLATFORMS;
  const cells: SeedCell[] = [];
  const push = (vertical: string, [main, secondary]: [Main, string, string], place: string | null, text: string) => {
    for (const platform of platforms) cells.push({ key: `${platform}:${slug(text)}`, platform, text, city: place, mainNiche: main, secondaryNiche: secondary, vertical });
  };
  for (const [vertical, subs] of SEED_VERTICALS) for (const sub of subs) push(vertical, sub, null, `${sub[2]} Pakistan`);
  for (const lang of SEED_LANGUAGES) for (const sub of LANGUAGE_PHRASES) push("Regional languages", [sub[0], `${lang} ${sub[1]}`, sub[2]], null, `${lang} ${sub[2]}`);
  for (const city of SEED_CITIES) for (const [vertical, subs] of SEED_VERTICALS) for (const sub of subs) push(vertical, sub, city, `${sub[2]} ${city}`);
  return cells;
}

/**
 * An even rotation for a small wave (owner, 25 Nov: "~75–80 YouTube searches across all verticals and cities"): round 0
 * takes each vertical's first sub-niche nationally, every later round the next sub-niche in a different city per
 * vertical, so n queries cover all 16 verticals about equally and spread over the cities.
 */
export function rotationQueries(n: number): { text: string; vertical: string; mainNiche: Main; secondaryNiche: string; city: string | null }[] {
  const out: { text: string; vertical: string; mainNiche: Main; secondaryNiche: string; city: string | null }[] = [];
  for (let round = 0; out.length < n && round < 100; round++) {
    SEED_VERTICALS.forEach(([vertical, subs], v) => {
      if (out.length >= n) return;
      const [main, secondary, phrase] = subs[round % subs.length] as [Main, string, string];
      const city = round === 0 ? null : (SEED_CITIES[(round - 1 + v) % SEED_CITIES.length] ?? null);
      out.push({ text: `${phrase} ${city ?? "Pakistan"}`, vertical, mainNiche: main, secondaryNiche: secondary, city });
    });
  }
  return out;
}
