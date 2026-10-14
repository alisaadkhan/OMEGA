import { z } from "zod";

const count = z.number().int().nonnegative();
const day = z.iso.date();

export const analyticsQuerySchema = z
  .object({ from: day, to: day })
  .refine((v) => v.to >= v.from, { message: "The end date must be on or after the start date", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { message: "Choose a period of at most a year", path: ["from"] });
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

/**
 * Aggregates of persisted workspace data only (canonical frontend spec page 12): no estimated reach, ROI or response
 * rates are computed. Pipeline figures are the current state; outreach, discovery and credit figures are for the period.
 */
export const analyticsSummarySchema = z.object({
  period: z.object({ from: day, to: day }),
  campaigns: z.object({ total: count, byStatus: z.record(z.enum(["draft", "active", "paused", "completed"]), count) }),
  pipeline: z.object({
    byStage: z.record(z.enum(["identified", "contacted", "negotiating", "confirmed"]), count),
    declined: count,
    byContent: z.record(z.enum(["none", "content_pending", "posted", "completed"]), count),
    agreedFeesMinor: z.number().int().nonnegative(),
    budgetMinor: z.number().int().nonnegative(),
    currency: z.literal("PKR"),
  }),
  outreach: z.object({
    total: count,
    byOutcome: z.record(z.enum(["attempted", "replied", "no_response", "declined", "agreed"]), count),
    byChannel: z.record(z.string(), count),
    creatorsContacted: count,
  }),
  lists: z.object({ total: count, savedCreators: count }),
  discovery: z.object({ liveRuns: count, creatorsDelivered: count, newCreators: count }),
  credits: z.object({ spent: count, refunded: count }),
});
export type AnalyticsSummary = z.output<typeof analyticsSummarySchema>;
