import { z } from "zod";
import { creatorPlatformSchema } from "./search";

const iso = z.iso.datetime();
const count = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1);

/** Shown with every estimate: MUSHIN's own calculation from public data, not platform analytics. */
export const AUDIENCE_ESTIMATE_LABEL = "Modeled estimate — not verified by the platform";

/** One category of a distribution: its count in the classified sample, its share and a 95% Wilson interval. */
export const audienceShareSchema = z.object({
  code: z.string().regex(/^([A-Z]{2}|OTHER)$/),
  count,
  share: fraction,
  low: fraction,
  high: fraction,
});
export type AudienceShare = z.output<typeof audienceShareSchema>;

export const audienceDimensionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("estimated"),
    /** Never "high": the method is not validated against ground truth yet. */
    confidence: z.enum(["low", "moderate"]),
    classified: count,
    shares: z.array(audienceShareSchema),
    /** Shares are shown rounded to this many percentage points (5 for small samples). */
    displayStep: z.union([z.literal(1), z.literal(5)]),
  }),
  z.object({ status: z.literal("insufficient"), classified: count, required: count, reason: z.string() }),
  z.object({ status: z.literal("not_estimable"), reason: z.string() }),
]);
export type AudienceDimension = z.output<typeof audienceDimensionSchema>;

export const audienceSampleSchema = z.object({
  windowDays: count,
  videosConsidered: count,
  videosSampled: count,
  videosCommentsOff: count,
  commentsRead: count,
  uniqueCommenters: count,
  excludedCreator: count,
  excludedLikelySpam: count,
  /** Commenters whose public account states a country. */
  classifiable: count,
  coverage: fraction,
});

/**
 * Where audience figures come from. Only creator-authorised platform analytics may ever be "verified_analytics";
 * a vendor's modelled figures are "provider_estimate"; MUSHIN's own calculation is "mushin_estimate".
 */
export const audienceProvenanceSchema = z.enum(["verified_analytics", "provider_estimate", "mushin_estimate"]);
export type AudienceProvenance = z.output<typeof audienceProvenanceSchema>;

/** Stored as the estimate's `result` (aggregates only) and returned as-is. */
export const audienceEstimateBodySchema = z.object({
  methodVersion: z.string(),
  /** Results stored before this field existed are MUSHIN's own commenter estimates. */
  provenance: audienceProvenanceSchema.default("mushin_estimate"),
  label: z.string(),
  population: z.literal("sampled_recent_commenters"),
  outcome: z.enum(["estimated", "insufficient"]),
  source: z.string(),
  sample: audienceSampleSchema,
  country: audienceDimensionSchema,
  age: audienceDimensionSchema,
  gender: audienceDimensionSchema,
  limitations: z.array(z.string()),
});
export type AudienceEstimateBody = z.output<typeof audienceEstimateBodySchema>;

export const audienceEstimateSchema = audienceEstimateBodySchema.extend({
  id: z.uuid(),
  platform: creatorPlatformSchema,
  collectedAt: iso,
  expiresAt: iso,
});
export type AudienceEstimate = z.output<typeof audienceEstimateSchema>;

export const audienceJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  outcome: z.enum(["estimated", "insufficient"]).nullable(),
  cost: count,
  creditsCharged: count,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
});
export type AudienceJob = z.output<typeof audienceJobSchema>;

/** GET /v1/creators/:id/audience — nothing is computed or charged by reading it. */
export const audienceStateSchema = z.object({
  creatorId: z.uuid(),
  platform: creatorPlatformSchema.nullable(),
  availability: z.enum(["available", "source_disabled", "platform_unsupported", "creator_protected"]),
  availabilityMessage: z.string().nullable(),
  /** The current price of a new estimate, in credits (the quote the user confirms). */
  cost: count,
  /** This workspace's latest request for the creator. */
  job: audienceJobSchema.nullable(),
  /** The latest unexpired estimate this workspace has access to; reusing it is free. */
  estimate: audienceEstimateSchema.nullable(),
});
export type AudienceState = z.output<typeof audienceStateSchema>;

export const audienceRequestSchema = z.object({ confirmedCost: z.number().int().min(1) });
export type AudienceRequest = z.output<typeof audienceRequestSchema>;
