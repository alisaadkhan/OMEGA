import { z } from "zod";

/** The staff creator list (GET /admin/v1/catalogue/all), mirrored from the API's staffCreatorListSchema. */
export const profileSchema = z.object({
  platform: z.string(),
  handle: z.string(),
  url: z.string(),
  followers: z.number().nullable(),
  countryStatus: z.string().nullable(),
  country: z.string().nullable(),
  countrySource: z.string().nullable(),
  bio: z.string().nullable(),
  verified: z.boolean().nullable(),
});
export const staffCreatorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  publicCountry: z.string().nullable(),
  publicCountrySource: z.string().nullable(),
  status: z.string(),
  hiddenReason: z.string().nullable(),
  trashedAt: z.string().nullable(),
  trashBanned: z.boolean(),
  trashReason: z.string().nullable(),
  isMinor: z.boolean(),
  minorReason: z.string().nullable(),
  organisationCategory: z.string().nullable(),
  accountType: z.string().nullable(),
  nicheMain: z.string().nullable(),
  niches: z.array(z.string()),
  assessmentStatus: z.string().nullable(),
  eligible: z.boolean(),
  hiddenBecause: z.array(z.string()),
  reports: z.number(),
  reportReasons: z.array(z.string()),
  profiles: z.array(profileSchema),
  links: z.array(z.string()).default([]),
});
export type StaffCreator = z.infer<typeof staffCreatorSchema>;
/** Days before a trashed creator is erased (API TRASH_KEEP_DAYS). */
export const TRASH_DAYS = 45;
export const trashDaysLeft = (trashedAt: string | null): number | null =>
  trashedAt === null ? null : Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(trashedAt).getTime()) / 86_400_000));
export const FILTERS = ["qualified", "unreachable", "unqualified", "refresh", "country", "organisation", "assessment", "minor", "reported", "hidden", "trash", "all"] as const;
export type Filter = (typeof FILTERS)[number];
export const staffCreatorListSchema = z.object({ items: z.array(staffCreatorSchema), total: z.number(), counts: z.record(z.enum(FILTERS), z.number()), problems: z.record(z.string(), z.number()).default({}) });

export const FILTER_LABEL: Record<Filter, string> = {
  qualified: "Qualifies",
  unreachable: "Not reachable",
  unqualified: "Doesn't qualify",
  refresh: "Followers to refresh",
  country: "Location",
  organisation: "Brand",
  assessment: "Assessment",
  minor: "Age",
  reported: "Reported",
  hidden: "Hidden",
  trash: "Trash",
  all: "All",
};
/** What each sub-page holds, shown under the page tabs. */
export const FILTER_HELP: Record<Filter, string> = {
  qualified: "Customers can find these creators, and they have an email or phone.",
  unreachable: "They qualify but have no email or phone yet, so customers cannot contact them.",
  unqualified: "They do not meet a rule yet: follower count unknown, Pakistan not proven, or a brand page. Review them here.",
  refresh: "Their follower count is unknown: refresh the numbers before deciding.",
  country: "Pakistan is not proven for these profiles. Confirm the country with evidence.",
  organisation: "These look like a brand or organisation. Mark real people as a person.",
  assessment: "Not assessed yet, or not enough data to assess.",
  minor: "Possible minors, kept out of customer views until cleared.",
  reported: "Customers reported something about these creators.",
  hidden: "Hidden from customers by staff.",
  trash: "Restorable for 45 days, then erased for good.",
  all: "Every creator that is not in Trash.",
};

/** The canonical niche taxonomy (API creators/terminology NICHE_TAXONOMY). */
export const NICHES = ["Bridal", "Fashion", "Beauty", "Tech", "Food", "Travel", "Comedy", "Finance", "Wellness", "Lifestyle", "Education & How-to", "Gaming", "History", "Literature", "Agriculture", "Business & Ecommerce", "Automotive", "Religion", "Music", "News & Commentary", "Sports", "Entertainment", "Real Estate", "Arts & Design"] as const;

export const ACCOUNT_TYPES: { id: string; label: string }[] = [
  { id: "INDIVIDUAL_CREATOR", label: "Individual creator (a person)" },
  { id: "CELEBRITY_PUBLIC_FIGURE", label: "Celebrity / public figure" },
  { id: "BRAND_ACCOUNT", label: "Brand" },
  { id: "BUSINESS_STORE", label: "Business / store" },
  { id: "COMPANY_CORPORATE", label: "Company" },
  { id: "MEDIA_PUBLICATION", label: "Media / publisher" },
  { id: "FAN_PAGE_AGGREGATOR", label: "Fan page / aggregator" },
  { id: "UNKNOWN", label: "Not decided" },
];

export const REPORT_REASON: Record<string, string> = {
  not_individual_creator: "Not an individual creator",
  wrong_location: "Wrong location",
  wrong_niche: "Wrong niche",
  broken_profile: "Broken profile",
  other: "Other",
};

/** Why a creator is not in customer search, in plain words. */
export const HIDDEN: Record<string, string> = {
  below_follower_minimum: "under 10,000 followers",
  followers_unknown: "follower count unknown",
  followers_stale: "follower count older than 90 days",
  inactive: "no post in 90 days",
  invalid_profile_url: "not an own profile link",
  profile_not_found: "profile not found",
  profile_private: "private profile",
  no_profile: "no profile",
  minor_protected: "possible minor",
  account_not_individual_creator: "not an individual creator",
  creator_not_active: "hidden or removed",
  country_unknown: "country unknown",
  country_conflicting: "conflicting country",
  country_not_pakistan: "not in Pakistan",
  country_stale: "country evidence out of date",
  location_only: "only location unproven",
};

/** A problem as a category name ("Country unknown"); an unknown code is shown readable rather than hidden. */
export const problemLabel = (r: string) => {
  const t = HIDDEN[r] ?? r.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const fmtFollowers = (n: number | null) => (n === null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n));
