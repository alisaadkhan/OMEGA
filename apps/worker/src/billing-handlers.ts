import type { BillingJob, BillingService } from "../../api/src/modules/billing/index";
import type { Handler, HandlerRegistry } from "./dispatcher";

const JOBS: readonly BillingJob[] = [
  "release_abandoned",
  "expire_lots",
  "end_trials",
  "trial_notices",
  "monthly_grants",
  "scheduled_changes",
  "reconcile",
  "mock_renewals",
  "comp_period_end",
];
const isBillingJob = (v: unknown): v is BillingJob => typeof v === "string" && (JOBS as readonly string[]).includes(v);

export function billingHandlers(billing: Pick<BillingService, "processStoredWebhook" | "runJob">): HandlerRegistry {
  return {
    "billing.webhook_received": async (data) => {
      const id = data.payload["webhookEventId"];
      if (typeof id !== "string") throw new Error("billing.webhook_received without webhookEventId");
      await billing.processStoredWebhook(id);
    },
    "billing.job": async (data, { logger }) => {
      const job = data.payload["job"];
      if (!isBillingJob(job)) throw new Error(`unknown billing job ${String(job)}`);
      const result = await billing.runJob(job);
      logger.info({ job, ...result }, "billing job finished");
    },
  };
}

export const NOTIFY_EVENTS = [
  "notify.credits_low",
  "notify.credits_very_low",
  "notify.trial_ending",
  "notify.trial_expired",
  "notify.subscription_canceled",
  "notify.payment_failed",
  "notify.discovery_job_finished",
  "notify.removal_processed",
] as const;

/** Delivery (in-app notifications, emails) arrives in sub-project 7; until then the events are logged and acknowledged. */
const logOnly: Handler = async (data, { logger }) => {
  logger.info({ eventType: data.eventType, workspaceId: data.workspaceId }, "notification event received (delivery arrives in sub-project 7)");
};

export function notifyHandlers(): HandlerRegistry {
  return Object.fromEntries(NOTIFY_EVENTS.map((eventType) => [eventType, logOnly]));
}
