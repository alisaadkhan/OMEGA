import type { FastifyInstance } from "fastify";
import { healthLiveSchema, healthReadySchema } from "@mushin/contracts";
import type { ReadinessCheck } from "./types";
import { sendOk } from "./validate";

const TIMEOUT_MS = 3000;

async function run(check: ReadinessCheck): Promise<"ok" | "down" | "skipped"> {
  const timeout = new Promise<"down">((resolve) => setTimeout(() => resolve("down"), TIMEOUT_MS).unref());
  try {
    return await Promise.race([check.check(), timeout]);
  } catch {
    return "down";
  }
}

export function registerHealth(app: FastifyInstance, checks: ReadinessCheck[]): void {
  app.get("/health/live", async (_req, reply) => sendOk(reply, healthLiveSchema, { status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    const results = await Promise.all(checks.map(async (c) => [c.name, await run(c)] as const));
    const degraded = results.some(([, r]) => r === "down");
    return sendOk(
      reply,
      healthReadySchema,
      { status: degraded ? "degraded" : "ok", checks: Object.fromEntries(results) },
      degraded ? 503 : 200,
    );
  });
}
