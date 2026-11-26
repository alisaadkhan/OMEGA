import { sql } from "drizzle-orm";
import type { Logger } from "@mushin/core";
import { markNotificationsReadResultSchema, markNotificationsReadSchema, notificationListSchema, type Notification } from "@mushin/contracts";
import type { Db } from "@mushin/db";
import type { EmailProvider } from "@mushin/integrations";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";

/**
 * Customer notifications (0100). The database makes them (support replies and resolutions, credits, trial, payments,
 * finished live searches); this module shows them in the bell and emails the waiting ones. Production has no background
 * worker, so the API sends them itself: right after a staff action that makes one, and in the daily cron as a retry.
 */
export type NotificationMailer = { drain: (limit?: number) => Promise<{ sent: number; failed: number }> };

export function createNotificationMailer(d: { db: Db; provider: EmailProvider | null; from: string; appUrl: string; logger: Logger }): NotificationMailer {
  return {
    async drain(limit = 25) {
      // Off: the emails stay waiting (they are dropped after 7 days); the bell still shows every notification.
      if (!d.provider) return { sent: 0, failed: 0 };
      const rows = await d.db.withSystem((tx) =>
        tx.execute<{ id: string; email: string; name: string | null; title: string; body: string; link: string | null }>(sql`select * from platform.notification_emails_claim(${limit})`),
      );
      let sent = 0;
      let failed = 0;
      for (const r of rows) {
        const open = `${d.appUrl}/${r.link ?? "#/dashboard"}`;
        const settings = `${d.appUrl}/#/dashboard/settings`;
        const result = await d.provider
          .send({
            sendId: `notification:${r.id}`,
            from: d.from,
            to: r.email,
            subject: r.title,
            text: [`Hello${r.name ? ` ${r.name}` : ""},`, "", r.title, ...(r.body ? ["", r.body] : []), "", `Open MUSHIN: ${open}`, "", "MUSHIN", `Email settings: ${settings}`].join("\n"),
            unsubscribeUrl: settings,
          })
          .catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : "send failed", retryable: true }));
        if (result.ok) sent++;
        else {
          failed++;
          d.logger.warn({ notificationId: r.id, reason: result.reason, retryable: result.retryable }, "notification email not sent");
        }
        await d.db.withSystem((tx) => tx.execute(sql`select platform.notification_email_done(${r.id}::uuid, ${result.ok}, ${!result.ok && result.retryable})`));
      }
      if (rows.length) d.logger.info({ claimed: rows.length, sent, failed }, "notification emails");
      return { sent, failed };
    },
  };
}

const VIEW = /^#\/dashboard\/([a-z]+)$/;

export function createNotificationsModule(o: { db: Db }): AppModule {
  return {
    name: "notifications",
    register(app, guards) {
      app.get("/v1/notifications", { preHandler: guards.customer }, async (req, reply) => {
        const t = tenantOf(req);
        const out = await o.db.withTenant({ userId: t.userId, workspaceId: t.workspaceId }, async (tx) => {
          const rows = await tx.execute<{ id: string; kind: string; title: string; body: string; link: string | null; created_at: string; read_at: string | null }>(sql`
            select id, kind, title, body, link, created_at, read_at from wp.notifications order by created_at desc limit 30`);
          const [u] = await tx.execute<{ n: number }>(sql`select count(*)::int n from wp.notifications where read_at is null`);
          const byView = await tx.execute<{ v: string; n: number }>(sql`
            select substring(link from '^#/dashboard/([a-z]+)$') v, count(*)::int n from wp.notifications
            where read_at is null and link is not null group by 1 having substring(link from '^#/dashboard/([a-z]+)$') is not null`);
          return { rows, unread: u?.n ?? 0, byView };
        });
        const notifications: Notification[] = out.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          view: r.link ? (VIEW.exec(r.link)?.[1] ?? null) : null,
          createdAt: new Date(r.created_at).toISOString(),
          read: r.read_at !== null,
        }));
        return sendOk(reply, notificationListSchema, { notifications, unread: out.unread, unreadByView: Object.fromEntries(out.byView.map((b) => [b.v, b.n])) });
      });
      app.post("/v1/notifications/read", { preHandler: guards.customer }, async (req, reply) => {
        const t = tenantOf(req);
        const { ids, view } = parseInput(markNotificationsReadSchema, req.body ?? {});
        await o.db.withTenant({ userId: t.userId, workspaceId: t.workspaceId }, (tx) =>
          tx.execute(
            ids ? sql`update wp.notifications set read_at = now() where read_at is null and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`
            : view ? sql`update wp.notifications set read_at = now() where read_at is null and link = ${`#/dashboard/${view}`}`
            : sql`update wp.notifications set read_at = now() where read_at is null`,
          ),
        );
        return sendOk(reply, markNotificationsReadResultSchema, { ok: true as const });
      });
    },
  };
}
