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

/** Umbrella spec §7.3. Daily billing jobs run in this order: grants, downgrades, then mock renewals. */
export const SCHEDULES: Schedule[] = [
  { queue: "system", key: "purge_expired", cron: "15 3 * * *", data: data("purge_expired", "system.purge_expired", {}) },
  billing("release_abandoned", "* * * * *"),
  billing("expire_lots", "5 * * * *"),
  billing("end_trials", "10 * * * *"),
  billing("trial_notices", "20 * * * *"),
  billing("monthly_grants", "30 2 * * *"),
  billing("scheduled_changes", "40 2 * * *"),
  billing("mock_renewals", "50 2 * * *"),
  billing("reconcile", "30 4 * * *"),
];
