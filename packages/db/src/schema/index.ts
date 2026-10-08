import {
  billingPayments,
  billingSchedule,
  billingSettings,
  checkouts,
  creditActionCosts,
  creditLedger,
  creditLots,
  creditReservations,
  entitlementUsage,
  plans,
  subscriptions,
  topupPacks,
  webhookEvents,
} from "./billing";
import { users, workspaceMembers, workspaces } from "./identity";
import { idempotencyKeys, outbox, providerCalls } from "./platform";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./billing";
export * from "./identity";
export * from "./platform";
export * from "./staff";

/** Every Drizzle table; the drift test compares each one with the live database. */
export const ALL_TABLES = [
  users,
  workspaces,
  workspaceMembers,
  staffUsers,
  staffSessions,
  auditLog,
  outbox,
  providerCalls,
  idempotencyKeys,
  plans,
  topupPacks,
  creditActionCosts,
  billingSettings,
  webhookEvents,
  billingSchedule,
  subscriptions,
  checkouts,
  billingPayments,
  creditLots,
  creditReservations,
  creditLedger,
  entitlementUsage,
];
