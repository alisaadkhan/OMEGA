import { z } from "zod";

/**
 * Staff view of one customer account (owner, 22 Nov: Users page "see, assign plan, add credits, view activity") and the
 * subscription totals across accounts. Every number is read from the database; nothing is estimated.
 */
const iso = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const planIdSchema = z.enum(["explorer", "growth", "scale"]);

export const staffAccountSchema = z.object({
  workspaceId: z.uuid(),
  plan: z
    .object({
      id: planIdSchema.nullable(),
      name: z.string().nullable(),
      status: z.string(),
      complimentary: z.boolean(),
      periodEnd: iso.nullable(),
      trialEndsAt: iso.nullable(),
      monthlyCredits: count.nullable(),
    })
    .nullable(),
  credits: z.object({ available: z.number().int(), reserved: count, spent30d: count, granted30d: count }),
  /** Newest first, at most 25 rows of the workspace's credit ledger (holds and releases left out). */
  ledger: z.array(z.object({ id: z.uuid(), kind: z.string(), action: z.string().nullable(), amount: z.number().int(), note: z.string().nullable(), byStaff: z.boolean(), createdAt: iso })),
  members: z.array(z.object({ name: z.string().nullable(), email: z.string(), role: z.string(), joinedAt: iso })),
  /** Everything the account did (owner, 22 Nov: "a user's entire history"). Search text is never stored, only counts. */
  history: z.object({
    lists: z.array(z.object({ id: z.uuid(), name: z.string(), creators: count, createdAt: iso })),
    campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string(), creators: count, createdAt: iso })),
    searches: z.object({ total: count, last30Days: count, charged: count, recent: z.array(z.object({ at: iso, results: count, charged: z.boolean(), filters: count, hadText: z.boolean() })) }),
    savedSearches: z.array(z.object({ name: z.string(), queryText: z.string(), createdAt: iso })),
    jobs: z.array(z.object({ id: z.uuid(), kind: z.string(), status: z.string(), brief: z.string().nullable(), handle: z.string().nullable(), creditsCharged: count, createdAt: iso })),
    payments: z.array(z.object({ kind: z.string(), amountMinor: z.number().int(), currency: z.string(), status: z.string(), refundedMinor: z.number().int(), createdAt: iso })),
    revealedContacts: count,
    emailsSent: count,
    /** Staff suspended this account: its people are refused at sign-in. */
    suspended: z.boolean(),
  }),
});
export type StaffAccount = z.infer<typeof staffAccountSchema>;

/** Super Admin only, with the hardware key: the plan for `months` with no payment (a complimentary subscription). */
export const staffPlanGrantSchema = z.object({ planId: planIdSchema, months: z.number().int().min(1).max(24), reason: z.string().trim().min(12).max(1000) });
export const staffPlanGrantResultSchema = z.object({ planId: planIdSchema, periodEnd: iso, monthlyCredits: count });

export const staffSubscriptionsSchema = z.object({
  plans: z.array(z.object({ id: planIdSchema, name: z.string(), monthlyCredits: count, displayCurrency: z.string(), displayMonthlyMinor: count, accounts: count, paying: count, complimentary: count, trialing: count })),
  accounts: count,
  withoutPlan: count,
  /** Payments the payment provider recorded, newest first (empty until a provider is live). */
  payments: z.array(z.object({ id: z.uuid(), workspaceId: z.uuid(), workspaceName: z.string(), kind: z.string(), amountMinor: z.number().int(), currency: z.string(), status: z.string(), refundedMinor: z.number().int(), createdAt: iso })),
  at: iso,
});
export type StaffSubscriptions = z.infer<typeof staffSubscriptionsSchema>;

/** Every outside service MUSHIN can use, with backups, and whether this server has it set (never the key itself). */
export const staffIntegrationsSchema = z.object({
  integrations: z.array(
    z.object({
      key: z.string(),
      group: z.enum(["AI", "Creator data", "Search", "Email", "Payments", "Platform"]),
      name: z.string(),
      purpose: z.string(),
      role: z.enum(["primary", "backup"]),
      configured: z.boolean(),
    }),
  ),
});
export type StaffIntegrations = z.infer<typeof staffIntegrationsSchema>;

export const staffSuspendSchema = z.object({ reason: z.string().trim().min(12).max(1000) });
export const staffSuspendResultSchema = z.object({ suspended: z.boolean(), people: count });

/** Plan terms and credit costs (owner, 22 Nov). The provider's charge is shown, not edited. */
export const staffPricingSchema = z.object({
  plans: z.array(
    z.object({
      id: z.enum(["explorer", "growth", "scale"]),
      name: z.string(),
      monthlyCredits: count,
      displayCurrency: z.string(),
      displayMonthlyMinor: count,
      chargeCurrency: z.string(),
      chargeMonthlyMinor: count,
    }),
  ),
  actions: z.array(z.object({ action: z.string(), credits: count, updatedAt: iso })),
});
export type StaffPricing = z.infer<typeof staffPricingSchema>;
export const staffPlanTermsSchema = z.object({ monthlyCredits: z.number().int().min(0).max(1_000_000), displayMonthlyMinor: z.number().int().min(0).max(1_000_000_000), reason: z.string().trim().min(12).max(1000) });
export const staffActionCostSchema = z.object({ credits: z.number().int().min(0).max(100_000), reason: z.string().trim().min(12).max(1000) });
