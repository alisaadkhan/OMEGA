import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createDispatcher } from "./dispatcher";
import { queueFor } from "./queues";
import { billingHandlers, NOTIFY_EVENTS, notifyHandlers } from "./billing-handlers";
import { SCHEDULES } from "./schedules";
import { creatorHandlers } from "./creator-handlers";
import { discoveryHandlers } from "./discovery-handlers";
import { erasureHandlers } from "./erasure-handlers";
import { audienceHandlers } from "./audience-handlers";

describe("queue routing", () => {
  it("routes event types by prefix", () => {
    expect(queueFor("discovery.requested")).toBe("discovery-high");
    expect(queueFor("refresh.requested")).toBe("discovery-standard");
    expect(queueFor("audience.estimate_requested")).toBe("audience");
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

describe("creator handlers", () => {
  const job = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: "e",
    eventType,
    aggregateType: "creator",
    aggregateId: "1",
    workspaceId: null,
    requestId: null,
    payload,
  });

  it("syncs changed creators, writes requested summaries and reconciles the index", async () => {
    const calls: string[] = [];
    const handlers = creatorHandlers({
      indexer: {
        sync: async (ids) => void calls.push(`sync:${ids.join(",")}`),
        reconcile: async () => {
          calls.push("reconcile");
          return { upserted: 0, removed: 0 };
        },
      },
      summaries: {
        generate: async (id) => {
          calls.push(`summary:${id}`);
          return "written";
        },
      },
    });
    const dispatch = createDispatcher(handlers, createLogger({ level: "silent" }));
    await dispatch([{ id: "j1", data: job("creator.changed", { creatorId: "c1" }) }]);
    await dispatch([{ id: "j2", data: job("creator.summary_requested", { creatorId: "c1", sourceHash: "h" }) }]);
    await dispatch([{ id: "j3", data: job("creator.reindex_all", {}) }]);
    expect(calls).toEqual(["sync:c1", "summary:c1", "reconcile"]);
    await expect(dispatch([{ id: "j4", data: job("creator.changed", {}) }])).rejects.toThrow(/creatorId/);
    expect(SCHEDULES.find((s) => s.key === "search_reconcile")).toMatchObject({ queue: "rescore-low", cron: "45 3 * * *" });
  });
});

describe("discovery handlers", () => {
  const job = (eventType: string, payload: Record<string, unknown>, workspaceId: string | null = "w1") => ({
    eventId: "e",
    eventType,
    aggregateType: "discovery_job",
    aggregateId: "1",
    workspaceId,
    requestId: null,
    payload,
  });

  it("runs add-by-URL and refresh jobs, reassesses, sweeps and purges", async () => {
    const calls: string[] = [];
    const handlers = discoveryHandlers({
      runner: { run: async (id, ws) => void calls.push(`run:${id}:${ws}`), sweepStuck: async () => (calls.push("sweep"), 0) },
      liveRunner: { run: async () => undefined },
      searchCache: { purge: async () => 0 },
      pipeline: { reassess: async (id) => (calls.push(`reassess:${id}`), "assessed" as const), purgeExpiredPayloads: async () => (calls.push("purge"), 0) },
    });
    const dispatch = createDispatcher(handlers, createLogger({ level: "silent" }));
    await dispatch([{ id: "j1", data: job("discovery.requested", { jobId: "a" }) }]);
    await dispatch([{ id: "j2", data: job("refresh.requested", { jobId: "b" }) }]);
    await dispatch([{ id: "j3", data: job("creator.assessment_requested", { creatorId: "c" }, null) }]);
    await dispatch([{ id: "j4", data: job("system.discovery_sweep", {}, null) }]);
    await dispatch([{ id: "j5", data: job("system.purge_raw_payloads", {}, null) }]);
    expect(calls).toEqual(["run:a:w1", "run:b:w1", "reassess:c", "sweep", "purge"]);
    await expect(dispatch([{ id: "j6", data: job("discovery.requested", {}, "w1") }])).rejects.toThrow(/jobId/);
    await expect(dispatch([{ id: "j7", data: job("discovery.requested", { jobId: "a" }, null) }])).rejects.toThrow(/workspace/);
    for (const key of ["discovery_sweep", "purge_raw_payloads"]) expect(SCHEDULES.find((s) => s.key === key)).toMatchObject({ queue: "system" });
    expect(NOTIFY_EVENTS).toContain("notify.discovery_job_finished");
  });
});

describe("live discovery and erasure handlers", () => {
  const job = (eventType: string, payload: Record<string, unknown>, workspaceId: string | null = "w1") => ({
    eventId: "e",
    eventType,
    aggregateType: "x",
    aggregateId: "1",
    workspaceId,
    requestId: null,
    payload,
  });

  it("runs live jobs, erasures and the two purges, on the right queues", async () => {
    const calls: string[] = [];
    const handlers = {
      ...discoveryHandlers({
        runner: { run: async () => undefined, sweepStuck: async () => 0 },
        liveRunner: { run: async (id, ws) => void calls.push(`live:${id}:${ws}`) },
        searchCache: { purge: async () => (calls.push("purge-search"), 0) },
        pipeline: { reassess: async () => "assessed" as const, purgeExpiredPayloads: async () => 0 },
      }),
      ...erasureHandlers({ eraser: { erase: async (id) => void calls.push(`erase:${id}`), clearOldEmails: async () => (calls.push("purge-emails"), 0) } }),
    };
    const dispatch = createDispatcher(handlers, createLogger({ level: "silent" }));
    await dispatch([{ id: "j1", data: job("discovery.live_requested", { jobId: "a" }) }]);
    await dispatch([{ id: "j2", data: job("erasure.creator_requested", { removalRequestId: "r1" }, null) }]);
    await dispatch([{ id: "j3", data: job("system.purge_search_cache", {}, null) }]);
    await dispatch([{ id: "j4", data: job("system.purge_removal_emails", {}, null) }]);
    expect(calls).toEqual(["live:a:w1", "erase:r1", "purge-search", "purge-emails"]);
    expect(queueFor("discovery.live_requested")).toBe("discovery-high");
    expect(queueFor("erasure.creator_requested")).toBe("erasure");
    for (const key of ["purge_search_cache", "purge_removal_emails"]) expect(SCHEDULES.find((s) => s.key === key)).toMatchObject({ queue: "system" });
    expect(NOTIFY_EVENTS).toContain("notify.removal_processed");
  });
});

describe("audience handlers", () => {
  it("runs requested estimates in their workspace and sweeps stuck ones", async () => {
    const calls: string[] = [];
    const handlers = audienceHandlers({ runner: { run: async (jobId, ws) => void calls.push(`run:${jobId}:${ws}`), sweepStuck: async () => (calls.push("sweep"), 0), purgeExpired: async () => (calls.push("purge"), 0) } });
    const dispatch = createDispatcher(handlers, createLogger({ level: "silent" }));
    const job = (eventType: string, payload: Record<string, unknown>, workspaceId: string | null) => ({ eventId: "e", eventType, aggregateType: "audience_job", aggregateId: "1", workspaceId, requestId: null, payload });
    await dispatch([{ id: "j1", data: job("audience.estimate_requested", { jobId: "a1" }, "w1") }]);
    await dispatch([{ id: "j2", data: job("system.audience_sweep", {}, null) }]);
    expect(calls).toEqual(["run:a1:w1", "sweep", "purge"]);
    await expect(dispatch([{ id: "j3", data: job("audience.estimate_requested", { jobId: "a1" }, null) }])).rejects.toThrow(/workspace/);
    expect(SCHEDULES.find((s) => s.key === "audience_sweep")).toMatchObject({ queue: "system", cron: "*/5 * * * *" });
  });
});
