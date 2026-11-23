import type { Handler, HandlerRegistry } from "./dispatcher";

/**
 * Customer notification events. Since 0100 the database turns every notify.* outbox event into notifications for the
 * account's owners and admins as it is written (wording in platform.notify_from_outbox), and one sender emails them:
 * the API's notification mailer. Here the worker only nudges that sender, so an event is emailed within a minute where a
 * worker runs and never twice (each email is claimed once).
 */
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
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type NotifyDeps = { drain: () => Promise<{ sent: number; failed: number }> };

export function notifyHandlers(deps: NotifyDeps): HandlerRegistry {
  const handle: Handler = async (data, { logger }) => {
    const r = await deps.drain();
    logger.info({ eventType: data.eventType, workspaceId: data.workspaceId, ...r }, "notification emails sent");
  };
  return Object.fromEntries(NOTIFY_EVENTS.map((t) => [t, handle]));
}
