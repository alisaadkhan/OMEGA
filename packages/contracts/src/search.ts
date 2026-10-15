import { z } from "zod";

export const creatorPlatformSchema = z.enum(["instagram", "tiktok", "youtube"]);
export const freshnessSchema = z.enum(["current", "aging", "stale"]);
/**
 * What is known about reaching a creator, without revealing anything (2026-10-15). email_unverified: an address was
 * found on the public profile but nothing proves it works ("Email available · Unverified"); email_verified: real
 * delivery or confirmation evidence (nothing sets it yet); email_invalid: every email found was shown not to work and
 * no other contact exists; phone_unverified: only a phone number; none: "No contact info".
 */
export const contactAvailabilitySchema = z.enum(["email_unverified", "email_verified", "email_invalid", "phone_unverified", "none"]);
export type ContactAvailability = z.output<typeof contactAvailabilitySchema>;
/** unverified: not checked; domain_ok: format and domain mail servers check out, the inbox is still unproven. */
export const contactStatusSchema = z.enum(["unverified", "domain_ok", "invalid", "verified"]);
export const fitLabelSchema = z.enum(["Best match", "Strong match", "Possible match", "Needs review"]);
const iso = z.iso.datetime();
const country = z.string().regex(/^[A-Z]{2}$/, "must be a 2-letter ISO country code");

/** Filters without cross-field rules (reused for interpretation chips). */
export const searchFiltersShape = z.object({
  platform: creatorPlatformSchema.optional(),
  creatorCountry: country.optional(),
  creatorCity: z.string().trim().min(1).max(60).optional(),
  audienceCountry: country.optional(),
  followersMin: z.number().int().min(0).max(500_000_000).optional(),
  followersMax: z.number().int().min(0).max(500_000_000).optional(),
  engagementMin: z.number().min(0).max(100).optional(),
  engagementMax: z.number().min(0).max(100).optional(),
  niches: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  verifiedOnly: z.boolean().default(false),
  minAuthenticity: z.number().int().min(0).max(100).optional(),
  hasContact: z.boolean().default(false),
  freshOnly: z.boolean().default(false),
});

export const searchFiltersSchema = searchFiltersShape
  .refine((f) => f.followersMin === undefined || f.followersMax === undefined || f.followersMin <= f.followersMax, {
    message: "followersMin must not exceed followersMax",
    path: ["followersMin"],
  })
  .refine((f) => f.engagementMin === undefined || f.engagementMax === undefined || f.engagementMin <= f.engagementMax, {
    message: "engagementMin must not exceed engagementMax",
    path: ["engagementMin"],
  });
export type SearchFilters = z.output<typeof searchFiltersSchema>;

export const searchRequestSchema = z.object({
  text: z.string().trim().max(300).default(""),
  filters: searchFiltersSchema,
  /** Opaque position from a previous answer (nextCursor/prevCursor); absent for the first page. */
  cursor: z.string().min(1).max(200).optional(),
  /** The standalone search price the user was shown; a different current price is refused and charges nothing. */
  confirmedCost: z.number().int().min(0),
});
export type SearchRequest = z.output<typeof searchRequestSchema>;

export const creatorCardSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  platform: creatorPlatformSchema,
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  niches: z.array(z.string()),
  tags: z.array(z.string()),
  verified: z.boolean(),
  followers: z.number().int().nullable(),
  engagementRate: z.number().nullable(),
  authenticityScore: z.number().int().nullable(),
  fakeFollowerPct: z.number().nullable(),
  hasContact: z.boolean(),
  contactAvailability: contactAvailabilitySchema,
  followersFreshness: freshnessSchema,
  fitScore: z.number().int().min(0).max(100),
  fitLabel: fitLabelSchema,
});
export type CreatorCard = z.output<typeof creatorCardSchema>;

/**
 * Why a catalogue result matched (CAT-005): the query concept or word, the form found and the field it was found in.
 * `exact: false` marks a close spelling of the creator's name. An empty list means the cause is not shown, not that the
 * creator did not match. It explains a match; it never changes the order.
 */
export const matchReasonSchema = z.object({
  term: z.string(),
  matched: z.string(),
  field: z.enum(["name", "handle", "niche", "city", "tag", "bio"]),
  exact: z.boolean(),
});
export type MatchReason = z.output<typeof matchReasonSchema>;
export const searchResultSchema = creatorCardSchema.extend({ matchedOn: z.array(matchReasonSchema) });
export type SearchResult = z.output<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number().int(),
  /** 1-based page number for display only; pages are requested with the cursors. */
  page: z.number().int(),
  pageSize: z.number().int(),
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  fewResults: z.boolean(),
  /** What was searched: the topic words and any filters read from the text (not the ones the user set). */
  understood: z.object({
    text: z.string(),
    filters: z.object({ platform: creatorPlatformSchema.optional(), followersMin: z.number().int().optional(), followersMax: z.number().int().optional(), engagementMin: z.number().optional() }),
  }),
  /** Whether this call started a new logical search and paid for it; further pages and repeats inside the window are free. */
  charged: z.boolean(),
  creditsCharged: z.number().int().nonnegative(),
});
export type SearchResponse = z.output<typeof searchResponseSchema>;

