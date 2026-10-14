import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@mushin/core";
import { buildTestApp } from "./test-support/app";
import { parseInput, sendOk } from "./http/validate";

async function appWithTestRoutes() {
  return buildTestApp({
    modules: [
      {
        name: "test",
        register(app) {
          app.post("/v1/echo", async (req, reply) => {
            const body = parseInput(z.object({ name: z.string().min(2) }), req.body);
            return sendOk(reply, z.object({ hello: z.string() }), { hello: body.name });
          });
          app.get("/v1/conflict", async () => {
            throw new AppError("CONFLICT", "Already exists", { field: "x" });
          });
          app.get("/v1/boom", async () => {
            throw new Error("database password is hunter2");
          });
          app.get("/v1/bad-response", async (_req, reply) => sendOk(reply, z.object({ n: z.number() }), { n: "x" } as unknown as { n: number }));
        },
      },
    ],
  });
}

describe("API skeleton", () => {
  it("serves liveness", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("generates a request id and echoes a valid incoming one", async () => {
    const app = await appWithTestRoutes();
    const generated = await app.inject({ method: "GET", url: "/health/live" });
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await app.inject({ method: "GET", url: "/health/live", headers: { "x-request-id": "req-abc-12345" } });
    expect(echoed.headers["x-request-id"]).toBe("req-abc-12345");
  });

  it("marks every response private and not storable, errors included (PERF-001)", async () => {
    const app = await appWithTestRoutes();
    for (const [method, url] of [["GET", "/health/live"], ["POST", "/v1/echo"], ["GET", "/v1/conflict"], ["GET", "/v1/missing"]] as const) {
      const res = await app.inject({ method, url, payload: method === "POST" ? { name: "ok" } : undefined });
      expect(res.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("replaces a hostile request id (Review Focus 4)", async () => {
    const app = await appWithTestRoutes();
    for (const bad of ["bad\nid-injected", "x".repeat(10_000), "<script>alert(1)</script>"]) {
      const res = await app.inject({ method: "GET", url: "/health/live", headers: { "x-request-id": bad } });
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns VALIDATION_FAILED with field details", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "POST", url: "/v1/echo", payload: { name: "a" } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.issues[0].path).toBe("name");
    expect(body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("maps AppError to its status and envelope", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/v1/conflict" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "CONFLICT", message: "Already exists", details: { field: "x" } });
  });

  it("hides internals of unexpected errors and invalid responses", async () => {
    const app = await appWithTestRoutes();
    for (const url of ["/v1/boom", "/v1/bad-response"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe("INTERNAL");
      expect(res.body).not.toContain("hunter2");
    }
  });

  it("returns NOT_FOUND for unknown routes and malformed JSON as VALIDATION_FAILED", async () => {
    const app = await appWithTestRoutes();
    expect((await app.inject({ method: "GET", url: "/v1/nope" })).json().error.code).toBe("NOT_FOUND");
    const bad = await app.inject({ method: "POST", url: "/v1/echo", headers: { "content-type": "application/json" }, payload: "{oops" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("allows only configured CORS origins", async () => {
    const app = await appWithTestRoutes();
    const ok = await app.inject({ method: "GET", url: "/health/live", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const evil = await app.inject({ method: "GET", url: "/health/live", headers: { origin: "https://evil.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports readiness per check", async () => {
    const app = await buildTestApp({
      readiness: [
        { name: "database", check: async () => "ok" },
        { name: "redis", check: async () => { throw new Error("down"); } },
      ],
    });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", checks: { database: "ok", redis: "down" } });
  });
});
