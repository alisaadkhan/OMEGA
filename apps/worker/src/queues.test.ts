import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createDispatcher } from "./dispatcher";
import { queueFor } from "./queues";
import { billingHandlers, NOTIFY_EVENTS, notifyHandlers } from "./billing-handlers";
import { SCHEDULES } from "./schedules";

describe("queue routing", () => {
  it("routes event types by prefix", () => {
    expect(queueFor("discovery.requested")).toBe("discovery-high");
    expect(queueFor("refresh.requested")).toBe("discovery-standard");
    expect(queueFor("creator.updated")).toBe("rescore-low");
    expect(queueFor("billing.webhook_received")).toBe("billing");
    expect(queueFor("system.ping")).toBe("system");
  });

  it("refuses unknown event types loudly", () => {
    expect(() => queueFor("mystery.thing")).toThrow(/No queue route/);
  });
});

describe("dispatcher", () => {
  it("calls the handler for each job and fails on unknown types", async () => {
    const seen: string[] = [];
    const dispatch = createDispatcher({ "system.ping": async (d) => void seen.push(d.eventId) }, createLogger({ level: "silent" }));
    const data = { eventId: "e1", eventType: "system.ping", aggregateType: "x", aggregateId: "1", workspaceId: null, requestId: null, payload: {} };
    await dispatch([{ id: "j1", data }]);
    expect(seen).toEqual(["e1"]);
    await expect(dispatch([{ id: "j2", data: { ...data, eventType: "system.unknown" } }])).rejects.toThrow(/No handler/);
  });
});

describe("billing handlers", () => {
  const job = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: "e",
    eventType,
    aggregateType: "x",
    aggregateId: "1",
    workspaceId: null,
    requestId: null,
    payload,
  });

  it("applies stored webhooks and runs named jobs", async () => {
    const calls: string[] = [];
    const handlers = billingHandlers({
      processStoredWebhook: async (id) => void calls.push(`webhook:${id}`),
      runJob: async (name) => {
        calls.push(`job:${name}`);
        return { processed: 0 };
      },
    });
    const dispatch = createDispatcher({ ...handlers, ...notifyHandlers() }, createLogger({ level: "silent" }));
    await dispatch([{ id: "j1", data: job("billing.webhook_received", { webhookEventId: "w1" }) }]);
    await dispatch([{ id: "j2", data: job("billing.job", { job: "expire_lots" }) }]);
    await dispatch([{ id: "j3", data: job("notify.credits_low", {}) }]);
    expect(calls).toEqual(["webhook:w1", "job:expire_lots"]);
    await expect(dispatch([{ id: "j4", data: job("billing.job", { job: "drop_tables" }) }])).rejects.toThrow(/unknown billing job/);
  });

  it("schedules every billing job once, on routable queues", () => {
    const keys = SCHEDULES.map((s) => `${s.queue}:${s.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SCHEDULES) expect(queueFor(s.data.eventType)).toBe(s.queue);
    expect(SCHEDULES.filter((s) => s.queue === "billing").map((s) => s.key).sort()).toEqual(
      ["end_trials", "expire_lots", "mock_renewals", "monthly_grants", "reconcile", "release_abandoned", "scheduled_changes", "trial_notices"],
    );
    expect(NOTIFY_EVENTS.every((t) => queueFor(t) === "notify")).toBe(true);
  });
});
