import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MockEmailProvider } from "@mushin/integrations";
import { createDispatcher, type JobData } from "./dispatcher";
import { compose, NOTIFY_EVENTS, notifyHandlers } from "./notify-handlers";

const logger = createLogger({ level: "silent" });
const job = (eventType: string, payload: Record<string, unknown>, workspaceId: string | null = "ws1"): JobData => ({
  eventId: `ev-${eventType}`, eventType, aggregateType: "workspace", aggregateId: "ws1", workspaceId, requestId: null, payload,
});

describe("notification emails", () => {
  it("emails each owner and admin once per event, with the event id as idempotency key", async () => {
    const provider = new MockEmailProvider();
    const dispatch = createDispatcher(notifyHandlers({ provider, from: "MUSHIN <n@x.test>", appUrl: "https://app.test", recipients: async () => [{ email: "a@x.test", name: "Ayesha" }, { email: "b@x.test", name: null }] }), logger);
    await dispatch([{ id: "j1", data: job("notify.credits_low", { available: 120, base: 1000 }) }]);
    expect(provider.sent.map((e) => [e.to, e.sendId])).toEqual([["a@x.test", "ev-notify.credits_low:0"], ["b@x.test", "ev-notify.credits_low:1"]]);
    expect(provider.sent[0]?.subject).toBe("Your MUSHIN credits are running low");
    expect(provider.sent[0]?.text).toContain("Hello Ayesha,");
    expect(provider.sent[0]?.text).toContain("120 credits are left");
    expect(provider.sent[0]?.text).toContain("https://app.test/#/dashboard/billing");
  });

  it("only logs when email is off, the event has no workspace, or it concerns no customer", async () => {
    const provider = new MockEmailProvider();
    let asked = 0;
    const recipients = async () => (asked++, [{ email: "a@x.test", name: null }]);
    await createDispatcher(notifyHandlers({ provider: null, from: "", appUrl: "https://app.test", recipients }), logger)([{ id: "j", data: job("notify.trial_expired", {}) }]);
    const on = createDispatcher(notifyHandlers({ provider, from: "f@x.test", appUrl: "https://app.test", recipients }), logger);
    await on([{ id: "j2", data: job("notify.removal_processed", { removalRequestId: "r1" }, null) }]);
    await on([{ id: "j3", data: job("notify.payment_failed", {}, null) }]);
    expect(provider.sent).toHaveLength(0);
    expect(asked).toBe(0);
  });

  it("retries the job on a retryable failure and skips a refused address", async () => {
    const provider = new MockEmailProvider();
    const flaky = { mode: "test" as const, send: async () => ({ ok: false as const, reason: "provider_unreachable", retryable: true }) };
    const recipients = async () => [{ email: "a@x.test", name: null }];
    await expect(createDispatcher(notifyHandlers({ provider: flaky, from: "f", appUrl: "https://app.test", recipients }), logger)([{ id: "j", data: job("notify.trial_ending", {}) }])).rejects.toThrow(/provider_unreachable/);
    provider.failNext = "invalid_to";
    await createDispatcher(notifyHandlers({ provider, from: "f", appUrl: "https://app.test", recipients }), logger)([{ id: "j", data: job("notify.trial_ending", {}) }]);
    expect(provider.sent).toHaveLength(0);
  });

  it("has a message for every customer event", () => {
    for (const t of NOTIFY_EVENTS) {
      const m = compose(t, { trialEndsAt: "2026-11-30T04:38:00.000Z", status: "failed", available: 5 }, "https://app.test");
      if (t === "notify.removal_processed") expect(m).toBeNull();
      else expect(m?.subject).toMatch(/MUSHIN/);
    }
    expect(compose("notify.trial_ending", { trialEndsAt: "2026-11-30T04:38:00.000Z" }, "https://a")?.lines[0]).toBe("Your free trial ends on 30 November 2026.");
    expect(compose("notify.discovery_job_finished", { status: "failed" }, "https://a")?.lines[0]).toMatch(/credits it held were returned/);
  });
});
