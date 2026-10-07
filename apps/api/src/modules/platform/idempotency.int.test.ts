import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, resetTables } from "@mushin/db/testing";
import { buildTestApp, noGuards } from "../../test-support/app";
import { createPlatformModule } from "./index";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function appWithCounter() {
  let executions = 0;
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const workspaceId = randomUUID();
  const fakeCustomer = async (req: { tenant: unknown }) => {
    req.tenant = { requestId: "r", userId: randomUUID(), workspaceId, role: "owner" };
  };
  const app = await buildTestApp({
    guards: { ...noGuards(), customer: fakeCustomer, idempotent: platform.requireIdempotencyKey },
    modules: [
      platform.module,
      {
        name: "probe",
        register(a, guards) {
          a.post("/v1/spend", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) => {
            executions += 1;
            const body = req.body as { fail?: boolean };
            if (body.fail) throw new Error("boom");
            return reply.status(201).send({ execution: executions });
          });
        },
      },
    ],
  });
  return { app, count: () => executions };
}

const post = (app: Awaited<ReturnType<typeof appWithCounter>>["app"], key: string | null, payload: object) =>
  app.inject({ method: "POST", url: "/v1/spend", payload, headers: key ? { "idempotency-key": key } : {} });

describe("Idempotency-Key", () => {
  it("is required", async () => {
    const { app } = await appWithCounter();
    const res = await post(app, null, { amount: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Idempotency-Key/);
  });

  it("replays the stored response without executing twice", async () => {
    const { app, count } = await appWithCounter();
    const first = await post(app, "key-00000001", { amount: 5 });
    const again = await post(app, "key-00000001", { amount: 5 });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(count()).toBe(1);
  });

  it("rejects the same key with a different body", async () => {
    const { app } = await appWithCounter();
    await post(app, "key-00000002", { amount: 5 });
    const res = await post(app, "key-00000002", { amount: 6 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("lets a request retry after a server error", async () => {
    const { app, count } = await appWithCounter();
    expect((await post(app, "key-00000003", { fail: true })).statusCode).toBe(500);
    expect((await post(app, "key-00000003", { fail: true })).statusCode).toBe(500);
    expect(count()).toBe(2);
  });
});
