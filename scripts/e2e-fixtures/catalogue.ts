import type { NewCreator, NewProfile } from "../../apps/api/src/modules/creators/index";

/**
 * Synthetic creator catalogue for the browser E2E (audit OPS-02). Every creator here is invented: the names say
 * "Fixture", handles start with "fx", contact details use the reserved example.com domain and an unassigned number
 * range, and nothing comes from a platform or a provider (no YouTube API data, so no retention duty). It replaces the
 * template copied from a developer's own catalogue, so a fresh clone (and CI) can build the same E2E database.
 *
 * What the journeys rely on: a food creator in Lahore on YouTube with no contacts (FX.main), a second food creator
 * (FX.second), a food creator below the 10,000-follower minimum (FX.small), YouTube food results, a "Lahore" query that
 * finds a different set than "food", and a mix of platforms, cities, contacts and eligibility.
 */
export const FX = {
  main: "fxhomecook",
  second: "fxfoodlahore",
  small: "fxsmallfood",
} as const;

const yt = (handle: string, followers: number, bio: string, extra: Partial<NewProfile> = {}): NewProfile => ({
  platform: "youtube", handle, followers, engagementRate: 3.1, posts: 120, avgLikes: Math.round(followers * 0.02), avgComments: Math.round(followers * 0.001), avgViews: Math.round(followers * 0.3), bio, ...extra,
});
const ig = (handle: string, followers: number, bio: string): NewProfile => ({
  platform: "instagram", handle, followers, engagementRate: 4.2, posts: 300, avgLikes: Math.round(followers * 0.04), avgComments: Math.round(followers * 0.002), bio,
});
const tt = (handle: string, followers: number, bio: string): NewProfile => ({
  platform: "tiktok", handle, followers, engagementRate: 6.5, posts: 500, avgLikes: Math.round(followers * 0.08), avgComments: Math.round(followers * 0.003), bio,
});
const email = (handle: string) => ({ kind: "email" as const, value: `${handle}@example.com`, trust: "likely" as const, source: "bio (synthetic fixture)" });
const phone = (n: number) => ({ kind: "phone" as const, value: `+92 300 00000${String(n).padStart(2, "0")}`, trust: "unverified" as const, source: "bio (synthetic fixture)" });
const creator = (c: Omit<NewCreator, "country" | "tags"> & { tags?: string[] }): NewCreator => ({ country: "PK", confirmedCountry: "PK", tags: [], ...c });

