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
  contactChecks,
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
import { users, workspaceInvitations, workspaceMembers, workspaces } from "./identity";
import { listMembers, lists } from "./lists";
import { campaignCreators, campaigns, outreachEvents } from "./campaigns";
import { supportAccessRequests, supportMessages, supportTickets } from "./support";
import { idempotencyKeys, outbox, providerCalls, providerControls } from "./platform";
import { approvals, auditLog, staffSessions, staffUsers, webauthnChallenges, webauthnCredentials } from "./staff";

export * from "./audience";
export * from "./billing";
export * from "./creators";
export * from "./discovery";
export * from "./identity";
export * from "./lists";
export * from "./campaigns";
export * from "./support";
export * from "./platform";
export * from "./staff";

/** Every Drizzle table; the drift test compares each one with the live database. */
export const ALL_TABLES = [
  users,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  staffUsers,
  staffSessions,
  auditLog,
  webauthnCredentials,
  webauthnChallenges,
  approvals,
  outbox,
  providerCalls,
  providerControls,
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
  contactChecks,
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
  supportTickets,
  supportMessages,
  supportAccessRequests,
  removalRequests,
  creatorSuppressions,
  audienceEstimates,
  audienceJobs,
];
