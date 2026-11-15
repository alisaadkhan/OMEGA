import { z } from "zod";

/**
 * Creator profile reviews (owner directive 2026-11-15 §3): a customer confirms a creator ("valid") or flags a problem
 * ("invalid", with a reason) from a card or the profile, in database search or Live Discovery. Flags reach the staff
 * Catalogue review; staff resolve them (fix or exclude the creator) or dismiss them.
 */
export const CREATOR_REVIEW_REASONS = ["not_individual_creator", "wrong_location", "wrong_niche", "broken_profile", "other"] as const;
export const creatorReviewReasonSchema = z.enum(CREATOR_REVIEW_REASONS);
export type CreatorReviewReason = z.infer<typeof creatorReviewReasonSchema>;

/** The words customers and staff see for each reason. */
export const CREATOR_REVIEW_REASON_LABEL: Record<CreatorReviewReason, string> = {
  not_individual_creator: "Not an individual creator (brand or celebrity)",
  wrong_location: "Wrong location / not Pakistani",
  wrong_niche: "Wrong niche",
  broken_profile: "Broken or outdated profile",
  other: "Other",
};

export const creatorReviewRequestSchema = z
  .object({
    verdict: z.enum(["valid", "invalid"]),
    reason: creatorReviewReasonSchema.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    platform: z.enum(["instagram", "tiktok", "youtube"]).nullable().optional(),
    sourceMode: z.enum(["db_search", "live_discovery"]),
  })
  .superRefine((v, ctx) => {
    if (v.verdict === "invalid" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose what is wrong with this profile." });
    if (v.verdict === "valid" && v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A confirmation has no reason." });
  });
export type CreatorReviewRequest = z.infer<typeof creatorReviewRequestSchema>;

export const creatorReviewResponseSchema = z.object({ id: z.uuid(), status: z.enum(["pending", "resolved", "dismissed"]) });
export type CreatorReviewResponse = z.infer<typeof creatorReviewResponseSchema>;

// ── Staff queue ──

export const creatorFlagStatusSchema = z.enum(["pending", "resolved", "dismissed"]);
export const creatorFlagSchema = z.object({
  id: z.uuid(),
  creatorId: z.uuid(),
  displayName: z.string(),
  primaryPlatform: z.string(),
  handle: z.string().nullable(),
  url: z.string().nullable(),
  accountType: z.string().nullable(),
  accountTypeSource: z.string().nullable(),
  creatorStatus: z.string(),
  verdict: z.literal("invalid"),
  reason: creatorReviewReasonSchema,
  note: z.string().nullable(),
  platform: z.string().nullable(),
  sourceMode: z.enum(["db_search", "live_discovery"]),
  status: creatorFlagStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  openFlags: z.number().int(),
  confirmations: z.number().int(),
});
export type CreatorFlag = z.infer<typeof creatorFlagSchema>;
export const creatorFlagListSchema = z.object({
  items: z.array(creatorFlagSchema),
  total: z.number().int(),
  counts: z.object({ pending: z.number().int(), resolved: z.number().int(), dismissed: z.number().int() }),
});
export const creatorFlagQuerySchema = z.object({ status: creatorFlagStatusSchema.default("pending"), offset: z.coerce.number().int().min(0).max(100_000).default(0) });

/** Account types staff can exclude a flagged creator as (they leave search; never replaced by rules or the AI). */
export const STAFF_EXCLUDE_TYPES = ["CELEBRITY_PUBLIC_FIGURE", "BRAND_ACCOUNT", "BUSINESS_STORE", "MEDIA_PUBLICATION", "FAN_PAGE_AGGREGATOR", "COMPANY_CORPORATE"] as const;
export const creatorFlagDecisionSchema = z
  .object({
    action: z.enum(["resolve", "dismiss", "exclude"]),
    excludeAs: z.enum(STAFF_EXCLUDE_TYPES).optional(),
    note: z.string().trim().min(3, "Say what was done or why").max(500),
  })
  .superRefine((v, ctx) => {
    if (v.action === "exclude" && !v.excludeAs) ctx.addIssue({ code: "custom", path: ["excludeAs"], message: "Choose what kind of account this is." });
  });
export type CreatorFlagDecision = z.infer<typeof creatorFlagDecisionSchema>;
