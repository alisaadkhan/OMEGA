import { sql } from "drizzle-orm";
import type { SystemTx } from "./database";

/**
 * A one-off problem for operators (audit OPS-03), delivered by the API's alert notifier. The message is read by people
 * outside the product's access controls: counts and names of systems only, never personal data, contact details or
 * secrets. Ids belong in the logs, which the message may point to.
 */
export type AlertEvent = { key: string; severity: "warning" | "critical"; message: string };

export async function recordAlertEvent(tx: SystemTx, e: AlertEvent): Promise<void> {
  await tx.execute(sql`insert into platform.alert_events (key, severity, message) values (${e.key}, ${e.severity}, ${e.message.slice(0, 300)})`);
}

/** Seconds since the worker's last heartbeat; null when it never ran. */
export async function workerHeartbeatAgeSeconds(tx: SystemTx): Promise<number | null> {
  const [r] = await tx.execute<{ age: number }>(sql`select greatest(extract(epoch from now() - beat_at)::int, 0) age from platform.process_heartbeats where process = 'worker'`);
  return r ? Number(r.age) : null;
}

/** The worker's proof that its queue runs (a scheduled job every minute). */
export async function recordWorkerHeartbeat(tx: SystemTx): Promise<void> {
  await tx.execute(sql`insert into platform.process_heartbeats (process, beat_at) values ('worker', now())
    on conflict (process) do update set beat_at = excluded.beat_at`);
}
