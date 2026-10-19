import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { MemoryRateLimiter } from "../rate-limit/memory";
import { buildTestApp, noGuards } from "../test-support/app";
import { createTestIssuer } from "../test-support/keys";
import { createCustomerGuard, tenantOf } from "./customer-guard";
import { createCustomerTokenVerifier } from "./customer-token";

async function setup() {
  const iss = await createTestIssuer();
  const verify = createCustomerTokenVerifier({ issuer: iss.issuer, audience: iss.audience, keys: iss.keys });
  return { iss, verify };
}

describe("customer token verifier", () => {
  it("accepts a valid Supabase-style token", async () => {
    const { iss, verify } = await setup();
    const sub = randomUUID();
    const identity = await verify(await iss.sign({ sub, email: "Ahmed@Mushin.PK", fullName: "Ahmed Raza" }));
    expect(identity).toEqual({ userId: sub, email: "ahmed@mushin.pk", fullName: "Ahmed Raza" });
    // Audit SEC-03: user-editable user_metadata.email_verified is not read at all; nothing in the identity can claim it.
    expect(Object.keys(await verify(await iss.sign({ sub, email: "a@mushin.pk", emailVerified: true })))).toEqual(["userId", "email", "fullName"]);
  });

  it.each([
    ["expired", { expiresIn: "-1m" }],
    ["wrong issuer", { issuer: "https://other.supabase.co/auth/v1" }],
    ["wrong audience", { audience: "anon" }],
    ["no email (anonymous user) — Review Focus 3", { email: null }],
    ["non-uuid subject — Review Focus 3", { sub: "not-a-uuid" }],
  ])("rejects %s", async (_name, claims) => {
    const { iss, verify } = await setup();
    await expect(verify(await iss.sign(claims))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects tampered tokens, HS256 tokens and tokens from another key", async () => {
    const { iss, verify } = await setup();
    const good = await iss.sign();
    const [h, p, s] = good.split(".");
    const tampered = [h, Buffer.from(JSON.stringify({ sub: randomUUID(), email: "x@y.z" })).toString("base64url"), s].join(".");
    await expect(verify(tampered)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(p).toBeDefined();

    const hs = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(randomUUID())
      .setIssuer(iss.issuer)
      .setAudience(iss.audience)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("x".repeat(40)));
    await expect(verify(hs)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const other = await createTestIssuer();
    await expect(verify(await other.sign())).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("customer guard", () => {
  async function appWithGuard(limit = 100) {
    const { iss, verify } = await setup();
    const resolved: string[] = [];
    const guard = createCustomerGuard({
      verify,
      limiter: new MemoryRateLimiter({
        ip: { limit: 100, windowSeconds: 60 },
        user: { limit, windowSeconds: 60 },
        auth: { limit: 100, windowSeconds: 60 },
        ai: { limit: 100, windowSeconds: 60 },
        jobs: { limit: 100, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 }, callback: { limit: 1000, windowSeconds: 3600 },
      }),
      resolveTenant: async (identity, requestId): Promise<TenantContext> => {
        resolved.push(identity.userId);
        return { requestId, userId: identity.userId, workspaceId: randomUUID(), role: "owner" };
      },
    });
    const app = await buildTestApp({
      guards: { ...noGuards(), customer: guard },
      modules: [
        {
          name: "probe",
          register(a, guards) {
            a.get("/v1/probe", { preHandler: guards.customer }, async (req) => ({ userId: tenantOf(req).userId }));
          },
        },
      ],
    });
    return { app, iss, resolved };
  }

  it("rejects missing or malformed Authorization headers", async () => {
    const { app } = await appWithGuard();
    for (const authorization of [undefined, "Basic abc", "Bearer"]) {
      const res = await app.inject({ method: "GET", url: "/v1/probe", headers: authorization ? { authorization } : {} });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("authenticates, resolves the tenant and exposes it to the handler", async () => {
    const { app, iss, resolved } = await appWithGuard();
    const sub = randomUUID();
    const res = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${await iss.sign({ sub })}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: sub });
    expect(resolved).toEqual([sub]);
  });

  it("rate-limits per user", async () => {
    const { app, iss } = await appWithGuard(1);
    const token = await iss.sign();
    expect((await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(429);
  });
});
