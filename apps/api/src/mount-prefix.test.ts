import { describe, expect, it } from "vitest";
import { stripPathPrefix } from "./app";
import { cookiePathFor } from "./modules/staff/routes";
import { buildTestApp } from "./test-support/app";

// Vercel serves the API under /api and forwards the path unchanged (vercel.json rewrite to the api service).
describe("API mounted under a path prefix", () => {
  it("strips only the mount prefix", () => {
    expect(stripPathPrefix("/api/v1/me", "/api")).toBe("/v1/me");
    expect(stripPathPrefix("/api", "/api")).toBe("/");
    expect(stripPathPrefix("/api?x=1", "/api")).toBe("?x=1");
    expect(stripPathPrefix("/apix/v1/me", "/api")).toBe("/apix/v1/me");
    expect(stripPathPrefix("/v1/me", "/api")).toBe("/v1/me");
    expect(stripPathPrefix("/api/v1/me", "")).toBe("/api/v1/me");
  });

  it("routes /api/… to the API's own routes, and still serves unprefixed paths", async () => {
    const app = await buildTestApp({ pathPrefix: "/api" });
    expect((await app.inject({ method: "GET", url: "/api/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/apix/health/live" })).statusCode).toBe(404);
  });

  it("is a no-op without a prefix (local development behind the Vite proxy)", async () => {
    const app = await buildTestApp();
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/health/live" })).statusCode).toBe(404);
  });

  it("scopes the staff refresh cookie to the path the browser sees", () => {
    const at = (originalUrl: string, url: string) => cookiePathFor({ originalUrl, url } as Parameters<typeof cookiePathFor>[0]);
    expect(at("/api/admin/v1/auth/refresh", "/admin/v1/auth/refresh")).toBe("/api/admin/v1/auth");
    expect(at("/admin/v1/auth/refresh", "/admin/v1/auth/refresh")).toBe("/admin/v1/auth");
  });
});
