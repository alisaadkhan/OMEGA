import type { JobData } from "./dispatcher";
import type { QueueName } from "./queues";

export type Schedule = { queue: QueueName; key: string; cron: string; data: JobData };

const data = (key: string, eventType: string, payload: Record<string, unknown>): JobData => ({
  eventId: `cron-${key}`,
  eventType,
  aggregateType: "system",
  aggregateId: key,
  workspaceId: null,
  requestId: null,
  payload,
});
const billing = (key: string, cron: string): Schedule => ({ queue: "billing", key, cron, data: data(key, "billing.job", { job: key }) });

/** Umbrella spec §7.3. Daily billing jobs run grants before mock renewals; downgrades run hourly, ahead of each period end. */
export const SCHEDULES: Schedule[] = [
  // Every minute, through the queue like any job: the API raises a critical alert when it stops (audit OPS-03).
  { queue: "system", key: "heartbeat", cron: "* * * * *", data: data("heartbeat", "system.heartbeat", {}) },
  // Hourly: expired idempotency keys, old rate-limit windows and expired data export files (kept at most 24 h + 1 h).
  { queue: "system", key: "reconcile_provider_runs", cron: "40 * * * *", data: data("reconcile_provider_runs", "system.reconcile_provider_runs", {}) },
  { queue: "system", key: "purge_expired", cron: "15 * * * *", data: data("purge_expired", "system.purge_expired", {}) },
  billing("release_abandoned", "* * * * *"),
  billing("expire_lots", "5 * * * *"),
  billing("end_trials", "10 * * * *"),
  billing("trial_notices", "20 * * * *"),
  billing("monthly_grants", "30 2 * * *"),
  billing("scheduled_changes", "40 * * * *"),
  billing("mock_renewals", "50 2 * * *"),
  // Complimentary plans end at their period end: no payment provider sends that event (migration 0053).
  billing("comp_period_end", "55 2 * * *"),
  billing("reconcile", "30 4 * * *"),
  { queue: "rescore-low", key: "search_reconcile", cron: "45 3 * * *", data: data("search_reconcile", "creator.reindex_all", {}) },
  { queue: "rescore-low", key: "youtube_retention", cron: "50 3 * * *", data: data("youtube_retention", "creator.youtube_retention", {}) },
  { queue: "system", key: "discovery_sweep", cron: "*/5 * * * *", data: data("discovery_sweep", "system.discovery_sweep", {}) },
  { queue: "system", key: "audience_sweep", cron: "*/5 * * * *", data: data("audience_sweep", "system.audience_sweep", {}) },
  { queue: "system", key: "purge_raw_payloads", cron: "25 3 * * *", data: data("purge_raw_payloads", "system.purge_raw_payloads", {}) },
  { queue: "system", key: "purge_search_cache", cron: "35 3 * * *", data: data("purge_search_cache", "system.purge_search_cache", {}) },
  { queue: "system", key: "purge_removal_emails", cron: "40 3 * * *", data: data("purge_removal_emails", "system.purge_removal_emails", {}) },
];
