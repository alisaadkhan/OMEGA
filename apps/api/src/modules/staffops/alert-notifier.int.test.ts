import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { recordAlertEvent, recordWorkerHeartbeat } from "@mushin/db";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createStaffActions } from "./actions";
import { alertText, createAlertNotifier, createWebhookSender, type Alert, type AlertMessage } from "./alert-notifier";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

function harness(o: { current?: Alert[]; failSend?: boolean } = {}) {
  const sent: AlertMessage[] = [];
  const state = { current: o.current ?? [], failSend: o.failSend ?? false };
  const notifier = createAlertNotifier({
    db,
    current: async () => state.current,
    send: async (m) => {
      if (state.failSend) throw new Error("webhook down");
      sent.push(m);
    },
    environment: "test",
    logger,
  });
  return { notifier, sent, state };
}
const stuck: Alert = { key: "stuck_jobs", severity: "warning", message: "2 job(s) queued or running for more than 30 minutes." };

describe("alert delivery (audit OPS-03)", () => {
  it("sends a new alert once, again when its severity changes, and reports when it ends", async () => {
    const { notifier, sent, state } = harness({ current: [stuck] });
    expect(await notifier.tick()).toMatchObject({ alerts: [stuck], resolved: [] });
    expect(await notifier.tick()).toBeNull(); // still standing: not repeated within the repeat window
    state.current = [{ ...stuck, severity: "critical" }];
    expect((await notifier.tick())?.alerts).toEqual([expect.objectContaining({ key: "stuck_jobs", severity: "critical" })]);
    state.current = [];
    expect(await notifier.tick()).toMatchObject({ alerts: [], resolved: ["stuck_jobs"] });
    expect(await notifier.tick()).toBeNull();
    expect(sent).toHaveLength(3);
  });

  it("repeats a standing alert after the repeat window", async () => {
    const { notifier } = harness({ current: [stuck] });
    await notifier.tick();
    await ownerQuery(`update platform.alert_deliveries set last_sent_at = now() - interval '7 hours'`);
    expect((await notifier.tick())?.alerts).toEqual([stuck]);
  });

  it("delivers one-off events once, and retries everything after a failed delivery", async () => {
    const { notifier, sent, state } = harness({ current: [stuck], failSend: true });
    await db.withSystem((tx) => recordAlertEvent(tx, { key: "credit_mismatch", severity: "critical", message: "Credit lots do not match the ledger in a workspace (1 difference(s))." }));
    await expect(notifier.tick()).rejects.toThrow("webhook down");
    expect(await ownerQuery(`select key from platform.alert_deliveries`)).toEqual([]); // nothing marked as sent
    state.failSend = false;
    expect((await notifier.tick())?.alerts.map((a) => a.key)).toEqual(["stuck_jobs", "credit_mismatch"]);
    expect(await notifier.tick()).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("lets only one API instance deliver at a time", async () => {
    const a = harness({ current: [stuck] });
    const b = harness({ current: [stuck] });
    const out = await Promise.all([a.notifier.tick(), b.notifier.tick()]);
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it("raises a critical alert when the worker never reported or its heartbeat is stale", async () => {
    const actions = createStaffActions({ db });
    expect((await actions.alerts()).alerts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "worker", severity: "critical" })]));
    await db.withSystem((tx) => recordWorkerHeartbeat(tx));
    expect((await actions.alerts()).alerts.some((x) => x.key === "worker")).toBe(false);
    await ownerQuery(`update platform.process_heartbeats set beat_at = now() - interval '6 minutes'`);
    const stale = await actions.alerts();
    expect(stale.workerHeartbeatSeconds).toBeGreaterThanOrEqual(360);
    expect(stale.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "worker", severity: "critical" })]));
  });

  it("posts Slack- and Discord-compatible JSON, and keeps the URL out of errors", async () => {
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    const ok = createWebhookSender({ url: "https://hooks.example.com/secret-path", fetch: async (url, init) => (posts.push({ url: String(url), body: JSON.parse(String(init?.body)) }), new Response(null, { status: 204 })) });
    await ok({ environment: "staging", alerts: [stuck], resolved: ["outbox"] });
    expect(posts[0]?.body).toMatchObject({ text: expect.stringContaining("WARNING stuck_jobs"), content: expect.stringContaining("resolved outbox"), alerts: [stuck] });
    const bad = createWebhookSender({ url: "https://hooks.example.com/secret-path", fetch: async () => new Response(null, { status: 500 }) });
    await expect(bad({ environment: "staging", alerts: [stuck], resolved: [] })).rejects.toThrow(/^alert webhook answered 500$/);
    expect(alertText({ environment: "staging", test: true, alerts: [], resolved: [] })).toBe("MUSHIN staging: test alert, delivery works.");
  });
});
