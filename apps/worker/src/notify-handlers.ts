import type { EmailProvider } from "@mushin/integrations";
import type { Handler, HandlerRegistry, JobData } from "./dispatcher";

/**
 * Customer notification emails ("sub-project 7", built 2026-11-16). The billing engine, discovery runner and eraser
 * write notify.* events to the outbox; this sends each one to the workspace's owner and admins. With no provider
 * (NOTIFY_EMAIL_MODE=off) the event is only logged, as before. The outbox event id is the provider idempotency key, so a
 * retried job never sends the same email twice.
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

export type Recipient = { email: string; name: string | null };
export type NotifyDeps = {
  provider: EmailProvider | null;
  from: string;
  appUrl: string;
  /** Active owners and admins of the workspace who have not turned email notifications off. */
  recipients: (workspaceId: string) => Promise<Recipient[]>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Asia/Karachi" }) : null);

/** Subject and body per event; null = nothing to email (the event concerns no customer). */
export function compose(type: NotifyEvent, payload: Record<string, unknown>, appUrl: string): { subject: string; lines: string[] } | null {
  const billing = `${appUrl}/#/dashboard/billing`;
  switch (type) {
    case "notify.credits_low":
    case "notify.credits_very_low": {
      const left = num(payload["available"]);
      const very = type === "notify.credits_very_low";
      return {
        subject: very ? "Your MUSHIN credits are almost used up" : "Your MUSHIN credits are running low",
        lines: [`${left === null ? "Few" : left.toLocaleString("en-US")} credits are left in your workspace.`, very ? "Searches and contact unlocks stop when they run out." : "", `Top up or change plan: ${billing}`],
      };
    }
    case "notify.trial_ending": {
      const ends = day(payload["trialEndsAt"]);
      return { subject: "Your MUSHIN free trial ends soon", lines: [`Your free trial ends${ends ? ` on ${ends}` : " soon"}.`, `Choose a plan to keep your shortlists, campaigns and credits: ${billing}`] };
    }
    case "notify.trial_expired":
      return { subject: "Your MUSHIN free trial has ended", lines: ["Your free trial has ended. Your shortlists and campaigns are kept.", `Choose a plan to continue: ${billing}`] };
    case "notify.subscription_canceled":
      return { subject: "Your MUSHIN subscription was canceled", lines: ["Your subscription has been canceled. Your shortlists and campaigns are kept.", `You can subscribe again at any time: ${billing}`] };
    case "notify.payment_failed":
      return { subject: "Your MUSHIN payment did not go through", lines: ["We could not take your latest payment. Please check your payment method.", `Billing: ${billing}`] };
    case "notify.discovery_job_finished": {
      const failed = payload["status"] === "failed";
      return {
        subject: failed ? "Your MUSHIN live search could not finish" : "Your MUSHIN live search has finished",
        lines: [failed ? "Your live search could not finish. Any credits it held were returned." : "Your live search has finished and the new creators are ready.", `Open MUSHIN: ${appUrl}/#/dashboard`],
      };
    }
    case "notify.removal_processed":
      // A creator's own removal request (no customer workspace): the eraser already handles the requester.
      return null;
  }
}

export function notifyHandlers(deps: NotifyDeps): HandlerRegistry {
  const handle: Handler = async (data: JobData, { logger }) => {
    const type = data.eventType as NotifyEvent;
    const message = compose(type, data.payload, deps.appUrl);
    if (!deps.provider || !message || !data.workspaceId) {
      logger.info({ eventType: type, workspaceId: data.workspaceId, emailed: false }, "notification event received");
      return;
    }
    const to = await deps.recipients(data.workspaceId);
    let sent = 0;
    for (const [i, r] of to.entries()) {
      const result = await deps.provider.send({
        sendId: `${data.eventId}:${i}`,
        from: deps.from,
        to: r.email,
        subject: message.subject,
        text: [`Hello${r.name ? ` ${r.name}` : ""},`, "", ...message.lines.filter(Boolean), "", "MUSHIN", `Email settings: ${deps.appUrl}/#/dashboard/settings`].join("\n"),
        unsubscribeUrl: `${deps.appUrl}/#/dashboard/settings`,
      });
      if (result.ok) sent++;
      // A retryable failure retries the whole job; recipients already sent are skipped by the idempotency key.
      else if (result.retryable) throw new Error(`notification email failed: ${result.reason}`);
      else logger.warn({ eventType: type, workspaceId: data.workspaceId, reason: result.reason }, "notification email refused");
    }
    logger.info({ eventType: type, workspaceId: data.workspaceId, recipients: to.length, sent }, "notification emailed");
  };
  return Object.fromEntries(NOTIFY_EVENTS.map((t) => [t, handle]));
}
