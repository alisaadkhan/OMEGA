import { z } from "zod";

export const creditActionSchema = z.enum(["search_existing", "find_new", "live_creator", "reveal_contact", "refresh_data", "refresh_tiktok", "audience_estimate"]);
export type CreditAction = z.infer<typeof creditActionSchema>;

export const planIdSchema = z.enum(["explorer", "growth", "scale"]);
export type PlanId = z.infer<typeof planIdSchema>;

export const billingIntervalSchema = z.enum(["month", "year"]);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const subscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "canceled", "expired"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const meterStateSchema = z.enum(["normal", "amber", "red"]);
export type MeterState = z.infer<typeof meterStateSchema>;

export const lostAccessItemSchema = z.enum([
  "search_existing",
  "find_new",
  "reveal_contact",
  "refresh_data",
  "monthly_credits",
  "outreach",
  "audience_details",
  "export",
]);
export type LostAccessItem = z.infer<typeof lostAccessItemSchema>;

export const entitlementsSchema = z.object({
  audienceViewsPerMonth: z.number().int().nonnegative().nullable(),
  outreachEmailsPerMonth: z.number().int().nonnegative().nullable(),
  campaignLimit: z.number().int().nonnegative().nullable(),
  export: z.boolean(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

/**
 * Capabilities switched on or off for every workspace by the server, independent of plans: audience details need an
 * approved data source, outreach email a configured and authorised provider. A plan entitlement is usable only when
 * the capability is also available.
 */
export const capabilitiesSchema = z.object({
  audienceDetails: z.boolean(),
  /** "test": sends are recorded through a mock provider and nothing is delivered (development only). */
  outreachEmail: z.enum(["off", "test", "live"]),
  export: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/**
 * Live Discovery settlement (owner decisions 2026-10-14 #1 and #3; audit BIL-01): when a run delivers at least one
 * creator it costs the base fee (action find_new) plus each new creator (live_creator), at least this many credits when
 * TikTok is in scope, and never more than the confirmed quote. If it delivers nothing it costs nothing.
 */
export const TIKTOK_LIVE_MINIMUM_CREDITS = 100;

export const moneySchema = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });

export const billingSummarySchema = z.object({
  plan: z.object({ id: planIdSchema, name: z.string(), monthlyCredits: z.number().int().positive() }).nullable(),
  interval: billingIntervalSchema.nullable(),
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.iso.datetime().nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
  trialDaysLeft: z.number().int().nonnegative().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  scheduledChange: z.object({ planId: planIdSchema, interval: billingIntervalSchema }).nullable(),
  balance: z.object({
    available: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    base: z.number().int().nonnegative(),
    meter: meterStateSchema,
  }),
  canPurchase: z.boolean(),
  lostAccess: z.array(lostAccessItemSchema),
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;

export const billingPlansSchema = z.object({
  plans: z.array(
    z.object({
      id: planIdSchema,
      name: z.string(),
      monthlyCredits: z.number().int().positive(),
      display: z.object({ monthly: moneySchema, yearlyPerMonth: moneySchema }),
      charge: z.object({ monthly: moneySchema, yearly: moneySchema }),
      entitlements: entitlementsSchema,
    }),
  ),
  topupPacks: z.array(
    z.object({
      id: z.string(),
      credits: z.number().int().positive(),
      display: moneySchema,
      charge: moneySchema,
      /** Null: top-up credits never expire. */
      validityMonths: z.number().int().positive().nullable(),
    }),
  ),
  actionCosts: z.record(creditActionSchema, z.number().int().nonnegative()),
  /** False until the owner approves annual prices (OD-002): yearly prices are not offered and yearly checkout is refused. */
  annualBilling: z.boolean(),
  /** Minimum charge of a successful Live Discovery run with TikTok in scope (see TIKTOK_LIVE_MINIMUM_CREDITS). */
  liveTiktokMinimum: z.number().int().positive(),
  availability: capabilitiesSchema,
});
export type BillingPlans = z.infer<typeof billingPlansSchema>;

export const ledgerKindSchema = z.enum(["grant", "spend", "refund", "expire", "adjust", "reserve", "release"]);
export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  kind: ledgerKindSchema,
  amount: z.number().int(),
  action: creditActionSchema.nullable(),
  lotSource: z.enum(["trial", "monthly", "topup", "adjustment"]).nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const ledgerPageSchema = z.object({ entries: z.array(ledgerEntrySchema), nextCursor: z.string().nullable() });
export type LedgerPage = z.infer<typeof ledgerPageSchema>;
export const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const invoicesResponseSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["subscription", "topup"]),
      amount: moneySchema,
      status: z.string(),
      invoiceUrl: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type InvoicesResponse = z.infer<typeof invoicesResponseSchema>;

export const checkoutRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), planId: planIdSchema, interval: billingIntervalSchema }),
  z.object({ kind: z.literal("topup"), packId: z.string().min(1).max(50) }),
]);
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export const checkoutResponseSchema = z.object({ checkoutId: z.uuid(), url: z.url() });

export const planChangeRequestSchema = z.object({ planId: planIdSchema, interval: billingIntervalSchema });
export type PlanChangeRequest = z.infer<typeof planChangeRequestSchema>;
export const planChangeResponseSchema = z.object({
  change: z.enum(["upgrade", "downgrade", "cancel"]),
  effective: z.enum(["now", "period_end"]),
});
export type PlanChangeResponse = z.infer<typeof planChangeResponseSchema>;
