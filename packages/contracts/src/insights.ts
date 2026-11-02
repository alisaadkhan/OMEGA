import { z } from "zod";

const iso = z.iso.datetime({ offset: true });
const platform = z.enum(["youtube", "instagram", "tiktok"]);

// ── Product reviews ("Leave a review"; no email is sent per review) ──
export const productReviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
  /** The page the review was left on, as a short key (e.g. "search"). */
  page: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
});
export type ProductReviewCreate = z.infer<typeof productReviewCreateSchema>;
export const productReviewCreatedSchema = z.object({ id: z.uuid(), createdAt: iso });

export const productReviewStatusSchema = z.enum(["new", "reviewed", "archived"]);
export const staffProductReviewSchema = z.object({
  id: z.uuid(),
  workspaceName: z.string(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  page: z.string().nullable(),
  status: productReviewStatusSchema,
  createdAt: iso,
  statusChangedAt: iso.nullable(),
  statusChangedBy: z.string().nullable(),
});
export const staffProductReviewListSchema = z.object({ reviews: z.array(staffProductReviewSchema) });
export const staffProductReviewUpdateSchema = z.object({ status: productReviewStatusSchema });

// ── Usage analytics (staff) ──
export const analyticsWindowSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const creatorViewStatsSchema = z.object({
  days: z.number().int(),
  trackedSince: iso.nullable(),
  byPlatform: z.array(z.object({ platform, views: z.number().int(), uniqueViewers: z.number().int(), creatorsViewed: z.number().int() })),
  mostViewed: z.array(z.object({ creatorId: z.uuid(), displayName: z.string(), platform, views: z.number().int(), uniqueViewers: z.number().int() })),
  leastViewed: z.array(z.object({ creatorId: z.uuid(), displayName: z.string(), platform, views: z.number().int() })),
});
export type CreatorViewStats = z.infer<typeof creatorViewStatsSchema>;
export const searchStatsSchema = z.object({
  days: z.number().int(),
  trackedSince: iso.nullable(),
  searches: z.number().int(),
  zeroResult: z.number().int(),
  zeroResultRate: z.number().nullable(),
  charged: z.number().int(),
  byBackend: z.record(z.string(), z.number().int()),
  daily: z.array(z.object({ date: z.string(), searches: z.number().int(), zeroResult: z.number().int() })),
});
export type SearchStats = z.infer<typeof searchStatsSchema>;

// ── Support performance (Super Admin) ──
export const supportPerformanceSchema = z.object({
  days: z.number().int(),
  historySince: iso.nullable(),
  backlog: z.number().int(),
  people: z.array(
    z.object({
      staffId: z.uuid().nullable(),
      name: z.string(),
      workload: z.number().int(),
      resolved: z.number().int(),
      firstResponseMinutes: z.number().nullable(),
      resolutionMinutes: z.number().nullable(),
      pending: z.number().int(),
      reopened: z.number().int(),
    }),
  ),
});
export type SupportPerformance = z.infer<typeof supportPerformanceSchema>;
