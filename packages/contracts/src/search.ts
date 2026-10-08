import { z } from "zod";

export const creatorPlatformSchema = z.enum(["instagram", "tiktok", "youtube"]);
export const freshnessSchema = z.enum(["current", "aging", "stale"]);
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
  page: z.number().int().min(1).max(50).default(1),
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
  followers: z.number().int(),
  engagementRate: z.number().nullable(),
  authenticityScore: z.number().int().nullable(),
  fakeFollowerPct: z.number().nullable(),
  hasContact: z.boolean(),
  followersFreshness: freshnessSchema,
  fitScore: z.number().int().min(0).max(100),
  fitLabel: fitLabelSchema,
});
export type CreatorCard = z.output<typeof creatorCardSchema>;

export const searchResponseSchema = z.object({
  results: z.array(creatorCardSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  fewResults: z.boolean(),
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
const confidence = z.enum(["low", "medium", "high"]);
const share = z.object({ label: z.string(), value: z.number(), confidence });
export const audienceDataSchema = z.object({
  age: z.array(share),
  gender: z.object({ female: z.number(), male: z.number(), confidence }).nullable(),
  cities: z.array(share),
  countries: z.array(z.object({ code: country, value: z.number(), confidence })),
  source: z.string(),
});
export type AudienceData = z.output<typeof audienceDataSchema>;

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
      followers: z.number().int(),
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
  ]),
  contacts: z.array(z.object({ id: z.uuid(), kind: z.enum(["email", "phone"]), masked: z.string(), trust: z.string(), value: z.string().nullable() })),
  revealed: z.boolean(),
  revealCost: z.number().int(),
  minorProtected: z.boolean(),
  hasContacts: z.boolean(),
  mergedInto: z.uuid().nullable(),
});
export type CreatorProfile = z.output<typeof creatorProfileSchema>;

export const audienceResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("estimated"), audience: audienceDataSchema, updatedAt: iso }),
  z.object({ status: z.literal("not_assessed") }),
]);
export type AudienceResponse = z.output<typeof audienceResponseSchema>;

export const revealRequestSchema = z.object({ confirmedCost: z.number().int().min(1) });
export const revealResponseSchema = z.object({
  contacts: z.array(z.object({ id: z.uuid(), kind: z.enum(["email", "phone"]), value: z.string(), trust: z.string() })),
  charged: z.boolean(),
});
export type RevealResponse = z.output<typeof revealResponseSchema>;
