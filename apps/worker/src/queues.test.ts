import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createDispatcher } from "./dispatcher";
import { queueFor } from "./queues";

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
