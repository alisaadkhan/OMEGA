import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, resetTables } from "@mushin/db/testing";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { addIndexedCreator } from "../creators/test-fixtures";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createFeaturedModule } from "./index";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

describe("featured creators on the customer home page (owner, 22 Nov)", () => {
  it("ranks by engagement weighted by authenticity, not followers, at most two per niche, and leaves out thin or odd engagement", async () => {
    const big = { limit: 1000, windowSeconds: 60 };
    const limiter = new MemoryRateLimiter({ ip: big, user: big, auth: big, ai: big, lookup: big, jobs: big, workspaceJobs: big, callback: big });
    const identity = createIdentityModule({ db, autoTrial: null });
    const platform = createPlatformModule({ db, ttlHours: 24 });
    const iss = await createTestIssuer();
    const app = await buildTestApp({
      guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
      modules: [platform.module, identity.module, createFeaturedModule({ db })],
    });

    await addIndexedCreator(db, { displayName: "Huge Low ER", niches: ["Comedy"], profiles: [{ followers: 5_000_000, engagementRate: 0.6 }] });
    await addIndexedCreator(db, { displayName: "Strong Food", niches: ["Food"], profiles: [{ followers: 40_000, engagementRate: 9 }] });
    await addIndexedCreator(db, { displayName: "Odd ER", niches: ["Food"], profiles: [{ followers: 40_000, engagementRate: 45 }] });
    await addIndexedCreator(db, { displayName: "Possible Minor", niches: ["Gaming"], isMinor: true, profiles: [{ followers: 40_000, engagementRate: 12 }] });
    for (const er of [8, 7, 6]) await addIndexedCreator(db, { displayName: `Bridal ${er}`, niches: ["Bridal"], profiles: [{ followers: 30_000, engagementRate: er }] });

    expect((await app.inject({ method: "GET", url: "/v1/creators/featured" })).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${await iss.sign({ sub: randomUUID(), email: "brand@shop.pk", fullName: "Brand Owner" })}` };
    const res = await app.inject({ method: "GET", url: "/v1/creators/featured", headers });
    expect(res.statusCode, res.body).toBe(200);
    const names = (res.json() as { creators: { id: string; displayName: string }[] }).creators.map((c) => c.displayName);
    expect(names[0]).toBe("Strong Food");
    expect(names).not.toContain("Odd ER");
    expect(names).not.toContain("Possible Minor");
    expect(names.filter((n) => n.startsWith("Bridal"))).toEqual(["Bridal 8", "Bridal 7"]);
    expect(names.indexOf("Huge Low ER")).toBe(names.length - 1);

    // The landing page row (owner, 23 Nov): no sign-in, the same visibility rules, three per niche, no id or contact flag.
    const pub = await app.inject({ method: "GET", url: "/v1/public/creators/showcase" });
    expect(pub.statusCode, pub.body).toBe(200);
    const shown = (pub.json() as { creators: Record<string, unknown>[] }).creators;
    const shownNames = shown.map((c) => c["displayName"]);
    expect(shownNames).not.toContain("Possible Minor");
    expect(shownNames).not.toContain("Odd ER");
    expect(shownNames.filter((n) => String(n).startsWith("Bridal"))).toEqual(["Bridal 8", "Bridal 7", "Bridal 6"]);
    expect(shown.every((c) => !("id" in c) && !("hasContact" in c))).toBe(true);
    expect(pub.headers["cache-control"]).toBe("public, max-age=600");
  });
});
