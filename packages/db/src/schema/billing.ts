import { sql } from "drizzle-orm";
import { bigint, boolean, char, date, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const platform = pgSchema("platform");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });

export type PlanEntitlements = {
  audienceViewsPerMonth: number | null;
  outreachEmailsPerMonth: number | null;
  campaignLimit: number | null;
  export: boolean;
};

export const plans = platform.table("plans", {
  id: text("id", { enum: ["explorer", "growth", "scale"] }).primaryKey(),
  name: text("name").notNull(),
  monthlyCredits: integer("monthly_credits").notNull(),
  displayCurrency: char("display_currency", { length: 3 }).notNull().default("PKR"),
  displayMonthlyMinor: money("display_monthly_minor").notNull(),
  displayYearlyMonthlyMinor: money("display_yearly_monthly_minor").notNull(),
  chargeCurrency: char("charge_currency", { length: 3 }).notNull().default("USD"),
  chargeMonthlyMinor: money("charge_monthly_minor").notNull(),
  chargeYearlyMinor: money("charge_yearly_minor").notNull(),
  entitlements: jsonb("entitlements").$type<PlanEntitlements>().notNull(),
  paddlePriceIds: jsonb("paddle_price_ids").$type<{ month: string; year: string }>().notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const topupPacks = platform.table("topup_packs", {
  id: text("id").primaryKey(),
  credits: integer("credits").notNull(),
  displayCurrency: char("display_currency", { length: 3 }).notNull().default("PKR"),
  displayPriceMinor: money("display_price_minor").notNull(),
  chargeCurrency: char("charge_currency", { length: 3 }).notNull().default("USD"),
  chargePriceMinor: money("charge_price_minor").notNull(),
  /** Unused since 0030: top-up credits never expire. */
  validityMonths: integer("validity_months"),
  paddlePriceId: text("paddle_price_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditActionCosts = platform.table("credit_action_costs", {
  action: text("action", { enum: ["search_existing", "find_new", "live_creator", "reveal_contact", "refresh_data", "refresh_tiktok", "audience_estimate"] }).primaryKey(),
  credits: integer("credits").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const billingSettings = platform.table("billing_settings", {
  id: boolean("id").primaryKey().default(true),
  trialDays: integer("trial_days").notNull(),
  trialCredits: integer("trial_credits").notNull(),
  trialPlanId: text("trial_plan_id", { enum: ["explorer", "growth", "scale"] }).notNull(),
  reservationTtlMinutes: integer("reservation_ttl_minutes").notNull(),
  meterAmberPct: integer("meter_amber_pct").notNull(),
  meterRedPct: integer("meter_red_pct").notNull(),
  trialEndingNoticeDays: integer("trial_ending_notice_days").notNull(),
  /** Off until the owner approves annual prices (OD-002): yearly checkouts and changes are refused. */
  annualBillingEnabled: boolean("annual_billing_enabled").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const webhookEvents = platform.table("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
  error: text("error"),
});

export const billingJobs = [
  "release_abandoned",
  "expire_lots",
  "end_trials",
  "trial_notices",
  "monthly_grants",
  "scheduled_changes",
  "reconcile",
  "mock_renewals",
  "comp_period_end",
] as const;

/** Due-work index: workspace ids and due times only (SRS §2.5). */
export const billingSchedule = platform.table(
  "billing_schedule",
  {
    workspaceId: uuid("workspace_id").notNull(),
    job: text("job", { enum: billingJobs }).notNull(),
    dueAt: ts("due_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.job] })],
);

const statusEnum = ["trialing", "active", "past_due", "canceled", "expired"] as const;
const intervalEnum = ["month", "year"] as const;
const planEnum = ["explorer", "growth", "scale"] as const;
const actionEnum = ["search_existing", "find_new", "live_creator", "reveal_contact", "refresh_data", "refresh_tiktok", "audience_estimate"] as const;

export const subscriptions = wp.table("subscriptions", {
  workspaceId: uuid("workspace_id").primaryKey(),
  planId: text("plan_id", { enum: planEnum }),
  billingInterval: text("billing_interval", { enum: intervalEnum }),
  status: text("status", { enum: statusEnum }).notNull(),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  trialEndsAt: ts("trial_ends_at"),
  trialEndingNotifiedAt: ts("trial_ending_notified_at"),
  nextCreditGrantAt: ts("next_credit_grant_at"),
  paddleSubscriptionId: text("paddle_subscription_id"),
  paddleCustomerId: text("paddle_customer_id"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  scheduledPlanId: text("scheduled_plan_id", { enum: planEnum }),
  scheduledInterval: text("scheduled_interval", { enum: intervalEnum }),
  providerEventAt: ts("provider_event_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const checkouts = wp.table("checkouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  kind: text("kind", { enum: ["subscription", "topup"] }).notNull(),
  planId: text("plan_id", { enum: planEnum }),
  billingInterval: text("billing_interval", { enum: intervalEnum }),
  topupPackId: text("topup_pack_id"),
  priceId: text("price_id").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: text("status", { enum: ["open", "paid", "failed", "expired"] }).notNull().default("open"),
  providerCheckoutId: text("provider_checkout_id"),
  hostedUrl: text("hosted_url"),
  requestedBy: uuid("requested_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const billingPayments = wp.table("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  paddleTransactionId: text("paddle_transaction_id").notNull(),
  kind: text("kind", { enum: ["subscription", "topup"] }).notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: text("status").notNull(),
  invoiceUrl: text("invoice_url"),
  checkoutId: uuid("checkout_id"),
  /** Amount refunded or charged back so far (0038). */
  refundedMinor: money("refunded_minor").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Refunds and chargebacks applied once each (0038; provisional policy until OD-009). */
export const paymentAdjustments = wp.table("payment_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  providerAdjustmentId: text("provider_adjustment_id").notNull(),
  action: text("action", { enum: ["refund", "chargeback"] }).notNull(),
  amountMinor: money("amount_minor").notNull(),
  creditsRemoved: integer("credits_removed").notNull(),
  creditsShortfall: integer("credits_shortfall").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const creditLots = wp.table("credit_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  source: text("source", { enum: ["trial", "monthly", "topup", "adjustment"] }).notNull(),
  amount: integer("amount").notNull(),
  remaining: integer("remaining").notNull(),
  /** Null = never expires (top-ups only, constraint credit_lots_expiry_rule). */
  expiresAt: ts("expires_at"),
  paymentId: uuid("payment_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditReservations = wp.table("credit_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  amount: integer("amount").notNull(),
  action: text("action", { enum: actionEnum }).notNull(),
  confirmedCost: integer("confirmed_cost").notNull(),
  status: text("status", { enum: ["held", "committed", "released", "expired"] }).notNull(),
  /** Which lots the hold may be spent from, fixed when it is placed (migration 0007). */
  spendScope: text("spend_scope", { enum: ["all", "topup_only"] }).notNull().default("all"),
  expiresAt: ts("expires_at").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  committedAt: ts("committed_at"),
  releasedAt: ts("released_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditLedger = wp.table("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  amount: integer("amount").notNull(),
  kind: text("kind", { enum: ["grant", "spend", "refund", "expire", "adjust", "reserve", "release"] }).notNull(),
  action: text("action", { enum: actionEnum }),
  lotId: uuid("lot_id"),
  reservationId: uuid("reservation_id"),
  sourceRef: text("source_ref"),
  actorUserId: uuid("actor_user_id"),
  actorStaffId: uuid("actor_staff_id"),
  note: text("note"),
  createdAt: ts("created_at").notNull().default(sql`now()`),
});

export const entitlementUsage = wp.table(
  "entitlement_usage",
  {
    workspaceId: uuid("workspace_id").notNull(),
    key: text("key", { enum: ["audience_views", "outreach_emails"] }).notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key, t.periodStart] })],
);
