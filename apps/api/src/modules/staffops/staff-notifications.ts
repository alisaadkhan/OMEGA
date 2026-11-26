import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PreHandler } from "../../http/types";
import { staffNotificationEmailSchema, staffNotificationListSchema, staffNotificationReadSchema, type StaffNotification } from "@mushin/contracts";
import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { EmailProvider } from "@mushin/integrations";
import { parseInput, sendOk } from "../../http/validate";
import type { StaffAction, StaffPrincipal } from "../staff/index";

/**
 * Staff notifications (owner, 25 Nov, 0106). The database writes one wherever an event happens (new user, subscription,
 * trial form, ticket, profile report, creator auto-hidden); this shows them in the console bell and emails each staff
 * member who keeps email on. Support sees tickets only.
 */
export type StaffMailer = { drain: (limit?: number) => Promise<{ sent: number; failed: number }> };

export function createStaffMailer(d: { db: Db; provider: EmailProvider | null; from: string; appUrl: string; logger: Logger }): StaffMailer {
  let running: Promise<{ sent: number; failed: number }> | null = null;
  const run = async (limit: number) => {
    if (!d.provider) return { sent: 0, failed: 0 };
    const rows = await d.db.withSystem((tx) =>
      tx.execute<{ notification_id: string; staff_id: string; email: string; name: string | null; title: string; body: string; link: string | null }>(
        sql`select * from platform.staff_notification_emails_claim(${limit})`,
      ),
    );
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      const open = `${d.appUrl}/_omega_${r.link ?? ""}`;
      const result = await d.provider
        .send({
          sendId: `staff-notification:${r.notification_id}:${r.staff_id}`,
          from: d.from,
          to: r.email,
          subject: `[MUSHIN staff] ${r.title}`,
          unsubscribeUrl: `${d.appUrl}/_omega_#settings`,
          text: [`Hello${r.name ? ` ${r.name}` : ""},`, "", r.title, ...(r.body ? ["", r.body] : []), "", `Open the staff console: ${open}`, "", "Turn these emails off in the console under Settings."].join("\n"),
        })
        .catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : "send failed", retryable: true }));
      if (result.ok) sent++;
      else {
        failed++;
        d.logger.warn({ notificationId: r.notification_id, reason: result.reason }, "staff notification email not sent");
      }
      await d.db.withSystem((tx) => tx.execute(sql`select platform.staff_notification_email_done(${r.notification_id}::uuid, ${r.staff_id}::uuid, ${result.ok}, ${!result.ok && result.retryable})`));
    }
    if (rows.length) d.logger.info({ claimed: rows.length, sent, failed }, "staff notification emails");
    return { sent, failed };
  };
  return {
    // One drain at a time per process; callers that arrive meanwhile share it.
    drain(limit = 25) {
      running ??= run(limit).finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export function registerStaffNotificationRoutes(
  app: FastifyInstance,
  o: { db: Db; r: (a: StaffAction) => PreHandler; staffOf: (req: FastifyRequest) => StaffPrincipal; mailer?: StaffMailer },
) {
  const audience = (p: StaffPrincipal) => (p.role === "support" ? sql`n.audience = 'all'` : sql`true`);
  app.get("/admin/v1/notifications", { preHandler: o.r("staff.notifications.read") }, async (req, reply) => {
    const p = o.staffOf(req);
    // The bell is the console's heartbeat: send any staff emails still waiting while we are here.
    if (o.mailer) void o.mailer.drain().catch((err: unknown) => req.log.warn({ err }, "staff mailer drain failed"));
    const out = await o.db.withSystem(async (tx) => {
      const rows = await tx.execute<{ id: string; kind: StaffNotification["kind"]; title: string; body: string; link: string | null; created_at: string; read: boolean }>(sql`
        select n.id, n.kind, n.title, n.body, n.link, n.created_at, (r.staff_id is not null) read
        from staff.notifications n left join staff.notification_reads r on r.notification_id = n.id and r.staff_id = ${p.staffId}
        where ${audience(p)} order by n.created_at desc limit 40`);
      const [u] = await tx.execute<{ n: number }>(sql`
        select count(*)::int n from staff.notifications n
        where ${audience(p)} and n.created_at > now() - interval '30 days'
          and not exists (select 1 from staff.notification_reads r where r.notification_id = n.id and r.staff_id = ${p.staffId})`);
      const [me] = await tx.execute<{ on: boolean }>(sql`select notify_email "on" from staff.staff_users where id = ${p.staffId}`);
      const pages = await tx.execute<{ page: string; n: number }>(sql`
        select substring(n.link from '^#([a-z]+)') page, count(*)::int n from staff.notifications n
        where ${audience(p)} and n.link is not null and n.created_at > now() - interval '30 days'
          and not exists (select 1 from staff.notification_reads r where r.notification_id = n.id and r.staff_id = ${p.staffId})
        group by 1`);
      return { rows, unread: u?.n ?? 0, emailOn: me?.on ?? true, byPage: Object.fromEntries(pages.filter((x) => x.page).map((x) => [x.page, x.n])) };
    });
    return sendOk(reply, staffNotificationListSchema, {
      notifications: out.rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: new Date(r.created_at).toISOString(), read: r.read })),
      unread: out.unread,
      emailOn: out.emailOn,
      byPage: out.byPage,
    });
  });
  app.post("/admin/v1/notifications/read", { preHandler: o.r("staff.notifications.read") }, async (req, reply) => {
    const p = o.staffOf(req);
    const { ids, page } = parseInput(staffNotificationReadSchema, req.body ?? {});
    // Opening a page reads its notifications ("#tickets", "#users?…"); ids read single ones; neither reads all.
    const only = ids ? sql`and n.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : page ? sql`and substring(n.link from '^#([a-z]+)') = ${page}` : sql``;
    await o.db.withSystem((tx) =>
      tx.execute(sql`insert into staff.notification_reads (staff_id, notification_id)
        select ${p.staffId}, n.id from staff.notifications n where ${audience(p)} ${only} on conflict do nothing`),
    );
    return reply.status(204).send();
  });
  app.put("/admin/v1/notifications/email", { preHandler: o.r("staff.notifications.read") }, async (req, reply) => {
    const p = o.staffOf(req);
    const { on } = parseInput(staffNotificationEmailSchema, req.body);
    await o.db.withSystem((tx) => tx.execute(sql`update staff.staff_users set notify_email = ${on}, updated_at = now() where id = ${p.staffId}`));
    return reply.status(204).send();
  });
}
