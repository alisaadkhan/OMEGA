import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security audit 2026-10-27 (ASVS V8 / API5): every route is registered behind a guard unless it is on the public list
 * below. A new route without `read`/`write`/`auth`/`staffOnly` or a `preHandler` fails here, so a forgotten guard is
 * caught before review. Public routes authenticate otherwise (signatures, staff login) or only accept harmless input.
 */
const PUBLIC = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /v1/public/plans",
  "POST /v1/public/removal-requests", // rate-limited by IP, answers the same whether or not a creator matched
  "POST /v1/public/email-unsubscribe", // signed unsubscribe token
  "POST /v1/public/trial-requests", // rate-limited per address, small body
  "POST /admin/v1/auth/login", // staff sign-in itself
  "POST /admin/v1/auth/totp",
  "POST /admin/v1/auth/refresh", // httpOnly refresh cookie
  "POST /admin/v1/auth/logout",
  "POST /webhooks/paddle", // provider signature verified on the raw body
  "POST /webhooks/resend", // provider signature verified on the raw body
  // Mock checkout pages: registered only with the mock payment provider, which config refuses in production
  // (PADDLE_API_KEY required). Reaching one needs the workspace id and the random checkout id.
  "GET /mock-paddle/checkout/:workspaceId/:id",
  "POST /mock-paddle/checkout/:workspaceId/:id/${outcome}",
]);
const GUARD_NAMES = new Set(["read", "write", "auth", "staffOnly"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith(".ts") && !p.includes(".test.") ? [p] : [];
  });
}

type Route = { route: string; file: string; guarded: boolean };

export function routesIn(root: string): Route[] {
  const out: Route[] = [];
  // Lookahead keeps the second argument out of the match, so routes written close together are all found.
  const re = /\b(?:app|scope)\.(get|post|put|patch|delete)\(\s*[`"]([^`"]+)[`"]\s*,(?=([\s\S]{0,240}))/g;
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      const arg = (m[3] ?? "").trimStart();
      const ident = /^([A-Za-z_]\w*)\s*,/.exec(arg)?.[1];
      const options = arg.startsWith("{") ? arg.slice(0, Math.max(arg.indexOf("async"), 0) || arg.length) : "";
      const guarded = (ident !== undefined && GUARD_NAMES.has(ident)) || /preHandler\s*:/.test(options);
      out.push({ route: `${(m[1] as string).toUpperCase()} ${m[2]}`, file: relative(root, file), guarded });
    }
  }
  return out;
}

describe("route guards (security audit)", () => {
  const routes = routesIn(join(__dirname));

  it("finds the API's routes", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("registers every non-public route behind a guard", () => {
    const unguarded = routes.filter((r) => !r.guarded && !PUBLIC.has(r.route)).map((r) => `${r.route} (${r.file})`);
    expect(unguarded).toEqual([]);
  });

  it("keeps the public list exact: no stale entry, nothing public that has a guard", () => {
    const open = new Set(routes.filter((r) => !r.guarded).map((r) => r.route));
    expect([...PUBLIC].filter((r) => !open.has(r))).toEqual([]);
  });
});