export const FIXTURE_CREATORS: NewCreator[] = [
  // Food
  creator({ displayName: "Fixture Home Cook", primaryHandle: FX.main, primaryPlatform: "youtube", city: "Lahore", niches: ["Food", "Tech", "Lifestyle"], tags: ["#food", "#lahore"], profiles: [yt(FX.main, 28_300, "Home cooking and kitchen gadgets from Lahore (synthetic fixture)")] }),
  creator({ displayName: "Fixture Food Lahore", primaryHandle: FX.second, primaryPlatform: "youtube", city: "Lahore", niches: ["Food"], tags: ["#food", "#streetfood"], profiles: [yt(FX.second, 223_000, "Street food tours across Lahore (synthetic fixture)")], contacts: [email(FX.second)] }),
  creator({ displayName: "Fixture Karachi Kitchen", primaryHandle: "fxkarachikitchen", primaryPlatform: "youtube", city: "Karachi", niches: ["Food", "Travel"], profiles: [yt("fxkarachikitchen", 248_000, "Karachi recipes and food travel (synthetic fixture)")], contacts: [email("fxkarachikitchen"), phone(1)] }),
  creator({ displayName: "Fixture Desi Bites", primaryHandle: "fxdesibites", primaryPlatform: "youtube", niches: ["Food", "Lifestyle", "Travel"], profiles: [yt("fxdesibites", 283_000, "Desi food reviews and travel (synthetic fixture)")] }),
  creator({ displayName: "Fixture BBQ Nights", primaryHandle: "fxbbqnights", primaryPlatform: "youtube", city: "Islamabad", niches: ["Food"], profiles: [yt("fxbbqnights", 148_000, "Barbecue and grill food in Islamabad (synthetic fixture)")], contacts: [email("fxbbqnights"), phone(2)] }),
  creator({ displayName: "Fixture Small Food", primaryHandle: FX.small, primaryPlatform: "youtube", niches: ["Food"], profiles: [yt(FX.small, 5_990, "Small food channel, below the follower minimum (synthetic fixture)")] }),
  creator({ displayName: "Fixture Tiny Tiffin", primaryHandle: "fxtinytiffin", primaryPlatform: "youtube", niches: ["Food"], profiles: [yt("fxtinytiffin", 1_340, "Lunchbox food ideas (synthetic fixture)")] }),
  creator({ displayName: "Fixture Chai Corner", primaryHandle: "fxchaicorner", primaryPlatform: "instagram", city: "Karachi", niches: ["Food", "Lifestyle"], profiles: [ig("fxchaicorner", 64_000, "Chai and food spots in Karachi (synthetic fixture)")], contacts: [email("fxchaicorner")] }),
  // Tech, travel, lifestyle and others
  creator({ displayName: "Fixture Tech Review", primaryHandle: "fxtechreview", primaryPlatform: "youtube", city: "Gujranwala", niches: ["Tech"], profiles: [yt("fxtechreview", 828_000, "Phone and laptop reviews in Urdu (synthetic fixture)")] }),
  creator({ displayName: "Fixture Code Lahore", primaryHandle: "fxcodelahore", primaryPlatform: "youtube", city: "Lahore", niches: ["Tech", "Education"], profiles: [yt("fxcodelahore", 37_900, "Programming lessons from Lahore (synthetic fixture)")], contacts: [email("fxcodelahore"), phone(3)] }),
  creator({ displayName: "Fixture Gadget Lab", primaryHandle: "fxgadgetlab", primaryPlatform: "youtube", niches: ["Tech", "Lifestyle"], profiles: [yt("fxgadgetlab", 415_000, "Gadget unboxing and tests (synthetic fixture)")] }),
  creator({ displayName: "Fixture Mountain Trails", primaryHandle: "fxmountaintrails", primaryPlatform: "youtube", niches: ["Travel", "Lifestyle", "Fashion"], profiles: [yt("fxmountaintrails", 188_000, "Northern areas travel vlogs (synthetic fixture)")] }),
  creator({ displayName: "Fixture Lahore Bridal", primaryHandle: "fxlahorebridal", primaryPlatform: "instagram", city: "Lahore", niches: ["Bridal", "Fashion"], profiles: [ig("fxlahorebridal", 152_000, "Bridal makeup and wedding looks in Lahore (synthetic fixture)")], contacts: [email("fxlahorebridal")] }),
  creator({ displayName: "Fixture Lahore Style", primaryHandle: "fxlahorestyle", primaryPlatform: "instagram", city: "Lahore", niches: ["Fashion", "Beauty"], profiles: [ig("fxlahorestyle", 91_000, "Everyday fashion from Lahore (synthetic fixture)")] }),
  creator({ displayName: "Fixture Comedy Karachi", primaryHandle: "fxcomedykhi", primaryPlatform: "tiktok", city: "Karachi", niches: ["Comedy"], profiles: [tt("fxcomedykhi", 961_400, "Urdu comedy sketches (synthetic fixture)")] }),
  creator({ displayName: "Fixture Road Trips", primaryHandle: "fxroadtrips", primaryPlatform: "tiktok", niches: ["Travel", "Lifestyle"], profiles: [tt("fxroadtrips", 72_600, "Road trips across Pakistan (synthetic fixture)")], contacts: [email("fxroadtrips")] }),
  creator({ displayName: "Fixture Tiny Dance", primaryHandle: "fxtinydance", primaryPlatform: "tiktok", niches: ["Lifestyle"], profiles: [tt("fxtinydance", 688, "Dance clips (synthetic fixture)")] }),
  creator({ displayName: "Fixture Money Talk", primaryHandle: "fxmoneytalk", primaryPlatform: "youtube", niches: ["Finance", "Lifestyle"], profiles: [yt("fxmoneytalk", 2_360, "Personal finance basics (synthetic fixture)")] }),
  creator({ displayName: "Fixture Wellness Daily", primaryHandle: "fxwellness", primaryPlatform: "youtube", niches: ["Wellness", "Tech"], profiles: [yt("fxwellness", 663, "Wellness routines (synthetic fixture)")] }),
  // Based abroad (elig-2, Pakistan-only): kept in the database, never shown to customers, refused by id, link and lists.
  creator({ displayName: "Fixture Toronto Tech", primaryHandle: "fxtorontotech", primaryPlatform: "youtube", city: "Toronto", niches: ["Tech"], confirmedCountry: null, platformCountry: "CA", profiles: [yt("fxtorontotech", 23_400, "Tech reviews, based in Toronto, Canada (synthetic fixture)")] }),
  // A possible minor: never shown to customers.
  creator({ displayName: "Fixture Young Gamer", primaryHandle: "fxyounggamer", primaryPlatform: "youtube", niches: ["Gaming"], isMinor: true, profiles: [yt("fxyounggamer", 54_000, "Gaming clips (synthetic fixture)")] }),
];
