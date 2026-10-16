import { sql } from "drizzle-orm";
import type { Logger } from "@mushin/core";
import type { AlertEvent, Db } from "@mushin/db";

/**
 * Alert delivery (audit OPS-03). The API (always running, unlike a stopped worker) checks every minute: the alert
 * thresholds staff see in the console, the worker heartbeat, and one-off events any process recorded. New alerts, a
 * severity change, a standing alert every few hours, and an alert's end are sent to the team's incoming webhook. One API
 * instance sends at a time (advisory lock); a failed delivery is retried on the next check because nothing is marked sent.
 */
export type Alert = AlertEvent;
export type AlertMessage = { environment: string; test?: boolean; alerts: Alert[]; resolved: string[] };
export type SendAlerts = (m: AlertMessage) => Promise<void>;

const LOCK = 7_211_031; // pg advisory lock id for alert delivery
const ICON = { critical: "🔴", warning: "🟠" } as const;

export function alertText(m: AlertMessage): string {
  const lines = [m.test ? `MUSHIN ${m.environment}: test alert, delivery works.` : `MUSHIN ${m.environment}:`];
  for (const a of m.alerts) lines.push(`${ICON[a.severity]} ${a.severity.toUpperCase()} ${a.key}: ${a.message}`);
  for (const k of m.resolved) lines.push(`✅ resolved ${k}`);
  return lines.join("\n");
}

/** Slack (`text`) and Discord (`content`) incoming webhooks both accept this body. */
export function createWebhookSender(o: { url: string; fetch?: typeof fetch; timeoutMs?: number }): SendAlerts {
  return async (m) => {
    const text = alertText(m);
    const res = await (o.fetch ?? fetch)(o.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text.slice(0, 2000), environment: m.environment, alerts: m.alerts, resolved: m.resolved, test: m.test ?? false }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
    // The URL is a secret: only the status is reported.
    if (!res.ok) throw new Error(`alert webhook answered ${res.status}`);
  };
}

/** Development without a webhook: alerts go to the log at error level, as before. */
export function createLogSender(logger: Logger): SendAlerts {
  return async (m) => {
    logger.error({ alerts: m.alerts, resolved: m.resolved, test: m.test ?? false }, alertText(m));
  };
}

export function createAlertNotifier(o: {
  db: Db;
  /** Threshold alerts as the staff console computes them (worker heartbeat included). */
  current: () => Promise<Alert[]>;
  send: SendAlerts;
  environment: string;
  logger: Logger;
  /** A standing alert is sent again after this long. */
  repeatAfterMs?: number;
}) {
  const repeatMs = o.repeatAfterMs ?? 6 * 3_600_000;
  let timer: NodeJS.Timeout | null = null;

  /** One check. Returns what was sent (null when nothing was due or another instance holds the lock). */
  async function tick(): Promise<AlertMessage | null> {
    const current = await o.current();
    return o.db.withSystem(async (tx) => {
      const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK}) ok`);
      if (!lock?.ok) return null;
      const delivered = await tx.execute<{ key: string; severity: string; due: boolean; resolved: boolean }>(
        sql`select key, severity, last_sent_at < now() - make_interval(secs => ${repeatMs / 1000}) due, resolved_at is not null resolved from platform.alert_deliveries`,
      );
      const byKey = new Map(delivered.map((d) => [d.key, d]));
      const due = current.filter((a) => {
        const d = byKey.get(a.key);
        return !d || d.resolved || d.severity !== a.severity || d.due;
      });
      const resolved = delivered.filter((d) => !d.resolved && !current.some((a) => a.key === d.key)).map((d) => d.key);
      const events = await tx.execute<{ id: string; key: string; severity: "warning" | "critical"; message: string }>(
        sql`select id, key, severity, message from platform.alert_events where sent_at is null order by created_at limit 20`,
      );
      if (due.length === 0 && resolved.length === 0 && events.length === 0) return null;
      const message: AlertMessage = { environment: o.environment, alerts: [...due, ...events.map((e) => ({ key: e.key, severity: e.severity, message: e.message }))], resolved };
      await o.send(message); // throws: the transaction rolls back and the next check tries again
      for (const a of due) {
        await tx.execute(sql`insert into platform.alert_deliveries (key, severity, last_sent_at) values (${a.key}, ${a.severity}, now())
          on conflict (key) do update set severity = excluded.severity, last_sent_at = now(), resolved_at = null`);
      }
      for (const k of resolved) await tx.execute(sql`update platform.alert_deliveries set resolved_at = now() where key = ${k}`);
      for (const e of events) await tx.execute(sql`update platform.alert_events set sent_at = now() where id = ${e.id}`);
      await tx.execute(sql`delete from platform.alert_events where sent_at < now() - interval '30 days'`);
      return message;
    });
  }

  return {
    tick,
    /** Staff "send a test alert": proves the channel works without touching delivery state. */
    async sendTest(): Promise<void> {
      await o.send({ environment: o.environment, test: true, alerts: [], resolved: [] });
    },
    start(intervalMs = 60_000) {
      timer = setInterval(() => {
        tick().catch((err: unknown) => o.logger.error({ err: err instanceof Error ? err.message : String(err) }, "alert delivery failed; retrying next minute"));
      }, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type AlertNotifier = ReturnType<typeof createAlertNotifier>;