export const interpretRequestSchema = z.object({ text: z.string().trim().min(1).max(300) });
export const interpretResponseSchema = z.object({ chips: searchFiltersShape, keywords: z.array(z.string()) });
export type InterpretResponse = z.output<typeof interpretResponseSchema>;

export const lookupQuerySchema = z.object({ q: z.string().trim().min(2).max(300) });
export const lookupResponseSchema = z.object({
  matches: z.array(
    z.object({ id: z.uuid(), displayName: z.string(), handle: z.string(), platform: creatorPlatformSchema, avatarUrl: z.string().nullable() }),
  ),
  /** A supported profile link MUSHIN does not know yet: it can be added for `cost` credits (spec §7). */
  addable: z.object({ platform: creatorPlatformSchema, handle: z.string(), url: z.string(), cost: z.number().int() }).nullable().default(null),
});
export type LookupResponse = z.output<typeof lookupResponseSchema>;

export const savedSearchSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  queryText: z.string(),
  filters: searchFiltersShape,
  createdAt: iso,
});
export type SavedSearch = z.output<typeof savedSearchSchema>;
export const savedSearchCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  queryText: z.string().trim().max(300).default(""),
  filters: searchFiltersSchema,
});
export const savedSearchListSchema = z.object({ searches: z.array(savedSearchSchema) });

export const evidenceItemSchema = z.object({ signal: z.string(), detail: z.string(), weight: z.number() });
export type EvidenceItem = z.output<typeof evidenceItemSchema>;
const metricTimes = z.object({ followers: iso.nullable(), engagement: iso.nullable(), audience: iso.nullable() });
export const creatorProfileSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  platform: creatorPlatformSchema,
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  niches: z.array(z.string()),
  tags: z.array(z.string()),
  verified: z.boolean(),
  profiles: z.array(
    z.object({
      platform: creatorPlatformSchema,
      handle: z.string(),
      url: z.string(),
      followers: z.number().int().nullable(),
      following: z.number().int().nullable(),
      posts: z.number().int().nullable(),
      engagementRate: z.number().nullable(),
      avgLikes: z.number().int().nullable(),
      avgComments: z.number().int().nullable(),
      avgViews: z.number().int().nullable(),
      bio: z.string().nullable(),
      freshness: z.object({ followers: freshnessSchema, engagement: freshnessSchema, audience: freshnessSchema }),
      updatedAt: metricTimes,
    }),
  ),
  summary: z.object({
    status: z.enum(["ready", "generating", "unavailable"]),
    text: z.string().nullable(),
    model: z.string().nullable(),
    generatedAt: iso.nullable(),
  }),
  // A score is never shown without the evidence that produced it (SRS REQ-01.02, §5.5).
  authenticity: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("assessed"),
      score: z.number().int().min(0).max(100),
      fakeFollowerPct: z.number().nullable(),
      evidence: z.array(evidenceItemSchema).min(1),
      assessedAt: iso,
    }),
    z.object({ status: z.literal("not_assessed") }),
    z.object({ status: z.literal("pending") }),
    z.object({ status: z.literal("insufficient_data") }),
    /** Not computed for this source until its policy allows it (DATA-004: YouTube API data). */
    z.object({ status: z.literal("restricted"), reason: z.literal("youtube_api_policy") }),
  ]),
  contacts: z.array(z.object({
    id: z.uuid(), kind: z.enum(["email", "phone"]), masked: z.string(), trust: z.string(), value: z.string().nullable(),
    /** Where it was found and when, and what has been established about it (with the latest check's outcome). */
    source: z.string(), firstSeenAt: iso, lastSeenAt: iso, status: contactStatusSchema, checkedAt: iso.nullable(), checkDetail: z.string().nullable(),
  })),
  contactAvailability: contactAvailabilitySchema,
  revealed: z.boolean(),
  revealCost: z.number().int(),
  refreshCost: z.number().int(),
  linkedAccounts: z.array(z.object({ platform: z.enum(["instagram", "tiktok", "youtube", "website"]), url: z.string() })),
  lastScrapedAt: iso.nullable(),
  minorProtected: z.boolean(),
  hasContacts: z.boolean(),
  mergedInto: z.uuid().nullable(),
});
export type CreatorProfile = z.output<typeof creatorProfileSchema>;

export const revealRequestSchema = z.object({ confirmedCost: z.number().int().min(1) });
export const revealResponseSchema = z.object({
  contacts: z.array(z.object({ id: z.uuid(), kind: z.enum(["email", "phone"]), value: z.string(), trust: z.string() })),
  charged: z.boolean(),
});
export type RevealResponse = z.output<typeof revealResponseSchema>;
