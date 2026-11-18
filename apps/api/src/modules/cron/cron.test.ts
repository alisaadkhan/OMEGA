import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { buildTestApp } from "../../test-support/app";
import { createCronModule, type CronDeps } from "./index";

const secret = "s".repeat(40);
async function appWith(over: Partial<CronDeps> = {}) {
  const calls: string[] = [];
  const deps: CronDeps = {
    secret,
    logger: createLogger({ level: "silent" }),
    runBillingJob: async (job) => { calls.push(job); return { processed: 1 }; },
    expireYoutube: async () => { calls.push("youtube"); return ["c1"]; },
    reindex: async (ids) => { calls.push(`reindex:${ids.join(",")}`); },
    workerAvailable: async () => false,
    ...over,
  };
  return { app: await buildTestApp({ modules: [createCronModule(deps)] }), calls };
}

describe("daily maintenance route (audit 2026-11-17)", () => {
  it("answers 404 and does nothing without the exact secret", async () => {
    const { app, calls } = await appWith();
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${secret}x`, secret]) {
      const res = await app.inject({ method: "GET", url: "/v1/internal/cron/daily", headers: authorization ? { authorization } : {} });
      expect(res.statusCode).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it("runs every billing job and the YouTube expiry; one failing job does not stop the others", async () => {
    const { app, calls } = await appWith({ runBillingJob: async (job) => { if (job === "expire_lots") throw new Error("x"); return { processed: 2 }; } });
    const res = await app.inject({ method: "GET", url: "/v1/internal/cron/daily", headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ billing: { expire_lots: "failed", monthly_grants: 2, release_abandoned: 2 }, youtubeExpired: 1, alerts: "off" });
    expect(calls).toEqual(["youtube", "reindex:c1"]);
  });

  it("runs the alert check (Vercel has no per-minute alert loop) and reports a failure without failing the run", async () => {
    let checks = 0;
    const sent = await appWith({ checkAlerts: async () => { checks += 1; return { alerts: [] }; } });
    const ok = await sent.app.inject({ method: "GET", url: "/v1/internal/cron/daily", headers: { authorization: `Bearer ${secret}` } });
    expect(ok.json()).toMatchObject({ alerts: "sent" });
    const broken = await appWith({ checkAlerts: async () => { throw new Error("webhook down"); } });
    const res = await broken.app.inject({ method: "GET", url: "/v1/internal/cron/daily", headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ alerts: "failed", youtubeExpired: 1 });
    expect(checks).toBe(1);
  });

  it("does nothing while a worker runs the schedules", async () => {
    const { app, calls } = await appWith({ workerAvailable: async () => true });
    const res = await app.inject({ method: "GET", url: "/v1/internal/cron/daily", headers: { authorization: `Bearer ${secret}` } });
    expect(res.json()).toEqual({ skipped: "worker_running" });
    expect(calls).toEqual([]);
  });
});
