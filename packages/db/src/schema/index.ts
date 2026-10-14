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
import {
  audienceViews,
  contactReveals,
  creatorContacts,
  creatorProfiles,
  creators,
  enrichmentSnapshots,
  niches,
  savedSearches,
  searchSettings,
  summaryRequests,
  creatorLinks,
  enrichmentSettings,
  profileMetricSnapshots,
  rawPayloads,
  creatorSuppressions,
  removalRequests,
} from "./creators";
import { audienceEstimates, audienceJobs } from "./audience";
import { discoveryCandidates, discoveryEstimates, discoveryJobs, discoveryResults, serperCache } from "./discovery";
import { users, workspaceMembers, workspaces } from "./identity";
import { listMembers, lists } from "./lists";
import { campaignCreators, campaigns, outreachEvents } from "./campaigns";
import { idempotencyKeys, outbox, providerCalls } from "./platform";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./audience";
export * from "./billing";
export * from "./creators";
export * from "./discovery";
export * from "./identity";
export * from "./lists";
export * from "./campaigns";
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
  creators,
  creatorProfiles,
  creatorContacts,
  enrichmentSnapshots,
  niches,
  searchSettings,
  summaryRequests,
  contactReveals,
  audienceViews,
  savedSearches,
  discoveryJobs,
  discoveryEstimates,
  profileMetricSnapshots,
  creatorLinks,
  rawPayloads,
  enrichmentSettings,
  discoveryResults,
  discoveryCandidates,
  serperCache,
  lists,
  listMembers,
  campaigns,
  campaignCreators,
  outreachEvents,
  removalRequests,
  creatorSuppressions,
  audienceEstimates,
  audienceJobs,
];
