import { timingSafeEqual } from "node:crypto";
import type { Logger } from "@mushin/core";
import type { AppModule } from "../../http/types";
import type { BillingJob } from "../billing/index";

/** The billing jobs that keep accounts right over time: credits granted, held credits released, lots and trials ended. */
const DAILY_BILLING_JOBS: readonly BillingJob[] = ["release_abandoned", "expire_lots", "end_trials", "trial_notices", "monthly_grants", "scheduled_changes", "comp_period_end", "reconcile"];

export type CronDeps = {
  secret: string;
  logger: Logger;
  runBillingJob: (job: BillingJob) => Promise<{ processed: number }>;
  /** Clears YouTube API data older than 30 days (YouTube API rules) and returns the creators changed. */
  expireYoutube: () => Promise<string[]>;
  reindex: (creatorIds: string[]) => Promise<void>;
  /**
   * One alert check (staffops alert-notifier tick). On Vercel the per-minute alert loop never starts (no long-lived
   * process), so without this production would never send an alert; the cron runs it once a day at least.
   */
  checkAlerts?: () => Promise<unknown>;
  /** Erases creators trashed more than 45 days ago (owner, 23 Nov) and returns them. */
  purgeTrash?: () => Promise<string[]>;
  /** Sends notification emails still waiting (0100): the retry for any a request could not send at once. */
  sendNotifications?: () => Promise<{ sent: number; failed: number }>;
  /** True while a worker process is running the schedules itself: the cron then does nothing. */
  workerAvailable: () => Promise<boolean>;
};

function sameSecret(header: unknown, secret: string): boolean {
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily maintenance for a deployment without a worker host (audit 2026-11-17, finding 1). Vercel Cron calls
 * GET /v1/internal/cron/daily once a day with the CRON_SECRET bearer. Every job is safe to repeat: billing jobs act only
 * on what is due (under each workspace's credit lock) and the YouTube expiry clears only data past 30 days.
 */
export function createCronModule(d: CronDeps): AppModule {
  return {
    name: "cron",
    register: (app) => {
      app.get("/v1/internal/cron/daily", async (req, reply) => {
        if (!sameSecret(req.headers.authorization, d.secret)) return reply.status(404).send();
        if (await d.workerAvailable()) return reply.send({ skipped: "worker_running" });
        const billing: Record<string, number | string> = {};
        for (const job of DAILY_BILLING_JOBS) {
          try {
            billing[job] = (await d.runBillingJob(job)).processed;
          } catch (err) {
            billing[job] = "failed";
            d.logger.error({ err, job, entryPoint: "cron" }, "daily cron: billing job failed");
          }
        }
        let youtubeExpired: number | "failed";
        try {
          const ids = await d.expireYoutube();
          await d.reindex(ids);
          youtubeExpired = ids.length;
        } catch (err) {
          youtubeExpired = "failed";
          d.logger.error({ err, entryPoint: "cron" }, "daily cron: YouTube retention failed");
        }
        let trashErased: number | "failed" | "off" = "off";
        if (d.purgeTrash) {
          try {
            const ids = await d.purgeTrash();
            await d.reindex(ids);
            trashErased = ids.length;
          } catch (err) {
            trashErased = "failed";
            d.logger.error({ err, entryPoint: "cron" }, "daily cron: trash purge failed");
          }
        }
        let notifications: { sent: number; failed: number } | "failed" | "off" = "off";
        if (d.sendNotifications) {
          try {
            notifications = await d.sendNotifications();
          } catch (err) {
            notifications = "failed";
            d.logger.error({ err, entryPoint: "cron" }, "daily cron: notification emails failed");
          }
        }
        let alerts: "sent" | "none" | "failed" | "off" = "off";
        if (d.checkAlerts) {
          try {
            alerts = (await d.checkAlerts()) ? "sent" : "none";
          } catch (err) {
            alerts = "failed";
            d.logger.error({ err, entryPoint: "cron" }, "daily cron: alert check failed");
          }
        }
        d.logger.info({ entryPoint: "cron", billing, youtubeExpired, trashErased, alerts, notifications }, "daily cron finished");
        return reply.send({ billing, youtubeExpired, trashErased, alerts, notifications });
      });
    },
  };
}
