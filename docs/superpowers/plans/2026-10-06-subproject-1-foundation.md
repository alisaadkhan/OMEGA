# Sub-project 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the MUSHIN backend foundation (monorepo, config, errors, logging, API server, customer + staff auth, rate limiting, adapters base, database with roles and RLS, identity provisioning, outbox + worker, idempotency) and make real signup, login and logout work in the existing frontend.

**Architecture:** npm-workspaces monorepo. `apps/api` is a Fastify modular monolith; `apps/worker` runs pg-boss consumers and the outbox relay. Shared code lives in `packages/{contracts,core,db,integrations}`. Every database transaction switches to a restricted role (`mushin_app` / `mushin_worker`) and sets transaction-local tenant settings that Postgres RLS policies check.

**Tech Stack:** Node 24, TypeScript 5.9.3 (strict), Fastify 5, Zod 4, Drizzle ORM 0.45 (query builder only) + postgres.js 3, hand-written SQL migrations, pg-boss 12, jose 6, @node-rs/argon2 2, otplib 13, pino 10, @upstash/ratelimit 2, Vitest 5, ESLint 10 + typescript-eslint 8, dependency-cruiser 18, React 18 + Vite 6 frontend with @supabase/supabase-js 2 and @tanstack/react-query 5.

**Spec:** `docs/superpowers/specs/2026-10-06-mushin-backend-architecture-design.md` (umbrella spec; this plan implements §3 row 1 "Foundation").

## Global Constraints

- TypeScript `strict`, `noUncheckedIndexedAccess`; **no `any`** (`@typescript-eslint/no-explicit-any: error`).
- TypeScript is pinned to **5.9.3** (typescript-eslint 8 supports `<6.1`).
- Module rules (spec §4.4): a module under `apps/api/src/modules/<m>/` is imported by others **only through its `index.ts`**; only repositories touch the DB; routes → service → repository. Enforced by dependency-cruiser.
- `packages/db/src/client.ts` (the raw postgres.js client) may be imported **only** from inside `packages/db/src/`. Code reaches the DB only through `withTenant`, `withUser`, `withSystem` (spec §4.2).
- RLS policies use `platform.current_workspace_id()` / `platform.current_user_id()`, which return `NULL` when unset or empty → zero rows (fail closed).
- Error envelope: `{ "error": { "code", "message", "details"?, "requestId" } }`; codes and HTTP statuses exactly as spec §8.1.
- REST under `/v1` (customer) and `/admin/v1` (staff); JSON camelCase; timestamps ISO-8601 UTC.
- Customer JWT: verify via JWKS with `jose`, algorithms **`RS256`/`ES256` only**, `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`.
- Staff JWT: **HS256**, secret `STAFF_JWT_SECRET` (≥ 32 chars), `iss = mushin-staff`, `aud = mushin-admin`, access TTL **15 min**; refresh token in httpOnly, `Secure`, `SameSite=Strict` cookie scoped to `/admin/v1/auth`; refresh rotates; reuse revokes the session family.
- Staff passwords: argon2id. Staff TOTP is **mandatory**. Login lockout: **5** failures → locked **15 min**.
- Encryption at rest: AES-256-GCM with `DATA_ENCRYPTION_KEY` (32 bytes, base64).
- Migrations are additive (expand-contract); an applied migration file is never edited (the runner rejects checksum changes).
- Append-only tables (`staff.audit_log` in this sub-project): no `UPDATE`/`DELETE` grants to app roles.
- Logs: pino JSON with `requestId`; redact authorization, cookies, tokens, passwords, secrets; mask email local parts.
- Database TLS: when `DATABASE_SSL_CA_FILE` points to Supabase's CA certificate (Dashboard → Project Settings → Database → SSL Configuration → Download certificate), every connection (API, worker, pg-boss, migrations, tests) **verifies** the server certificate. Without it, connections are encrypted but unverified and a warning is logged; in `NODE_ENV=production` the CA file is **required** (config error otherwise). TLS verification is never disabled silently.
- Tests: Vitest. Unit tests `*.test.ts`; DB tests `*.int.test.ts` run serially against **`TEST_DATABASE_URL` only** (never `DATABASE_URL`/`DIRECT_URL`).
- Definition of done per task: `npm run verify` passes (lint + typecheck + boundaries + all tests), then commit. Commit messages end with the session's attribution lines.
- Frontend changes are wiring only: no redesign.

## Review Focus

1. **Pooled connection residue:** a pooled connection that previously ran `set_config('app.workspace_id', …, true)` keeps the setting defined as `''`; a later transaction without context must return zero rows, not throw `invalid input syntax for type uuid`. → Test in Task 10 (`same connection, different scopes`).
2. **Concurrent first requests** from a brand-new user (several tabs, retries) must create exactly **one** user, workspace and membership. → Test in Task 12 (`concurrent provisioning`).
3. **Tokens without an email** (Supabase anonymous sign-ins) or with a non-UUID `sub` must be rejected with 401, not provision a broken account. → Test in Task 7.
4. **Hostile `X-Request-Id`** (newlines, 10 KB strings, log-injection payloads) must be replaced with a generated UUID, never echoed or logged. → Test in Task 5.
5. **A migration edited after it was applied** must stop the runner with a clear message instead of silently drifting. → Test in Task 10.

---

## File Map

```
package.json                     root workspace + scripts
tsconfig.json                    one strict config used for typecheck
eslint.config.js                 flat config
.dependency-cruiser.cjs          module boundary + raw-client rules
vitest.config.ts                 projects: unit, int
.env.example                     variable names only (updated)
scripts/
  ensure-env-secrets.ts          adds DATA_ENCRYPTION_KEY / STAFF_JWT_SECRET if missing
  create-admin.ts                first staff admin + TOTP QR
packages/contracts/src/          errors.ts, health.ts, me.ts, staff.ts, index.ts
packages/core/src/               config.ts, errors.ts, logger.ts, crypto.ts, context.ts, provider-calls.ts, index.ts
packages/integrations/src/       instrumented.ts, memory-sink.ts, index.ts
packages/db/
  migrations/0001_foundation.sql, 0002_identity.sql, 0003_staff.sql, 0004_platform.sql
  src/client.ts                  raw postgres.js client (internal)
  src/database.ts                createDatabase → withTenant / withUser / withSystem / listen / ping / close
  src/migrate.ts, migrate-cli.ts migration runner
  src/schema/{identity,staff,platform,index}.ts   Drizzle table definitions
  src/outbox.ts, provider-calls.ts
  src/testing.ts                 test DB helpers (exported as @mushin/db/testing)
  test/global-setup.ts           migrates the test DB once per run
apps/api/src/
  app.ts                         buildApp(deps)
  server.ts                      composition root
  http/{request-id,errors,validate,security,health,bearer,types}.ts
  rate-limit/{types,memory,upstash,plugin}.ts
  auth/{customer-token,customer-guard}.ts
  test-support/{keys,app}.ts     test-only helpers
  modules/identity/{repository,service,routes,index}.ts
  modules/staff/{passwords,totp,tokens,permissions,repository,service,routes,index}.ts
  modules/platform/{idempotency,repository,index}.ts
apps/worker/src/
  queues.ts, dispatcher.ts, handlers.ts, relay.ts, boss.ts, worker.ts, main.ts
frontend/
  vite.config.ts                 env from repo root, /api proxy, @mushin/contracts alias
  src/main.tsx                   QueryClientProvider
  src/app/lib/supabase.ts
  src/app/api/{http,client}.ts   (+ http.test.ts)
  src/app/auth/AuthContext.tsx   real Supabase auth
  src/app/App.tsx, components/auth/{Login,Signup,ForgotPassword}.tsx, dashboard/Topbar.tsx, landing/Navbar.tsx
```

---

### Task 1: Workspace & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.dependency-cruiser.cjs`, `vitest.config.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/src/index.ts`, `packages/core/package.json`, `packages/core/src/index.ts`, `packages/integrations/package.json`, `packages/integrations/src/index.ts`, `packages/db/package.json`, `packages/db/src/index.ts`, `apps/api/package.json`, `apps/worker/package.json`
- Test: `packages/core/src/smoke.test.ts` (deleted at the end of the task)

**Interfaces:**
- Produces: root scripts `lint`, `typecheck`, `boundaries`, `test`, `test:unit`, `test:int`, `verify`, `dev*`, `db:migrate*`, `create-admin`; workspace package names `@mushin/contracts`, `@mushin/core`, `@mushin/integrations`, `@mushin/db`, `@mushin/api`, `@mushin/worker`. Every workspace package exports TypeScript source (`"exports": { ".": "./src/index.ts" }`).

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "mushin",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "concurrently -n api,worker,web -c blue,magenta,green \"npm:dev:api\" \"npm:dev:worker\" \"npm:dev:web\"",
    "dev:api": "node --env-file-if-exists=.env --watch --import tsx apps/api/src/server.ts",
    "dev:worker": "node --env-file-if-exists=.env --watch --import tsx apps/worker/src/main.ts",
    "dev:web": "npm --prefix frontend run dev",
    "db:migrate": "node --env-file-if-exists=.env --import tsx packages/db/src/migrate-cli.ts",
    "db:migrate:test": "node --env-file-if-exists=.env --import tsx packages/db/src/migrate-cli.ts --test",
    "create-admin": "node --env-file-if-exists=.env --import tsx scripts/create-admin.ts",
    "env:secrets": "node --import tsx scripts/ensure-env-secrets.ts",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json",
    "boundaries": "depcruise apps packages scripts --config .dependency-cruiser.cjs",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:int": "vitest run --project int",
    "verify": "npm run lint && npm run typecheck && npm run boundaries && npm run test"
  }
}
```

- [ ] **Step 2: Create the workspace package manifests**

`packages/contracts/package.json`:
```json
{ "name": "@mushin/contracts", "private": true, "type": "module", "exports": { ".": "./src/index.ts" } }
```
`packages/core/package.json`:
```json
{ "name": "@mushin/core", "private": true, "type": "module", "exports": { ".": "./src/index.ts" } }
```
`packages/integrations/package.json`:
```json
{ "name": "@mushin/integrations", "private": true, "type": "module", "exports": { ".": "./src/index.ts" } }
```
`packages/db/package.json`:
```json
{ "name": "@mushin/db", "private": true, "type": "module", "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" } }
```
`apps/api/package.json`:
```json
{ "name": "@mushin/api", "private": true, "type": "module" }
```
`apps/worker/package.json`:
```json
{ "name": "@mushin/worker", "private": true, "type": "module" }
```
Each `src/index.ts` for contracts, core, integrations and db starts as:
```ts
export {};
```

- [ ] **Step 3: Install dependencies**

Run (from repo root):
```bash
npm install -D typescript@5.9.3 @types/node@^24 tsx@^4 vitest@^5 eslint@^10 @eslint/js@^10 typescript-eslint@^8 dependency-cruiser@^18 concurrently@^10
npm install zod@^4 -w @mushin/contracts
npm install zod@^4 pino@^10 -w @mushin/core
npm install drizzle-orm@^0.45 postgres@^3 -w @mushin/db
npm install fastify@^5 @fastify/cors@^11 @fastify/helmet@^13 @fastify/cookie@^11 jose@^6 @node-rs/argon2@^2 otplib@^13 @upstash/ratelimit@^2 @upstash/redis@^1 -w @mushin/api
npm install pg-boss@^12 -w @mushin/worker
npm install qrcode-terminal@^0.12 && npm install -D @types/qrcode-terminal@^0.12
```
Expected: installs complete; `node_modules/@mushin/*` are symlinks to the workspace folders. If `@eslint/js@^10` does not exist, install the latest `@eslint/js` major that lists `eslint@^10` as a peer.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": [
    "apps/*/src/**/*.ts",
    "packages/*/src/**/*.ts",
    "packages/*/test/**/*.ts",
    "scripts/**/*.ts",
    "vitest.config.ts",
    "frontend/src/app/api/http.ts",
    "frontend/src/app/api/http.test.ts"
  ]
}
```
(`DOM` is included only for `fetch`/`Response` types used by `frontend/src/app/api/http.ts`.)

- [ ] **Step 5: Create `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["frontend/**", "**/node_modules/**", "**/dist/**", "docs/**", "reference_files/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  { files: ["scripts/**", "packages/db/src/migrate-cli.ts"], rules: { "no-console": "off" } },
]);
```
Note: `frontend/**` is ignored by ESLint (the frontend has no lint setup); `frontend/src/app/api/http.ts` is still typechecked and unit-tested from the root.

- [ ] **Step 6: Create `.dependency-cruiser.cjs`**

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internals",
      comment: "A module may only import another module through its index.ts (spec §4.4).",
      severity: "error",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/[^/]+/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "no-module-internals-from-outside",
      comment: "Code outside the modules folder uses modules only through index.ts.",
      severity: "error",
      from: { pathNot: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: "^apps/api/src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "raw-db-client-is-private",
      comment: "Only packages/db may use the raw postgres client (spec §4.2).",
      severity: "error",
      from: { pathNot: "^packages/db/src/" },
      to: { path: "^packages/db/src/client\\.ts$" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "(^|/)node_modules/" },
  },
};
```

- [ ] **Step 7: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: unit tests still run; integration tests fail with a clear message.
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "frontend/src/app/api/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "int",
          environment: "node",
          include: ["apps/*/src/**/*.int.test.ts", "packages/*/src/**/*.int.test.ts"],
          globalSetup: ["packages/db/test/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
```
Until Task 10 creates `packages/db/test/global-setup.ts`, run only the unit project; `npm run test` is used from Task 10 on.

- [ ] **Step 8: Write a smoke test proving the toolchain**

`packages/core/src/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    const value: number = 2 + 2;
    expect(value).toBe(4);
  });
});
```

- [ ] **Step 9: Run every check**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit`
Expected: lint 0 problems; tsc no errors; depcruise "no dependency violations found"; vitest `1 passed`.

- [ ] **Step 10: Delete the smoke test and commit**

```bash
rm packages/core/src/smoke.test.ts
git add -A
git commit -m "chore: set up npm workspaces, TypeScript, ESLint, Vitest and module boundary checks"
```

---

### Task 2: Shared contracts and the error model

**Files:**
- Create: `packages/contracts/src/errors.ts`, `packages/contracts/src/health.ts`, `packages/contracts/src/me.ts`, `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/core/src/errors.ts`, `packages/core/src/context.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (dependency on `@mushin/contracts`)
- Test: `packages/contracts/src/contracts.test.ts`, `packages/core/src/errors.test.ts`

**Interfaces:**
- Produces (contracts): `ERROR_CODES`, `errorCodeSchema`, `type ErrorCode`, `errorEnvelopeSchema`, `type ErrorEnvelope`, `healthLiveSchema`, `healthReadySchema`, `meResponseSchema`, `type MeResponse`, `workspaceRoleSchema`, `staffRoleSchema`, `staffLoginRequestSchema`, `staffLoginResponseSchema`, `staffTotpRequestSchema`, `staffProfileSchema`, `staffSessionResponseSchema`, `staffMeResponseSchema`.
- Produces (core): `class AppError(code: ErrorCode, message: string, details?: Record<string, unknown>, options?: { cause?: unknown })` with `.status: number`; `ERROR_STATUS: Record<ErrorCode, number>`; `type WorkspaceRole = "owner" | "admin" | "member"`; `type TenantContext = { requestId: string; userId: string; workspaceId: string; role: WorkspaceRole }`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/contracts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema, meResponseSchema, staffLoginRequestSchema, staffTotpRequestSchema } from "./index";

describe("contracts", () => {
  it("accepts a valid error envelope and rejects unknown codes", () => {
    expect(errorEnvelopeSchema.safeParse({ error: { code: "NOT_FOUND", message: "x", requestId: "r1" } }).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { code: "TEAPOT", message: "x", requestId: "r1" } }).success).toBe(false);
  });

  it("normalizes staff login email", () => {
    const parsed = staffLoginRequestSchema.parse({ email: "  Admin@Mushin.PK ", password: "pw" });
    expect(parsed.email).toBe("admin@mushin.pk");
  });

  it("requires a six-digit TOTP code", () => {
    expect(staffTotpRequestSchema.safeParse({ challengeToken: "t", code: "123456" }).success).toBe(true);
    expect(staffTotpRequestSchema.safeParse({ challengeToken: "t", code: "12345a" }).success).toBe(false);
  });

  it("describes the /v1/me response", () => {
    const ok = meResponseSchema.safeParse({
      user: { id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10", email: "a@b.pk", displayName: null, avatarUrl: null },
      workspace: { id: "0b7d7c3e-5d1a-4f7e-8c2b-9a1e3f4d5c6b", name: "A's workspace", role: "owner" },
    });
    expect(ok.success).toBe(true);
  });
});
```

`packages/core/src/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AppError, ERROR_STATUS } from "./errors";

describe("AppError", () => {
  it("maps every code to the spec's HTTP status", () => {
    expect(ERROR_STATUS).toEqual({
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      INSUFFICIENT_CREDITS: 402,
      FORBIDDEN: 403,
      ENTITLEMENT_REQUIRED: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      IDEMPOTENCY_KEY_REUSED: 422,
      RATE_LIMITED: 429,
      INTERNAL: 500,
      PROVIDER_UNAVAILABLE: 503,
    });
  });

  it("carries code, status, details and cause", () => {
    const cause = new Error("root");
    const err = new AppError("CONFLICT", "Already exists", { field: "email" }, { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ field: "email" });
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run --project unit packages/contracts packages/core`
Expected: FAIL, cannot resolve `./index` exports / `./errors`.

- [ ] **Step 3: Implement the contracts**

`packages/contracts/src/errors.ts`:
```ts
import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "INSUFFICIENT_CREDITS",
  "FORBIDDEN",
  "ENTITLEMENT_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "INTERNAL",
  "PROVIDER_UNAVAILABLE",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
```

`packages/contracts/src/health.ts`:
```ts
import { z } from "zod";

export const healthLiveSchema = z.object({ status: z.literal("ok") });

export const healthReadySchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.enum(["ok", "down", "skipped"])),
});
```

`packages/contracts/src/me.ts`:
```ts
import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  workspace: z.object({
    id: z.uuid(),
    name: z.string(),
    role: workspaceRoleSchema,
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
```

`packages/contracts/src/staff.ts`:
```ts
import { z } from "zod";

export const staffRoleSchema = z.enum(["admin", "support"]);

export const staffLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(200),
});
export const staffLoginResponseSchema = z.object({ challengeToken: z.string() });

export const staffTotpRequestSchema = z.object({
  challengeToken: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/, "must be a 6-digit code"),
});

export const staffProfileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: staffRoleSchema,
});

export const staffSessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  staff: staffProfileSchema,
});

export const staffMeResponseSchema = z.object({ staff: staffProfileSchema });
```

`packages/contracts/src/index.ts`:
```ts
export * from "./errors";
export * from "./health";
export * from "./me";
export * from "./staff";
```

- [ ] **Step 4: Implement core errors and context**

Add the dependency in `packages/core/package.json`:
```json
{ "name": "@mushin/core", "private": true, "type": "module", "exports": { ".": "./src/index.ts" }, "dependencies": { "@mushin/contracts": "*", "pino": "^10.0.0", "zod": "^4.0.0" } }
```
Then run `npm install` so the workspace link is recorded.

`packages/core/src/errors.ts`:
```ts
import type { ErrorCode } from "@mushin/contracts";

export type { ErrorCode };

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  ENTITLEMENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PROVIDER_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    this.status = ERROR_STATUS[code];
  }
}
```

`packages/core/src/context.ts`:
```ts
export type WorkspaceRole = "owner" | "admin" | "member";

export type TenantContext = {
  requestId: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};
```

`packages/core/src/index.ts`:
```ts
export * from "./errors";
export * from "./context";
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit packages/contracts packages/core`
Expected: PASS (6 tests).

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → all pass.
```bash
git add -A
git commit -m "feat(contracts,core): add shared API contracts and typed AppError"
```

---

### Task 3: Configuration and environment secrets

**Files:**
- Create: `packages/core/src/config.ts`, `scripts/ensure-env-secrets.ts`
- Modify: `packages/core/src/index.ts`, `.env` (local only, never committed), `.env.example`
- Test: `packages/core/src/config.test.ts`

**Interfaces:**
- Produces: `class ConfigError extends Error { issues: string[] }`; `loadApiConfig(env: Record<string, string | undefined>): ApiConfig`; `loadWorkerConfig(env): WorkerConfig`;
  ```ts
  type ApiConfig = {
    nodeEnv: "development" | "test" | "production"; logLevel: LogLevel; port: number;
    allowedOrigins: string[]; databaseUrl: string;
    auth: { issuer: string; audience: string; jwksUri: string };
    staffJwtSecret: string; dataEncryptionKey: Buffer;
    rateLimit: { windowMs: number; maxRequests: number; upstash: { url: string; token: string } | null };
    idempotencyTtlHours: number;
    databaseCaPem: string | null;
  };
  type WorkerConfig = { nodeEnv: ApiConfig["nodeEnv"]; logLevel: LogLevel; directUrl: string; databaseCaPem: string | null };
  type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readCaFile(path: string | undefined): string | null   // reads the PEM file; throws ConfigError if unreadable
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/src/config.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig, loadWorkerConfig } from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
const valid = {
  NODE_ENV: "development",
  PORT: "4000",
  APP_URL: "http://localhost:5173",
  ALLOWED_PREVIEW_ORIGINS: "https://preview.mushin.pk, https://staging.mushin.pk",
  DATABASE_URL: "postgresql://u:p@db.example.com:6543/postgres",
  SUPABASE_URL: "https://abc.supabase.co",
  JWT_ISSUER: "https://abc.supabase.co/auth/v1",
  JWT_AUDIENCE: "authenticated",
  JWKS_URI: "https://abc.supabase.co/auth/v1/.well-known/jwks.json",
  STAFF_JWT_SECRET: "s".repeat(40),
  DATA_ENCRYPTION_KEY: KEY,
};

describe("loadApiConfig", () => {
  it("parses a valid environment", () => {
    const c = loadApiConfig(valid);
    expect(c.port).toBe(4000);
    expect(c.allowedOrigins).toEqual(["http://localhost:5173", "https://preview.mushin.pk", "https://staging.mushin.pk"]);
    expect(c.dataEncryptionKey).toHaveLength(32);
    expect(c.rateLimit).toEqual({ windowMs: 60_000, maxRequests: 120, upstash: null });
    expect(c.idempotencyTtlHours).toBe(24);
    expect(c.logLevel).toBe("info");
  });

  it("lists every problem at once and treats blank values as missing", () => {
    const run = () => loadApiConfig({ ...valid, DATABASE_URL: "  ", STAFF_JWT_SECRET: "short" });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (err) {
      const issues = (err as ConfigError).issues.join("\n");
      expect(issues).toContain("DATABASE_URL");
      expect(issues).toContain("STAFF_JWT_SECRET");
    }
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => loadApiConfig({ ...valid, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it("requires both Upstash values or neither", () => {
    expect(() => loadApiConfig({ ...valid, UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
    const c = loadApiConfig({ ...valid, UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(c.rateLimit.upstash).toEqual({ url: "https://x.upstash.io", token: "t" });
  });
});

describe("loadWorkerConfig", () => {
  it("needs DIRECT_URL and rejects the placeholder host", () => {
    expect(loadWorkerConfig({ DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres" }).directUrl).toContain("pooler");
    expect(() => loadWorkerConfig({ DIRECT_URL: "postgresql://user:password@host:5432/postgres" })).toThrow(/DIRECT_URL/);
  });
});

describe("database CA certificate", () => {
  it("is optional in development and loaded when configured", () => {
    expect(loadApiConfig(valid).databaseCaPem).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "mushin-ca-"));
    const file = join(dir, "supabase-ca.crt");
    writeFileSync(file, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    expect(loadApiConfig({ ...valid, DATABASE_SSL_CA_FILE: file }).databaseCaPem).toContain("BEGIN CERTIFICATE");
  });

  it("is required in production and must be readable", () => {
    expect(() => loadApiConfig({ ...valid, NODE_ENV: "production" })).toThrow(/DATABASE_SSL_CA_FILE/);
    expect(() => loadApiConfig({ ...valid, DATABASE_SSL_CA_FILE: "/definitely/missing.crt" })).toThrow(/DATABASE_SSL_CA_FILE/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/core/src/config.test.ts`
Expected: FAIL, cannot find `./config`.

- [ ] **Step 3: Implement `packages/core/src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info");
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string")
  .refine((v) => !/@host:\d+\//.test(v), "is still the placeholder value; paste the real connection string");

const apiSchema = z
  .object({
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    APP_URL: z.url().default("http://localhost:5173"),
    ALLOWED_PREVIEW_ORIGINS: z.string().default(""),
    DATABASE_URL: postgresUrl,
    SUPABASE_URL: z.url(),
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1).default("authenticated"),
    JWKS_URI: z.url(),
    STAFF_JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded"),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
    DATABASE_SSL_CA_FILE: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.UPSTASH_REDIS_REST_URL) !== Boolean(v.UPSTASH_REDIS_REST_TOKEN)) {
      const missing = v.UPSTASH_REDIS_REST_URL ? "UPSTASH_REDIS_REST_TOKEN" : "UPSTASH_REDIS_REST_URL";
      ctx.addIssue({ code: "custom", path: [missing], message: "set both Upstash values or neither" });
    }
    requireCaInProduction(v, ctx);
  });

const workerSchema = z
  .object({ NODE_ENV: nodeEnv, LOG_LEVEL: logLevel, DIRECT_URL: postgresUrl, DATABASE_SSL_CA_FILE: z.string().optional() })
  .superRefine(requireCaInProduction);

function requireCaInProduction(v: { NODE_ENV: string; DATABASE_SSL_CA_FILE?: string | undefined }, ctx: z.RefinementCtx) {
  if (v.NODE_ENV === "production" && !v.DATABASE_SSL_CA_FILE) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_SSL_CA_FILE"], message: "is required in production so database TLS certificates are verified" });
  }
}

/** Reads the database CA certificate (PEM). Returns null when no path is configured. */
export function readCaFile(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new ConfigError([`DATABASE_SSL_CA_FILE: cannot read ${path}`]);
  }
}

function clean(env: Env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === undefined || v.trim() === "" ? undefined : v.trim();
  return out;
}

function parse<S extends z.ZodType>(schema: S, env: Env): z.output<S> {
  const result = schema.safeParse(clean(env));
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: LogLevel;
  port: number;
  allowedOrigins: string[];
  databaseUrl: string;
  auth: { issuer: string; audience: string; jwksUri: string };
  staffJwtSecret: string;
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; upstash: { url: string; token: string } | null };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
};

export function loadApiConfig(env: Env): ApiConfig {
  const v = parse(apiSchema, env);
  const previews = v.ALLOWED_PREVIEW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    port: v.PORT,
    allowedOrigins: [new URL(v.APP_URL).origin, ...previews],
    databaseUrl: v.DATABASE_URL,
    auth: { issuer: v.JWT_ISSUER, audience: v.JWT_AUDIENCE, jwksUri: v.JWKS_URI },
    staffJwtSecret: v.STAFF_JWT_SECRET,
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: {
      windowMs: v.RATE_LIMIT_WINDOW_MS,
      maxRequests: v.RATE_LIMIT_MAX_REQUESTS,
      upstash:
        v.UPSTASH_REDIS_REST_URL && v.UPSTASH_REDIS_REST_TOKEN
          ? { url: v.UPSTASH_REDIS_REST_URL, token: v.UPSTASH_REDIS_REST_TOKEN }
          : null,
    },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
  };
}

export type WorkerConfig = { nodeEnv: ApiConfig["nodeEnv"]; logLevel: LogLevel; directUrl: string; databaseCaPem: string | null };

export function loadWorkerConfig(env: Env): WorkerConfig {
  const v = parse(workerSchema, env);
  return { nodeEnv: v.NODE_ENV, logLevel: v.LOG_LEVEL, directUrl: v.DIRECT_URL, databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE) };
}
```
Add to `packages/core/src/index.ts`:
```ts
export * from "./config";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit packages/core/src/config.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the secrets script**

`scripts/ensure-env-secrets.ts`:
```ts
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const path = ".env";
let text = existsSync(path) ? readFileSync(path, "utf8") : "";
const has = (key: string) => new RegExp(`^${key}=\\S+`, "m").test(text);
const added: string[] = [];

function ensure(key: string, value: string) {
  if (has(key)) return;
  const line = `${key}="${value}"`;
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  added.push(key);
}

ensure("DATA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
ensure("STAFF_JWT_SECRET", randomBytes(48).toString("base64url"));
writeFileSync(path, text);
console.log(added.length ? `Added to .env: ${added.join(", ")}` : "Secrets already present; nothing changed.");
```

- [ ] **Step 6: Update `.env` (local, not committed)**

1. Run `npm run env:secrets` → expected `Added to .env: DATA_ENCRYPTION_KEY, STAFF_JWT_SECRET`.
2. Edit `.env` so these lines read (use the **existing** `SUPABASE_URL` value in place of `<SUPABASE_URL>`):
   ```
   JWT_ISSUER="<SUPABASE_URL>/auth/v1"
   JWT_AUDIENCE="authenticated"
   JWKS_URI="<SUPABASE_URL>/auth/v1/.well-known/jwks.json"
   VITE_SUPABASE_URL="<SUPABASE_URL>"
   VITE_SUPABASE_PUBLISHABLE_KEY="<same value as SUPABASE_ANON_KEY>"
   DATABASE_SSL_CA_FILE=""
   ```
   `DATABASE_SSL_CA_FILE` stays empty until someone with dashboard access downloads the Supabase CA certificate (Project Settings → Database → SSL Configuration) and saves it, e.g. as `certs/supabase-ca.crt` (add `certs/` to `.gitignore`). Then set `DATABASE_SSL_CA_FILE="certs/supabase-ca.crt"`. For the test project, set `TEST_DATABASE_SSL_CA_FILE` the same way (each Supabase project uses the same root CA, so the same file normally works for both).
3. Confirm the JWKS endpoint works (public, no secret printed):
   `node -e "fetch(process.argv[1]).then(r=>r.json()).then(j=>console.log(j.keys.map(k=>k.alg)))" "<SUPABASE_URL>/auth/v1/.well-known/jwks.json"` → expected `[ 'ES256' ]` or `[ 'RS256' ]`.

- [ ] **Step 7: Update `.env.example`**

Regenerate from `.env` with names only, preserving order and removing duplicates:
```bash
node -e "const fs=require('fs');const seen=new Set();const out=fs.readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]).filter(k=>k&&!seen.has(k)&&seen.add(k)).map(k=>k+'=');fs.writeFileSync('.env.example',out.join('\n')+'\n')"
```
Expected: `.env.example` now also lists `DATA_ENCRYPTION_KEY=`, `STAFF_JWT_SECRET=`, `VITE_SUPABASE_URL=`, `VITE_SUPABASE_PUBLISHABLE_KEY=`.

- [ ] **Step 8: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass. Run `git status --short` and confirm `.env` is **not** listed.
```bash
git add -A
git commit -m "feat(core): add validated config loading and env secrets script"
```

---

### Task 4: Logger and encryption helpers

**Files:**
- Create: `packages/core/src/logger.ts`, `packages/core/src/crypto.ts`, `packages/core/src/provider-calls.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/logger.test.ts`, `packages/core/src/crypto.test.ts`

**Interfaces:**
- Produces: `createLogger(opts: { level: LogLevel; name?: string }, destination?: DestinationStream): Logger` (re-exported pino `Logger` type); `maskEmail(value: string): string`; `encryptSecret(plaintext: string, key: Buffer): string`; `decryptSecret(token: string, key: Buffer): string`; `sha256Hex(value: string): string`; `randomToken(bytes?: number): string`;
  ```ts
  type ProviderCall = { provider: string; operation: string; model: string | null; tokensIn: number | null; tokensOut: number | null; units: number | null; costUsd: number; latencyMs: number; status: "ok" | "error"; errorCode: string | null; workspaceId: string | null; jobId: string | null; requestId: string | null };
  interface ProviderCallSink { record(call: ProviderCall): Promise<void> }
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/src/logger.test.ts`:
```ts
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, maskEmail } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("redacts secrets and masks emails", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info" }, stream);
    log.info({ user: { email: "ahmed@mushin.pk", password: "hunter2" }, auth: { accessToken: "tok" } }, "hello");
    const line = lines[0] as { user: { email: string; password: string }; auth: { accessToken: string } };
    expect(line.user.email).toBe("a***@mushin.pk");
    expect(line.user.password).toBe("[REDACTED]");
    expect(line.auth.accessToken).toBe("[REDACTED]");
  });

  it("redacts the authorization header of logged requests", () => {
    const { lines, stream } = capture();
    createLogger({ level: "info" }, stream).info({ req: { headers: { authorization: "Bearer x", cookie: "a=b" } } });
    const line = lines[0] as { req: { headers: Record<string, string> } };
    expect(line.req.headers.authorization).toBe("[REDACTED]");
    expect(line.req.headers.cookie).toBe("[REDACTED]");
  });

  it("maskEmail handles odd input", () => {
    expect(maskEmail("no-at-sign")).toBe("[REDACTED]");
  });
});
```

`packages/core/src/crypto.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "./crypto";

const key = Buffer.alloc(32, 1);

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXPJBSWY3DP", key);
    const b = encryptSecret("JBSWY3DPEHPK3PXPJBSWY3DP", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXPJBSWY3DP");
  });

  it("rejects tampering and the wrong key", () => {
    const token = encryptSecret("secret", key);
    const parts = token.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("other").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(token, Buffer.alloc(32, 2))).toThrow();
    expect(() => decryptSecret("garbage", key)).toThrow(/malformed/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("hashes and generates tokens", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/core/src/logger.test.ts packages/core/src/crypto.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/logger.ts`:
```ts
import { pino, type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "./config";

export type { Logger };

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.challengeToken",
  "*.secret",
  "*.totpSecret",
  "*.email",
  "email",
];

export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  return at > 0 ? `${value[0]}***${value.slice(at)}` : "[REDACTED]";
}

export function createLogger(opts: { level: LogLevel; name?: string }, destination?: DestinationStream): Logger {
  return pino(
    {
      level: opts.level,
      ...(opts.name ? { name: opts.name } : {}),
      redact: {
        paths: REDACT_PATHS,
        censor: (value: unknown, path: string[]) =>
          path[path.length - 1] === "email" && typeof value === "string" ? maskEmail(value) : "[REDACTED]",
      },
    },
    destination,
  );
}
```

`packages/core/src/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  assertKey(key);
  const [version, iv, tag, ciphertext] = token.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("malformed encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
```

`packages/core/src/provider-calls.ts`:
```ts
export type ProviderCall = {
  provider: string;
  operation: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  units: number | null;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode: string | null;
  workspaceId: string | null;
  jobId: string | null;
  requestId: string | null;
};

export interface ProviderCallSink {
  record(call: ProviderCall): Promise<void>;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./errors";
export * from "./context";
export * from "./config";
export * from "./logger";
export * from "./crypto";
export * from "./provider-calls";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit packages/core`
Expected: PASS (all core tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(core): add redacting logger, AES-GCM helpers and provider-call types"
```

---

### Task 5: API skeleton (request IDs, errors, validation, security, liveness)

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/http/request-id.ts`, `apps/api/src/http/errors.ts`, `apps/api/src/http/validate.ts`, `apps/api/src/http/security.ts`, `apps/api/src/http/health.ts`, `apps/api/src/http/bearer.ts`, `apps/api/src/http/types.ts`, `apps/api/src/test-support/app.ts`
- Modify: `apps/api/package.json` (workspace deps)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `AppError`, `Logger`, `createLogger` (core); `errorEnvelopeSchema`, `healthLiveSchema`, `healthReadySchema` (contracts).
- Produces:
  ```ts
  // http/types.ts
  type Guards = { customer: PreHandler; idempotent: PreHandler };
  type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  type AppModule = { name: string; register(app: FastifyInstance, guards: Guards): void };
  type ReadinessCheck = { name: string; check: () => Promise<"ok" | "skipped"> };
  // app.ts
  type AppDeps = { logger: Logger; allowedOrigins: string[]; guards: Guards; modules: AppModule[]; readiness: ReadinessCheck[]; onRequestHooks?: OnRequestHook[] };
  buildApp(deps: AppDeps): Promise<FastifyInstance>
  // http/validate.ts
  parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S>
  sendOk<S extends z.ZodType>(reply: FastifyReply, schema: S, body: z.input<S>, status?: number): FastifyReply
  // http/bearer.ts
  bearerToken(req: FastifyRequest): string | null
  // http/request-id.ts
  requestIdFrom(req: IncomingMessage): string
  // test-support/app.ts
  testLogger(): Logger; noGuards(): Guards; buildTestApp(partial: Partial<AppDeps>): Promise<FastifyInstance>
  ```

- [ ] **Step 1: Add workspace dependencies**

`apps/api/package.json`:
```json
{
  "name": "@mushin/api",
  "private": true,
  "type": "module",
  "dependencies": {
    "@mushin/contracts": "*",
    "@mushin/core": "*",
    "@mushin/db": "*",
    "@mushin/integrations": "*"
  }
}
```
Run `npm install` (keeps the already-installed third-party packages and links the workspaces).

- [ ] **Step 2: Write the failing tests**

`apps/api/src/app.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/app.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the HTTP layer**

`apps/api/src/http/types.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";

export type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type Guards = { customer: PreHandler; idempotent: PreHandler };
export type AppModule = { name: string; register(app: FastifyInstance, guards: Guards): void };
export type ReadinessCheck = { name: string; check: () => Promise<"ok" | "skipped"> };
export type OnRequestHook = onRequestAsyncHookHandler;
```

`apps/api/src/http/request-id.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && VALID.test(value) ? value : randomUUID();
}
```

`apps/api/src/http/errors.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { ErrorCode } from "@mushin/contracts";
import { AppError } from "@mushin/core";

function envelope(code: ErrorCode, message: string, requestId: string, details?: Record<string, unknown>) {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}

function statusOf(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "statusCode" in err && typeof err.statusCode === "number") return err.statusCode;
  return null;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const retryAfter = err.details?.["retryAfterSeconds"];
      if (err.code === "RATE_LIMITED" && typeof retryAfter === "number") void reply.header("retry-after", String(retryAfter));
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply.status(err.status).send(envelope(err.code, err.message, req.id, err.details));
    }
    const status = statusOf(err);
    if (status !== null && status >= 400 && status < 500) {
      return reply.status(status).send(envelope("VALIDATION_FAILED", "The request could not be processed", req.id));
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send(envelope("INTERNAL", "Something went wrong. Please try again.", req.id));
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send(envelope("NOT_FOUND", "Route not found", req.id)));
}
```

`apps/api/src/http/validate.ts`:
```ts
import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { AppError } from "@mushin/core";

export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", "Request validation failed", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/** Serializes through the response schema; a mismatch is a server bug and becomes a 500. */
export function sendOk<S extends z.ZodType>(reply: FastifyReply, schema: S, body: z.input<S>, status = 200): FastifyReply {
  return reply.status(status).send(schema.parse(body));
}
```

`apps/api/src/http/bearer.ts`:
```ts
import type { FastifyRequest } from "fastify";

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
```

`apps/api/src/http/security.ts`:
```ts
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerSecurity(app: FastifyInstance, allowedOrigins: string[]): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-request-id"],
    exposedHeaders: ["x-request-id", "retry-after", "idempotent-replayed"],
  });
}
```

`apps/api/src/http/health.ts`:
```ts
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
```

`apps/api/src/app.ts`:
```ts
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "@mushin/core";
import { registerErrorHandling } from "./http/errors";
import { registerHealth } from "./http/health";
import { requestIdFrom } from "./http/request-id";
import { registerSecurity } from "./http/security";
import type { AppModule, Guards, OnRequestHook, ReadinessCheck } from "./http/types";

export type AppDeps = {
  logger: Logger;
  allowedOrigins: string[];
  guards: Guards;
  modules: AppModule[];
  readiness: ReadinessCheck[];
  onRequestHooks?: OnRequestHook[];
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger,
    genReqId: requestIdFrom,
    requestIdHeader: false,
    bodyLimit: 1_048_576,
  });

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });
  registerErrorHandling(app);
  await registerSecurity(app, deps.allowedOrigins);
  await app.register(cookie);
  for (const hook of deps.onRequestHooks ?? []) app.addHook("onRequest", hook);

  registerHealth(app, deps.readiness);
  for (const mod of deps.modules) mod.register(app, deps.guards);

  await app.ready();
  return app;
}
```

`apps/api/src/test-support/app.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { AppError, createLogger, type Logger } from "@mushin/core";
import { buildApp, type AppDeps } from "../app";
import type { Guards } from "../http/types";

export function testLogger(): Logger {
  return createLogger({ level: "silent" });
}

export function noGuards(): Guards {
  const deny = async () => {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  };
  return { customer: deny, idempotent: deny };
}

export function buildTestApp(partial: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  return buildApp({
    logger: testLogger(),
    allowedOrigins: ["http://localhost:5173"],
    guards: noGuards(),
    modules: [],
    readiness: [],
    ...partial,
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit apps/api/src/app.test.ts`
Expected: PASS (9 tests). If the malformed-JSON case returns a status other than 400, keep the code `VALIDATION_FAILED` and assert the status Fastify returns (it is a 4xx by design).

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(api): add Fastify app skeleton with request ids, error envelope, validation, CORS and health"
```

---

### Task 6: Rate limiting

**Files:**
- Create: `apps/api/src/rate-limit/types.ts`, `apps/api/src/rate-limit/memory.ts`, `apps/api/src/rate-limit/upstash.ts`, `apps/api/src/rate-limit/plugin.ts`
- Test: `apps/api/src/rate-limit/rate-limit.test.ts`

**Interfaces:**
- Consumes: `buildTestApp` (Task 5), `AppError`, `Logger`.
- Produces:
  ```ts
  type Bucket = { limit: number; windowSeconds: number };
  type RateLimitBuckets = { ip: Bucket; user: Bucket; auth: Bucket };
  type BucketName = keyof RateLimitBuckets;
  type LimitResult = { allowed: boolean; retryAfterSeconds: number };
  interface RateLimiter { limit(bucket: BucketName, key: string): Promise<LimitResult> }
  bucketsFromConfig(c: { windowMs: number; maxRequests: number }): RateLimitBuckets
  class MemoryRateLimiter implements RateLimiter { constructor(buckets: RateLimitBuckets, now?: () => number) }
  class UpstashRateLimiter implements RateLimiter { constructor(limiters: Record<BucketName, SlidingLimiter>, logger: Logger) }
  type SlidingLimiter = { limit(key: string): Promise<{ success: boolean; reset: number }> }
  createUpstashRateLimiter(c: { url: string; token: string }, buckets: RateLimitBuckets, logger: Logger): { limiter: UpstashRateLimiter; ping(): Promise<"ok"> }
  ipRateLimitHook(limiter: RateLimiter): OnRequestHook
  rateLimitError(retryAfterSeconds: number): AppError
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/src/rate-limit/rate-limit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTestApp, testLogger } from "../test-support/app";
import { MemoryRateLimiter } from "./memory";
import { ipRateLimitHook } from "./plugin";
import { bucketsFromConfig, type RateLimitBuckets } from "./types";
import { UpstashRateLimiter } from "./upstash";

const buckets: RateLimitBuckets = {
  ip: { limit: 3, windowSeconds: 60 },
  user: { limit: 2, windowSeconds: 60 },
  auth: { limit: 1, windowSeconds: 60 },
};

describe("MemoryRateLimiter", () => {
  it("allows up to the limit then reports retry-after, and resets after the window", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(buckets, () => now);
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
    const blocked = await rl.limit("user", "u1");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect((await rl.limit("user", "u2")).allowed).toBe(true);
    now = 61_000;
    expect((await rl.limit("user", "u1")).allowed).toBe(true);
  });
});

describe("UpstashRateLimiter", () => {
  it("fails open when Redis is unreachable", async () => {
    const down = { limit: async () => Promise.reject(new Error("ENOTFOUND")) };
    const rl = new UpstashRateLimiter({ ip: down, user: down, auth: down }, testLogger());
    expect(await rl.limit("ip", "1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("converts reset time to retry-after seconds", async () => {
    const full = { limit: async () => ({ success: false, reset: Date.now() + 4_500 }) };
    const rl = new UpstashRateLimiter({ ip: full, user: full, auth: full }, testLogger());
    const r = await rl.limit("ip", "k");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(4);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(5);
  });
});

describe("IP rate limit hook", () => {
  it("returns 429 with Retry-After and skips health checks", async () => {
    const app = await buildTestApp({ onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))] });
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: "/v1/x" })).statusCode).toBe(404);
    const limited = await app.inject({ method: "GET", url: "/v1/x" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });

  it("uses the stricter auth bucket for staff auth routes", async () => {
    const app = await buildTestApp({ onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))] });
    expect((await app.inject({ method: "POST", url: "/admin/v1/auth/login" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/admin/v1/auth/login" })).statusCode).toBe(429);
  });
});

describe("bucketsFromConfig", () => {
  it("derives ip/user buckets from config and a fixed auth bucket", () => {
    expect(bucketsFromConfig({ windowMs: 30_000, maxRequests: 50 })).toEqual({
      ip: { limit: 50, windowSeconds: 30 },
      user: { limit: 50, windowSeconds: 30 },
      auth: { limit: 10, windowSeconds: 60 },
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/rate-limit`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/rate-limit/types.ts`:
```ts
import { AppError } from "@mushin/core";

export type Bucket = { limit: number; windowSeconds: number };
export type RateLimitBuckets = { ip: Bucket; user: Bucket; auth: Bucket };
export type BucketName = keyof RateLimitBuckets;
export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  limit(bucket: BucketName, key: string): Promise<LimitResult>;
}

export function bucketsFromConfig(c: { windowMs: number; maxRequests: number }): RateLimitBuckets {
  const windowSeconds = Math.max(1, Math.ceil(c.windowMs / 1000));
  return {
    ip: { limit: c.maxRequests, windowSeconds },
    user: { limit: c.maxRequests, windowSeconds },
    auth: { limit: 10, windowSeconds: 60 },
  };
}

export function rateLimitError(retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", "Too many requests. Please slow down.", { retryAfterSeconds });
}
```

`apps/api/src/rate-limit/memory.ts`:
```ts
import type { BucketName, LimitResult, RateLimitBuckets, RateLimiter } from "./types";

/** Fixed-window limiter for development and tests. Not shared across processes. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly buckets: RateLimitBuckets,
    private readonly now: () => number = Date.now,
  ) {}

  async limit(bucket: BucketName, key: string): Promise<LimitResult> {
    const b = this.buckets[bucket];
    const t = this.now();
    const k = `${bucket}:${key}`;
    if (this.hits.size > 10_000) this.prune(t);
    let entry = this.hits.get(k);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + b.windowSeconds * 1000 };
      this.hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count <= b.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
```

`apps/api/src/rate-limit/upstash.ts`:
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Logger } from "@mushin/core";
import type { Bucket, BucketName, LimitResult, RateLimitBuckets, RateLimiter } from "./types";

export type SlidingLimiter = { limit(key: string): Promise<{ success: boolean; reset: number }> };

/** Fails open: if Redis is down the request is allowed and a warning is logged (readiness shows redis "down"). */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly limiters: Record<BucketName, SlidingLimiter>,
    private readonly logger: Logger,
  ) {}

  async limit(bucket: BucketName, key: string): Promise<LimitResult> {
    try {
      const r = await this.limiters[bucket].limit(key);
      if (r.success) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
    } catch (err) {
      this.logger.warn({ err, bucket }, "rate limiter unavailable; allowing request");
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}

export function createUpstashRateLimiter(
  c: { url: string; token: string },
  buckets: RateLimitBuckets,
  logger: Logger,
): { limiter: UpstashRateLimiter; ping(): Promise<"ok"> } {
  const redis = new Redis({ url: c.url, token: c.token });
  const make = (name: BucketName, b: Bucket) =>
    new Ratelimit({ redis, prefix: `mushin:rl:${name}`, limiter: Ratelimit.slidingWindow(b.limit, `${b.windowSeconds} s`) });
  const limiter = new UpstashRateLimiter(
    { ip: make("ip", buckets.ip), user: make("user", buckets.user), auth: make("auth", buckets.auth) },
    logger,
  );
  return {
    limiter,
    async ping() {
      await redis.ping();
      return "ok";
    },
  };
}
```

`apps/api/src/rate-limit/plugin.ts`:
```ts
import type { OnRequestHook } from "../http/types";
import { rateLimitError, type BucketName, type RateLimiter } from "./types";

export function ipRateLimitHook(limiter: RateLimiter): OnRequestHook {
  return async (req) => {
    if (req.url.startsWith("/health/")) return;
    const bucket: BucketName = req.url.startsWith("/admin/v1/auth/") ? "auth" : "ip";
    const r = await limiter.limit(bucket, req.ip);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit apps/api/src/rate-limit`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(api): add IP/user/auth rate limiting with Upstash and in-memory backends"
```

---

### Task 7: Customer JWT verification and the customer guard

**Files:**
- Create: `apps/api/src/auth/customer-token.ts`, `apps/api/src/auth/customer-guard.ts`, `apps/api/src/test-support/keys.ts`
- Test: `apps/api/src/auth/customer-auth.test.ts`

**Interfaces:**
- Consumes: `RateLimiter`, `rateLimitError` (Task 6); `bearerToken`, `PreHandler` (Task 5); `TenantContext` (core).
- Produces:
  ```ts
  type CustomerIdentity = { userId: string; email: string; fullName: string | null };
  type CustomerTokenVerifier = (token: string) => Promise<CustomerIdentity>;
  createCustomerTokenVerifier(o: { issuer: string; audience: string; keys: JWTVerifyGetKey }): CustomerTokenVerifier
  remoteJwks(uri: string): JWTVerifyGetKey
  type ResolveTenant = (identity: CustomerIdentity, requestId: string) => Promise<TenantContext>;
  createCustomerGuard(o: { verify: CustomerTokenVerifier; resolveTenant: ResolveTenant; limiter: RateLimiter }): PreHandler
  tenantOf(req: FastifyRequest): TenantContext
  // Fastify request augmentation: req.customer: CustomerIdentity | null; req.tenant: TenantContext | null
  // test-support/keys.ts
  createTestIssuer(): Promise<{ issuer: string; audience: string; keys: JWTVerifyGetKey; sign(claims?: TestClaims): Promise<string> }>
  type TestClaims = { sub?: string; email?: string | null; fullName?: string; issuer?: string; audience?: string; expiresIn?: string }
  ```
- `buildApp` must call `app.decorateRequest("customer", null)` and `app.decorateRequest("tenant", null)` (added in this task).

- [ ] **Step 1: Write the test key helper**

`apps/api/src/test-support/keys.ts`:
```ts
import { randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

export type TestClaims = {
  sub?: string;
  email?: string | null;
  fullName?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
};

export async function createTestIssuer() {
  const issuer = "https://test-project.supabase.co/auth/v1";
  const audience = "authenticated";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "test-key";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  const keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  async function sign(claims: TestClaims = {}): Promise<string> {
    const body: Record<string, unknown> = { role: "authenticated" };
    if (claims.email !== null) body["email"] = claims.email ?? "ahmed@mushin.pk";
    if (claims.fullName) body["user_metadata"] = { full_name: claims.fullName };
    return new SignJWT(body)
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject(claims.sub ?? randomUUID())
      .setIssuer(claims.issuer ?? issuer)
      .setAudience(claims.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? "15m")
      .sign(privateKey);
  }

  return { issuer, audience, keys, sign };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/auth/customer-auth.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/auth`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`apps/api/src/auth/customer-token.ts`:
```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AppError } from "@mushin/core";

export type CustomerIdentity = { userId: string; email: string; fullName: string | null };
export type CustomerTokenVerifier = (token: string) => Promise<CustomerIdentity>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function remoteJwks(uri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(uri));
}

export function createCustomerTokenVerifier(o: { issuer: string; audience: string; keys: JWTVerifyGetKey }): CustomerTokenVerifier {
  return async (token) => {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, o.keys, { issuer: o.issuer, audience: o.audience, algorithms: ["RS256", "ES256"] }));
    } catch (err) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired token", undefined, { cause: err });
    }
    const sub = payload["sub"];
    const email = payload["email"];
    if (typeof sub !== "string" || !UUID.test(sub) || typeof email !== "string" || !email.includes("@")) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired token");
    }
    const meta = payload["user_metadata"];
    const rawName = isRecord(meta) ? meta["full_name"] : undefined;
    const fullName = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 120) : null;
    return { userId: sub.toLowerCase(), email: email.toLowerCase(), fullName };
  };
}
```

`apps/api/src/auth/customer-guard.ts`:
```ts
import type { FastifyRequest } from "fastify";
import { AppError, type TenantContext } from "@mushin/core";
import { bearerToken } from "../http/bearer";
import type { PreHandler } from "../http/types";
import { rateLimitError, type RateLimiter } from "../rate-limit/types";
import type { CustomerIdentity, CustomerTokenVerifier } from "./customer-token";

declare module "fastify" {
  interface FastifyRequest {
    customer: CustomerIdentity | null;
    tenant: TenantContext | null;
  }
}

export type ResolveTenant = (identity: CustomerIdentity, requestId: string) => Promise<TenantContext>;

export function createCustomerGuard(o: {
  verify: CustomerTokenVerifier;
  resolveTenant: ResolveTenant;
  limiter: RateLimiter;
}): PreHandler {
  return async (req) => {
    const token = bearerToken(req);
    if (!token) throw new AppError("UNAUTHENTICATED", "Authentication required");
    const identity = await o.verify(token);
    const r = await o.limiter.limit("user", identity.userId);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
    req.customer = identity;
    req.tenant = await o.resolveTenant(identity, req.id);
  };
}

export function tenantOf(req: FastifyRequest): TenantContext {
  if (!req.tenant) throw new AppError("UNAUTHENTICATED", "Authentication required");
  return req.tenant;
}
```

In `apps/api/src/app.ts`, add right after creating the Fastify instance:
```ts
  app.decorateRequest("customer", null);
  app.decorateRequest("tenant", null);
```
and add this import at the top so the augmentation is always loaded:
```ts
import "./auth/customer-guard";
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit apps/api/src`
Expected: PASS (all API unit tests, including 11 new ones).

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(api): verify Supabase JWTs via JWKS and add the customer guard"
```

---

### Task 8: Staff auth primitives (passwords, TOTP, tokens, permissions)

**Files:**
- Create: `apps/api/src/modules/staff/passwords.ts`, `apps/api/src/modules/staff/totp.ts`, `apps/api/src/modules/staff/tokens.ts`, `apps/api/src/modules/staff/permissions.ts`
- Test: `apps/api/src/modules/staff/primitives.test.ts`

**Interfaces:**
- Produces:
  ```ts
  hashPassword(p: string): Promise<string>; verifyPassword(hash: string, p: string): Promise<boolean>; dummyHash(): Promise<string>
  newTotpSecret(): string; totpUri(email: string, secret: string): string; verifyTotp(secret: string, code: string): Promise<boolean>
  type StaffRole = "admin" | "support"; type StaffPrincipal = { staffId: string; role: StaffRole };
  ACCESS_TTL_SECONDS = 900; CHALLENGE_TTL_SECONDS = 300;
  createStaffTokens(secret: string, now?: () => Date): StaffTokens
  type StaffTokens = { signAccess(p: StaffPrincipal): Promise<string>; signChallenge(staffId: string): Promise<string>; verifyAccess(token: string): Promise<StaffPrincipal>; verifyChallenge(token: string): Promise<string> }
  STAFF_PERMISSIONS; type StaffAction = keyof typeof STAFF_PERMISSIONS; can(role: StaffRole, action: string): boolean
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/staff/primitives.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { describe, expect, it } from "vitest";
import { createTestIssuer } from "../../test-support/keys";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import { can } from "./permissions";
import { createStaffTokens } from "./tokens";
import { newTotpSecret, totpUri, verifyTotp } from "./totp";

describe("staff passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect((await dummyHash()).startsWith("$argon2id$")).toBe(true);
  });
});

describe("staff TOTP", () => {
  it("verifies current codes and rejects others", async () => {
    const secret = newTotpSecret();
    expect(await verifyTotp(secret, await generate({ secret }))).toBe(true);
    expect(await verifyTotp(secret, "000000")).toBe(false);
    expect(await verifyTotp(secret, "12ab56")).toBe(false);
    expect(totpUri("admin@mushin.pk", secret)).toMatch(/^otpauth:\/\/totp\//);
  });
});

describe("staff tokens", () => {
  const secret = "z".repeat(48);

  it("round-trips access and challenge tokens and keeps their types apart", async () => {
    const t = createStaffTokens(secret);
    const staffId = randomUUID();
    const access = await t.signAccess({ staffId, role: "support" });
    expect(await t.verifyAccess(access)).toEqual({ staffId, role: "support" });
    const challenge = await t.signChallenge(staffId);
    expect(await t.verifyChallenge(challenge)).toBe(staffId);
    await expect(t.verifyAccess(challenge)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(t.verifyChallenge(access)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("expires access tokens after 15 minutes", async () => {
    let now = new Date("2026-10-06T10:00:00Z");
    const t = createStaffTokens(secret, () => now);
    const access = await t.signAccess({ staffId: randomUUID(), role: "admin" });
    now = new Date("2026-10-06T10:16:00Z");
    await expect(t.verifyAccess(access)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects customer tokens and tokens signed with another secret", async () => {
    const t = createStaffTokens(secret);
    const customer = await (await createTestIssuer()).sign();
    await expect(t.verifyAccess(customer)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const foreign = await createStaffTokens("y".repeat(48)).signAccess({ staffId: randomUUID(), role: "admin" });
    await expect(t.verifyAccess(foreign)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("staff permissions", () => {
  it("is deny-by-default", () => {
    expect(can("admin", "staff.me.read")).toBe(true);
    expect(can("support", "staff.me.read")).toBe(true);
    expect(can("admin", "users.delete")).toBe(false);
    expect(can("support", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/modules/staff`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/modules/staff/passwords.ts`:
```ts
import { hash, verify } from "@node-rs/argon2";

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password);
}

let dummy: Promise<string> | undefined;
/** A real hash used to keep timing equal when the email does not exist. */
export function dummyHash(): Promise<string> {
  dummy ??= hash("mushin-timing-equalizer");
  return dummy;
}
```

`apps/api/src/modules/staff/totp.ts`:
```ts
import { generateSecret, generateURI, verify } from "otplib";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: "MUSHIN Admin", label: email, secret });
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  return result.valid;
}
```

`apps/api/src/modules/staff/tokens.ts`:
```ts
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { AppError } from "@mushin/core";

export type StaffRole = "admin" | "support";
export type StaffPrincipal = { staffId: string; role: StaffRole };

const ISSUER = "mushin-staff";
const AUDIENCE = "mushin-admin";
export const ACCESS_TTL_SECONDS = 15 * 60;
export const CHALLENGE_TTL_SECONDS = 5 * 60;

type TokenType = "access" | "totp_challenge";

export function createStaffTokens(secret: string, now: () => Date = () => new Date()) {
  const key = new TextEncoder().encode(secret);

  function sign(claims: Record<string, unknown>, subject: string, ttlSeconds: number): Promise<string> {
    const issuedAt = Math.floor(now().getTime() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds)
      .sign(key);
  }

  async function verify(token: string, typ: TokenType): Promise<JWTPayload & { sub: string }> {
    const invalid = () => new AppError("UNAUTHENTICATED", "Invalid or expired staff token");
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"], currentDate: now() }));
    } catch (err) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired staff token", undefined, { cause: err });
    }
    if (payload["typ"] !== typ || typeof payload.sub !== "string") throw invalid();
    return { ...payload, sub: payload.sub };
  }

  return {
    signAccess: (p: StaffPrincipal) => sign({ typ: "access", role: p.role }, p.staffId, ACCESS_TTL_SECONDS),
    signChallenge: (staffId: string) => sign({ typ: "totp_challenge" }, staffId, CHALLENGE_TTL_SECONDS),
    async verifyAccess(token: string): Promise<StaffPrincipal> {
      const p = await verify(token, "access");
      const role = p["role"];
      if (role !== "admin" && role !== "support") throw new AppError("UNAUTHENTICATED", "Invalid or expired staff token");
      return { staffId: p.sub, role };
    },
    async verifyChallenge(token: string): Promise<string> {
      return (await verify(token, "totp_challenge")).sub;
    },
  };
}

export type StaffTokens = ReturnType<typeof createStaffTokens>;
```

`apps/api/src/modules/staff/permissions.ts`:
```ts
import type { StaffRole } from "./tokens";

/** Every staff action and the roles allowed to perform it. Anything not listed is denied. */
export const STAFF_PERMISSIONS = {
  "staff.me.read": ["admin", "support"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffAction = keyof typeof STAFF_PERMISSIONS;

export function can(role: StaffRole, action: string): boolean {
  const table: Record<string, readonly StaffRole[] | undefined> = STAFF_PERMISSIONS;
  return table[action]?.includes(role) ?? false;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit apps/api/src/modules/staff`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(staff): add argon2 passwords, TOTP, staff JWTs and deny-by-default permissions"
```

---

### Task 9: Adapter base (`instrumented`)

**Files:**
- Create: `packages/integrations/src/instrumented.ts`, `packages/integrations/src/memory-sink.ts`
- Modify: `packages/integrations/src/index.ts`, `packages/integrations/package.json`
- Test: `packages/integrations/src/instrumented.test.ts`

**Interfaces:**
- Consumes: `ProviderCall`, `ProviderCallSink`, `AppError`, `Logger` (core).
- Produces:
  ```ts
  type CallContext = { workspaceId?: string | null; jobId?: string | null; requestId?: string | null };
  type Usage = { model?: string | null; tokensIn?: number | null; tokensOut?: number | null; units?: number | null; costUsd: number };
  type InstrumentOptions<T> = { provider: string; operation: string; timeoutMs: number; retries: number; sink: ProviderCallSink; logger: Logger; ctx?: CallContext; usage?: (result: T) => Usage; isRetryable?: (err: unknown) => boolean; sleep?: (ms: number) => Promise<void> };
  instrumented<T>(opts: InstrumentOptions<T>, fn: (signal: AbortSignal) => Promise<T>): Promise<T>
  class ProviderTimeoutError extends Error {}
  class MemoryProviderCallSink implements ProviderCallSink { calls: ProviderCall[] }
  ```

- [ ] **Step 1: Write the failing tests**

`packages/integrations/src/instrumented.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { instrumented } from "./instrumented";
import { MemoryProviderCallSink } from "./memory-sink";

const logger = createLogger({ level: "silent" });
const noSleep = async () => {};

describe("instrumented", () => {
  it("records a successful call with usage and context", async () => {
    const sink = new MemoryProviderCallSink();
    const result = await instrumented(
      {
        provider: "groq",
        operation: "chat",
        timeoutMs: 1000,
        retries: 0,
        sink,
        logger,
        ctx: { workspaceId: "w1", requestId: "r1" },
        usage: () => ({ model: "llama", tokensIn: 10, tokensOut: 5, costUsd: 0.0001 }),
      },
      async () => "hi",
    );
    expect(result).toBe("hi");
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toMatchObject({
      provider: "groq",
      operation: "chat",
      model: "llama",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      status: "ok",
      errorCode: null,
      workspaceId: "w1",
      requestId: "r1",
      jobId: null,
    });
  });

  it("retries retryable failures, records every attempt, then succeeds", async () => {
    const sink = new MemoryProviderCallSink();
    let attempts = 0;
    const result = await instrumented(
      { provider: "serper", operation: "search", timeoutMs: 1000, retries: 2, sink, logger, sleep: noSleep },
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("503");
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(sink.calls.map((c) => c.status)).toEqual(["error", "error", "ok"]);
  });

  it("times out, stops after the retry budget and throws PROVIDER_UNAVAILABLE", async () => {
    const sink = new MemoryProviderCallSink();
    const run = instrumented(
      { provider: "apify", operation: "run", timeoutMs: 20, retries: 1, sink, logger, sleep: noSleep },
      (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    await expect(run).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sink.calls).toHaveLength(2);
    expect(sink.calls.every((c) => c.status === "error" && c.errorCode === "timeout")).toBe(true);
  });

  it("does not retry non-retryable errors", async () => {
    const sink = new MemoryProviderCallSink();
    await expect(
      instrumented(
        { provider: "x", operation: "y", timeoutMs: 1000, retries: 3, sink, logger, sleep: noSleep, isRetryable: () => false },
        async () => {
          throw new Error("400 bad request");
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sink.calls).toHaveLength(1);
  });

  it("never fails the call because the sink failed", async () => {
    const broken = { record: async () => Promise.reject(new Error("db down")) };
    await expect(
      instrumented({ provider: "x", operation: "y", timeoutMs: 1000, retries: 0, sink: broken, logger }, async () => "ok"),
    ).resolves.toBe("ok");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/integrations`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/integrations/package.json`:
```json
{ "name": "@mushin/integrations", "private": true, "type": "module", "exports": { ".": "./src/index.ts" }, "dependencies": { "@mushin/core": "*" } }
```
Run `npm install`.

`packages/integrations/src/instrumented.ts`:
```ts
import { AppError, type Logger, type ProviderCall, type ProviderCallSink } from "@mushin/core";

export type CallContext = { workspaceId?: string | null; jobId?: string | null; requestId?: string | null };
export type Usage = { model?: string | null; tokensIn?: number | null; tokensOut?: number | null; units?: number | null; costUsd: number };

export type InstrumentOptions<T> = {
  provider: string;
  operation: string;
  timeoutMs: number;
  retries: number;
  sink: ProviderCallSink;
  logger: Logger;
  ctx?: CallContext;
  usage?: (result: T) => Usage;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

export class ProviderTimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} did not respond within ${ms} ms`);
    this.name = "ProviderTimeoutError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function instrumented<T>(opts: InstrumentOptions<T>, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ProviderTimeoutError(opts.provider, opts.timeoutMs)), opts.timeoutMs);
    const started = performance.now();
    try {
      const result = await fn(controller.signal);
      const u = opts.usage?.(result);
      await record(opts, {
        model: u?.model ?? null,
        tokensIn: u?.tokensIn ?? null,
        tokensOut: u?.tokensOut ?? null,
        units: u?.units ?? null,
        costUsd: u?.costUsd ?? 0,
        latencyMs: Math.round(performance.now() - started),
        status: "ok",
        errorCode: null,
      });
      return result;
    } catch (err) {
      lastError = err;
      const timedOut = err instanceof ProviderTimeoutError || controller.signal.reason instanceof ProviderTimeoutError;
      await record(opts, {
        model: null,
        tokensIn: null,
        tokensOut: null,
        units: null,
        costUsd: 0,
        latencyMs: Math.round(performance.now() - started),
        status: "error",
        errorCode: timedOut ? "timeout" : "error",
      });
      opts.logger.warn({ err, provider: opts.provider, operation: opts.operation, attempt }, "provider call failed");
      if (attempt === opts.retries || !(timedOut || isRetryable(err))) break;
      await sleep(200 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError("PROVIDER_UNAVAILABLE", `${opts.provider} is unavailable right now. Please try again shortly.`, undefined, {
    cause: lastError,
  });
}

async function record<T>(
  opts: InstrumentOptions<T>,
  part: Omit<ProviderCall, "provider" | "operation" | "workspaceId" | "jobId" | "requestId">,
) {
  try {
    await opts.sink.record({
      provider: opts.provider,
      operation: opts.operation,
      workspaceId: opts.ctx?.workspaceId ?? null,
      jobId: opts.ctx?.jobId ?? null,
      requestId: opts.ctx?.requestId ?? null,
      ...part,
    });
  } catch (err) {
    opts.logger.error({ err, provider: opts.provider }, "failed to record provider call");
  }
}
```

`packages/integrations/src/memory-sink.ts`:
```ts
import type { ProviderCall, ProviderCallSink } from "@mushin/core";

export class MemoryProviderCallSink implements ProviderCallSink {
  readonly calls: ProviderCall[] = [];

  async record(call: ProviderCall): Promise<void> {
    this.calls.push(call);
  }
}
```

`packages/integrations/src/index.ts`:
```ts
export * from "./instrumented";
export * from "./memory-sink";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit packages/integrations`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add -A
git commit -m "feat(integrations): add instrumented() adapter wrapper with timeout, retries and cost recording"
```

---

> **Database checkpoint.** Tasks 10 onward need `TEST_DATABASE_URL` (integration tests) and, for running the app, `DATABASE_URL` (transaction pooler, port 6543) and `DIRECT_URL` (session pooler, port 5432). Before Task 10:
> - If the teammate has provided the pooler URLs, put them in `.env`.
> - Set `TEST_DATABASE_URL` to the **mushin-test** project's session pooler URL (ask the user before writing it into `.env`; they own that project).
> - Integration tests only ever touch `TEST_DATABASE_URL`.

### Task 10: Database package, migration runner, roles and scopes

**Files:**
- Create: `packages/db/migrations/0001_foundation.sql`
- Create: `packages/db/src/tls.ts`, `packages/db/src/client.ts`, `packages/db/src/database.ts`, `packages/db/src/migrate.ts`, `packages/db/src/migrate-cli.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/testing.ts`, `packages/db/test/global-setup.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json`
- Test: `packages/db/src/migrate.int.test.ts`, `packages/db/src/database.int.test.ts`

**Interfaces:**
- Consumes: `sha256Hex`, `TenantContext` (core).
- Produces:
  ```ts
  // database.ts
  type DbTx; type TenantTx; type UserTx; type SystemTx;   // branded transaction handles
  type Db = {
    withTenant<T>(ctx: { userId: string; workspaceId: string }, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
    withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T>;
    withSystem<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;
    listen(channel: string, onNotify: () => void): Promise<() => Promise<void>>;
    ping(): Promise<"ok">;
    close(): Promise<void>;
  };
  createDatabase(url: string, opts: { max: number; applicationName: string; caPem?: string | null }): Db
  // tls.ts
  tlsOptions(caPem: string | null): tls.ConnectionOptions; UNVERIFIED_TLS_WARNING: string
  // migrate.ts
  migrate(url: string, opts?: { dir?: string; log?: (m: string) => void; caPem?: string | null }): Promise<string[]>
  // testing.ts (import from "@mushin/db/testing")
  testDatabaseUrl(): string; testCaPem(): string | null; createTestDatabase(): Db; resetTables(): Promise<void>; ownerQuery<T>(text: string): Promise<T[]>
  ```
- SQL functions created here: `platform.current_workspace_id()`, `platform.current_user_id()`, `platform.set_updated_at()`.

- [ ] **Step 1: Write the first migration**

`packages/db/migrations/0001_foundation.sql`:
```sql
-- Roles used by the API and worker inside every transaction (SET LOCAL ROLE).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mushin_app') then
    create role mushin_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mushin_worker') then
    create role mushin_worker nologin;
  end if;
end $$;

grant mushin_app to current_user;
grant mushin_worker to current_user;

create schema if not exists wp;
create schema if not exists staff;
-- platform is created by the migration runner.

revoke all on schema wp, staff, platform from public;
do $$
begin
  -- Supabase's Data API roles must never reach our schemas.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema wp, staff, platform from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema wp, staff, platform from authenticated;
  end if;
end $$;

grant usage on schema wp, platform to mushin_app, mushin_worker;
grant usage on schema staff to mushin_worker;

-- Tenant settings: NULL when unset OR empty (pooled connections keep '' after a transaction).
create or replace function platform.current_workspace_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;
create or replace function platform.current_user_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
grant execute on function platform.current_workspace_id(), platform.current_user_id() to mushin_app, mushin_worker;

create or replace function platform.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
```

- [ ] **Step 2: Write the failing tests**

`packages/db/src/migrate.int.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "./migrate";
import { ownerQuery, testCaPem, testDatabaseUrl } from "./testing";

describe("migration runner", () => {
  const dir = mkdtempSync(join(tmpdir(), "mushin-mig-"));
  const name = `9001_runner_probe_${Date.now()}.sql`;

  afterAll(async () => {
    await ownerQuery(`drop table if exists platform.runner_probe; delete from platform.schema_migrations where name like '9001_runner_probe_%'`);
  });

  it("applies the real migrations and is idempotent", async () => {
    expect(await migrate(testDatabaseUrl(), { caPem: testCaPem() })).toEqual([]); // global setup already applied them
    const roles = await ownerQuery<{ rolname: string }>(`select rolname from pg_roles where rolname in ('mushin_app','mushin_worker') order by 1`);
    expect(roles.map((r) => r.rolname)).toEqual(["mushin_app", "mushin_worker"]);
  });

  it("applies a new file once and refuses an edited one (Review Focus 5)", async () => {
    const caPem = testCaPem();
    writeFileSync(join(dir, name), "create table platform.runner_probe (id int);");
    expect(await migrate(testDatabaseUrl(), { dir, caPem })).toEqual([name]);
    expect(await migrate(testDatabaseUrl(), { dir, caPem })).toEqual([]);
    writeFileSync(join(dir, name), "create table platform.runner_probe (id bigint);");
    await expect(migrate(testDatabaseUrl(), { dir, caPem })).rejects.toThrow(/was modified after being applied/);
  });
});
```

`packages/db/src/database.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./database";
import { createTestDatabase, ownerQuery, testCaPem, testDatabaseUrl } from "./testing";

const db = createTestDatabase();

beforeAll(async () => {
  await ownerQuery(`
    create table if not exists wp.scope_probe (workspace_id uuid not null, v int not null);
    alter table wp.scope_probe enable row level security;
    alter table wp.scope_probe force row level security;
    drop policy if exists scope_probe_tenant on wp.scope_probe;
    create policy scope_probe_tenant on wp.scope_probe
      using (workspace_id = platform.current_workspace_id())
      with check (workspace_id = platform.current_workspace_id());
    grant select, insert on wp.scope_probe to mushin_app, mushin_worker;
    truncate wp.scope_probe;`);
});

afterAll(async () => {
  await ownerQuery(`drop table if exists wp.scope_probe`);
  await db.close();
});

describe("database scopes", () => {
  it("runs tenant work as mushin_app and isolates workspaces", async () => {
    const a = { userId: randomUUID(), workspaceId: randomUUID() };
    const b = { userId: randomUUID(), workspaceId: randomUUID() };
    await db.withTenant(a, (tx) => tx.execute(sql`insert into wp.scope_probe values (${a.workspaceId}, 1)`));
    await db.withTenant(b, (tx) => tx.execute(sql`insert into wp.scope_probe values (${b.workspaceId}, 2)`));
    const seen = await db.withTenant(a, async (tx) => {
      const role = await tx.execute<{ r: string }>(sql`select current_user as r`);
      const rows = await tx.execute<{ v: number }>(sql`select v from wp.scope_probe`);
      return { role: role[0]?.r, values: rows.map((r) => r.v) };
    });
    expect(seen).toEqual({ role: "mushin_app", values: [1] });
    await expect(
      db.withTenant(a, (tx) => tx.execute(sql`insert into wp.scope_probe values (${b.workspaceId}, 9)`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("returns zero rows without tenant context, even on a reused connection (Review Focus 1)", async () => {
    const single = createDatabase(testDatabaseUrl(), { max: 1, applicationName: "mushin-test-single", caPem: testCaPem() });
    try {
      const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
      await single.withTenant(ctx, (tx) => tx.execute(sql`insert into wp.scope_probe values (${ctx.workspaceId}, 3)`));
      const userScope = await single.withUser(randomUUID(), (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.scope_probe`));
      expect(userScope[0]?.n).toBe(0);
      const system = await single.withSystem(async (tx) => {
        const role = await tx.execute<{ r: string }>(sql`select current_user as r`);
        const rows = await tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.scope_probe`);
        return { role: role[0]?.r, n: rows[0]?.n };
      });
      expect(system).toEqual({ role: "mushin_worker", n: 0 });
    } finally {
      await single.close();
    }
  });

  it("rejects non-uuid context values before touching the database", async () => {
    await expect(db.withTenant({ userId: "x", workspaceId: randomUUID() }, async () => 1)).rejects.toThrow(/uuid/);
  });

  it("keeps Supabase API roles out of our schemas", async () => {
    const rows = await ownerQuery<{ s: string; anon: boolean; authed: boolean; app_staff: boolean }>(`
      select s,
        has_schema_privilege('anon', s, 'usage') as anon,
        has_schema_privilege('authenticated', s, 'usage') as authed,
        has_schema_privilege('mushin_app', 'staff', 'usage') as app_staff
      from unnest(array['wp','staff','platform']) as s`);
    for (const r of rows) {
      expect(r.anon).toBe(false);
      expect(r.authed).toBe(false);
      expect(r.app_staff).toBe(false);
    }
  });

  it("pings", async () => {
    expect(await db.ping()).toBe("ok");
  });
});
```

- [ ] **Step 3: Implement the package**

`packages/db/package.json`:
```json
{
  "name": "@mushin/db",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  "dependencies": { "@mushin/core": "*", "drizzle-orm": "^0.45.0", "postgres": "^3.4.0" }
}
```
Run `npm install`.

`packages/db/src/tls.ts`:
```ts
import type { ConnectionOptions } from "node:tls";

/**
 * TLS options for postgres.js and pg (pg-boss).
 * With Supabase's CA certificate the server certificate is verified.
 * Without it (development only — production config requires the CA) traffic is still encrypted,
 * but the certificate is not verified; callers must log `UNVERIFIED_TLS_WARNING` at startup.
 */
export function tlsOptions(caPem: string | null): ConnectionOptions {
  return caPem ? { ca: caPem, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export const UNVERIFIED_TLS_WARNING =
  "DATABASE_SSL_CA_FILE is not set: database traffic is encrypted but the server certificate is NOT verified (development only)";
```

`packages/db/src/client.ts`:
```ts
import postgres from "postgres";
import { tlsOptions } from "./tls";

export type Sql = postgres.Sql;

/** Internal: only packages/db may import this (enforced by dependency-cruiser). */
export function createSql(url: string, opts: { max: number; applicationName: string; caPem: string | null }): Sql {
  return postgres(url, {
    max: opts.max,
    prepare: false, // required by Supabase's transaction pooler
    ssl: tlsOptions(opts.caPem),
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
    connection: { application_name: opts.applicationName },
  });
}
```

`packages/db/src/schema/index.ts`:
```ts
export {};
```

`packages/db/src/database.ts`:
```ts
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createSql } from "./client";
import * as schema from "./schema";

type DrizzleDb = PostgresJsDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

declare const scope: unique symbol;
export type TenantTx = DbTx & { readonly [scope]: "tenant" };
export type UserTx = DbTx & { readonly [scope]: "user" };
export type SystemTx = DbTx & { readonly [scope]: "system" };

export type Db = {
  withTenant<T>(ctx: { userId: string; workspaceId: string }, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T>;
  withSystem<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;
  listen(channel: string, onNotify: () => void): Promise<() => Promise<void>>;
  ping(): Promise<"ok">;
  close(): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(name: string, value: string) {
  if (!UUID.test(value)) throw new Error(`${name} must be a uuid`);
}

export function createDatabase(url: string, opts: { max: number; applicationName: string; caPem?: string | null }): Db {
  const client = createSql(url, { max: opts.max, applicationName: opts.applicationName, caPem: opts.caPem ?? null });
  const db = drizzle(client, { schema });

  function run<T>(role: "mushin_app" | "mushin_worker", settings: { workspaceId?: string; userId?: string }, fn: (tx: DbTx) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx.execute(role === "mushin_app" ? sql`set local role mushin_app` : sql`set local role mushin_worker`);
      await tx.execute(
        sql`select set_config('app.workspace_id', ${settings.workspaceId ?? ""}, true), set_config('app.user_id', ${settings.userId ?? ""}, true)`,
      );
      return fn(tx);
    });
  }

  return {
    withTenant(ctx, fn) {
      assertUuid("userId", ctx.userId);
      assertUuid("workspaceId", ctx.workspaceId);
      return run("mushin_app", ctx, (tx) => fn(tx as TenantTx));
    },
    withUser(userId, fn) {
      assertUuid("userId", userId);
      return run("mushin_app", { userId }, (tx) => fn(tx as UserTx));
    },
    withSystem(fn) {
      return run("mushin_worker", {}, (tx) => fn(tx as SystemTx));
    },
    async listen(channel, onNotify) {
      const sub = await client.listen(channel, () => onNotify());
      return () => sub.unlisten();
    },
    async ping() {
      await client`select 1`;
      return "ok";
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
```

`packages/db/src/migrate.ts`:
```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sha256Hex } from "@mushin/core";
import { tlsOptions } from "./tls";

const LOCK_KEY = 727_001;

export async function migrate(
  url: string,
  opts: { dir?: string; log?: (m: string) => void; caPem?: string | null } = {},
): Promise<string[]> {
  const dir = opts.dir ?? fileURLToPath(new URL("../migrations/", import.meta.url));
  const sql = postgres(url, { max: 1, prepare: false, ssl: tlsOptions(opts.caPem ?? null), onnotice: () => {} });
  try {
    await sql`create schema if not exists platform`;
    await sql`create table if not exists platform.schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const applied = new Map(
      (await sql<{ name: string; checksum: string }[]>`select name, checksum from platform.schema_migrations`).map((r) => [r.name, r.checksum]),
    );
    const ran: string[] = [];
    for (const file of files) {
      const body = await readFile(join(dir, file), "utf8");
      const checksum = sha256Hex(body);
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into platform.schema_migrations (name, checksum) values (${file}, ${checksum})`;
      });
      ran.push(file);
      opts.log?.(`applied ${file}`);
    }
    return ran;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}
```

`packages/db/src/migrate-cli.ts`:
```ts
import { readCaFile } from "@mushin/core";
import { migrate } from "./migrate";
import { UNVERIFIED_TLS_WARNING } from "./tls";

const test = process.argv.includes("--test");
const name = test ? "TEST_DATABASE_URL" : "DIRECT_URL";
const url = process.env[name];

if (!url || !/^postgres(ql)?:\/\//.test(url) || /@host:\d+\//.test(url)) {
  console.error(`${name} is missing or still a placeholder in .env (use the session pooler URL, port 5432).`);
  process.exit(1);
}

const caPem = readCaFile(process.env[test ? "TEST_DATABASE_SSL_CA_FILE" : "DATABASE_SSL_CA_FILE"]);
if (!caPem) console.warn(UNVERIFIED_TLS_WARNING);
const ran = await migrate(url, { log: (m) => console.log(m), caPem });
console.log(ran.length ? `done: ${ran.length} migration(s) applied` : "already up to date");
```

`packages/db/src/testing.ts`:
```ts
import postgres from "postgres";
import { readCaFile } from "@mushin/core";
import { createDatabase, type Db } from "./database";
import { tlsOptions } from "./tls";

export function testDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests run only against the test database.");
  return url;
}

export function testCaPem(): string | null {
  return readCaFile(process.env["TEST_DATABASE_SSL_CA_FILE"]);
}

export function createTestDatabase(): Db {
  return createDatabase(testDatabaseUrl(), { max: 4, applicationName: "mushin-test", caPem: testCaPem() });
}

/** Runs SQL as the database owner (test setup only). */
export async function ownerQuery<T extends Record<string, unknown>>(text: string): Promise<T[]> {
  const sql = postgres(testDatabaseUrl(), { max: 1, prepare: false, ssl: tlsOptions(testCaPem()), onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Empties every app table (owner privilege; app roles cannot truncate append-only tables). */
export async function resetTables(): Promise<void> {
  const rows = await ownerQuery<{ t: string }>(
    `select format('%I.%I', schemaname, tablename) as t from pg_tables
     where schemaname in ('wp','staff','platform') and tablename <> 'schema_migrations'`,
  );
  if (rows.length) await ownerQuery(`truncate ${rows.map((r) => r.t).join(", ")} restart identity cascade`);
}
```

`packages/db/test/global-setup.ts`:
```ts
import { migrate } from "../src/migrate";
import { testCaPem } from "../src/testing";

export default async function setup(): Promise<void> {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Add the test project's session pooler URL to .env.");
  await migrate(url, { caPem: testCaPem() });
}
```

`packages/db/src/index.ts`:
```ts
export * from "./database";
export * from "./schema";
export { tlsOptions, UNVERIFIED_TLS_WARNING } from "./tls";
export { migrate } from "./migrate";
```

- [ ] **Step 4: Run the integration tests**

Run: `npm run test:int`
Expected: PASS (`migrate.int.test.ts` 2 tests, `database.int.test.ts` 5 tests). A failure mentioning `TEST_DATABASE_URL` means the checkpoint above was skipped.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify` → lint, typecheck, boundaries, unit + int tests all pass.
```bash
git add -A
git commit -m "feat(db): add migration runner, app roles, tenant/user/system transaction scopes and test harness"
```

---

### Task 11: Identity tables with RLS, catalog guard and schema drift test

**Files:**
- Create: `packages/db/migrations/0002_identity.sql`, `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/rls.int.test.ts`, `packages/db/src/schema-drift.int.test.ts`

**Interfaces:**
- Produces (Drizzle): `users`, `workspaces`, `workspaceMembers` tables (from `@mushin/db`); `ALL_TABLES` array used by the drift test (extended by later tasks).

- [ ] **Step 1: Write the migration**

`packages/db/migrations/0002_identity.sql`:
```sql
create table wp.users (
  id uuid primary key,
  email text not null,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  preferences jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wp.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_user_id uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wp.workspace_members (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on wp.workspace_members (user_id);

create trigger users_updated_at before update on wp.users for each row execute function platform.set_updated_at();
create trigger workspaces_updated_at before update on wp.workspaces for each row execute function platform.set_updated_at();
create trigger workspace_members_updated_at before update on wp.workspace_members for each row execute function platform.set_updated_at();

alter table wp.users enable row level security;
alter table wp.users force row level security;
create policy users_self on wp.users
  using (id = platform.current_user_id())
  with check (id = platform.current_user_id());

alter table wp.workspaces enable row level security;
alter table wp.workspaces force row level security;
create policy workspaces_current on wp.workspaces
  using (id = platform.current_workspace_id())
  with check (id = platform.current_workspace_id());

alter table wp.workspace_members enable row level security;
alter table wp.workspace_members force row level security;
create policy workspace_members_tenant on wp.workspace_members
  using (workspace_id = platform.current_workspace_id() or user_id = platform.current_user_id())
  with check (workspace_id = platform.current_workspace_id());

grant select, insert, update on wp.users, wp.workspaces, wp.workspace_members to mushin_app, mushin_worker;
```

- [ ] **Step 2: Write the Drizzle schema**

`packages/db/src/schema/identity.ts`:
```ts
import { jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const wp = pgSchema("wp");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = wp.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  status: text("status", { enum: ["active", "suspended", "deleted"] }).notNull().default("active"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaces = wp.table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = wp.table(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);
```

`packages/db/src/schema/index.ts`:
```ts
import { users, workspaceMembers, workspaces } from "./identity";

export * from "./identity";

/** Every Drizzle table; the drift test compares each one with the live database. */
export const ALL_TABLES = [users, workspaces, workspaceMembers];
```

- [ ] **Step 3: Write the tests**

`packages/db/src/rls.int.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ownerQuery } from "./testing";

describe("RLS catalog guard", () => {
  it("every wp table has RLS enabled, forced and a tenant/user-scoped policy", async () => {
    const rows = await ownerQuery<{ table: string; enabled: boolean; forced: boolean; scoped: number }>(`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p
          where p.polrelid = c.oid
            and pg_get_expr(p.polqual, p.polrelid) ~ 'current_(workspace|user)_id') as scoped
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'wp' and c.relkind = 'r'
      order by 1`);
    expect(rows.length).toBeGreaterThan(0);
    const offenders = rows.filter((r) => !r.enabled || !r.forced || r.scoped === 0).map((r) => r.table);
    expect(offenders).toEqual([]);
  });

  it("no app role can bypass RLS", async () => {
    const rows = await ownerQuery<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles where rolname in ('mushin_app','mushin_worker')`,
    );
    expect(rows.every((r) => !r.rolbypassrls)).toBe(true);
  });
});
```

`packages/db/src/schema-drift.int.test.ts`:
```ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ALL_TABLES } from "./schema";
import { ownerQuery } from "./testing";

describe("Drizzle schema matches the database", () => {
  for (const table of ALL_TABLES) {
    const cfg = getTableConfig(table);
    it(`${cfg.schema}.${cfg.name}`, async () => {
      const cols = await ownerQuery<{ column_name: string; is_nullable: "YES" | "NO" }>(`
        select column_name, is_nullable from information_schema.columns
        where table_schema = '${cfg.schema}' and table_name = '${cfg.name}' order by column_name`);
      const live = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable === "NO"]));
      const declared = Object.fromEntries(cfg.columns.map((c) => [c.name, c.notNull]));
      expect(declared).toEqual(live);
    });
  }
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:int`
Expected: PASS (global setup applies `0002_identity.sql`; RLS 2 tests; drift 3 tests; earlier tests still pass).

- [ ] **Step 5: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(db): add identity tables with forced RLS, catalog guard and schema drift test"
```

---

### Task 12: Identity module, `/v1/me` and the API composition root

**Files:**
- Create: `apps/api/src/modules/identity/repository.ts`, `apps/api/src/modules/identity/service.ts`, `apps/api/src/modules/identity/routes.ts`, `apps/api/src/modules/identity/index.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/modules/identity/identity.int.test.ts`

**Interfaces:**
- Consumes: `Db`, `TenantTx`, `UserTx`, `users`, `workspaces`, `workspaceMembers` (db); `CustomerIdentity`, `createCustomerGuard`, `tenantOf` (Task 7); `AppModule`, `sendOk` (Task 5); `meResponseSchema` (contracts).
- Produces: `createIdentityModule(o: { db: Db }): { resolveTenant: ResolveTenant; module: AppModule }`; route `GET /v1/me`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/identity/identity.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier, type CustomerIdentity } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp, noGuards } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createIdentityModule } from "./index";

const db = createTestDatabase();
const identity = createIdentityModule({ db });
const person = (over: Partial<CustomerIdentity> = {}): CustomerIdentity => ({
  userId: randomUUID(),
  email: "ayesha@mushin.pk",
  fullName: "Ayesha Malik",
  ...over,
});

beforeEach(resetTables);
afterAll(() => db.close());

describe("identity provisioning", () => {
  it("creates user, workspace and owner membership on first request, then reuses them", async () => {
    const who = person();
    const first = await identity.resolveTenant(who, "req-1");
    expect(first).toMatchObject({ requestId: "req-1", userId: who.userId, role: "owner" });
    const second = await identity.resolveTenant(who, "req-2");
    expect(second.workspaceId).toBe(first.workspaceId);
    const counts = await ownerQuery<{ u: number; w: number; m: number; name: string }>(`
      select (select count(*)::int from wp.users) u, (select count(*)::int from wp.workspaces) w,
             (select count(*)::int from wp.workspace_members) m, (select name from wp.workspaces limit 1) name`);
    expect(counts[0]).toEqual({ u: 1, w: 1, m: 1, name: "Ayesha Malik's workspace" });
  });

  it("creates exactly one workspace under concurrent first requests (Review Focus 2)", async () => {
    const who = person();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => identity.resolveTenant(who, `r${i}`)));
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    const rows = await ownerQuery<{ w: number; m: number }>(
      `select (select count(*)::int from wp.workspaces) w, (select count(*)::int from wp.workspace_members) m`,
    );
    expect(rows[0]).toEqual({ w: 1, m: 1 });
  });

  it("names the workspace from the email when there is no full name", async () => {
    await identity.resolveTenant(person({ fullName: null, email: "bilal@brand.pk" }), "r");
    const rows = await ownerQuery<{ name: string }>(`select name from wp.workspaces`);
    expect(rows[0]?.name).toBe("bilal's workspace");
  });

  it("keeps one user from reading another user's workspace", async () => {
    const a = await identity.resolveTenant(person(), "a");
    const b = await identity.resolveTenant(person({ email: "b@b.pk" }), "b");
    const seen = await db.withTenant(a, (tx) => tx.execute<{ id: string }>(sql`select id from wp.workspaces`));
    expect(seen.map((r) => r.id)).toEqual([a.workspaceId]);
    expect(b.workspaceId).not.toBe(a.workspaceId);
  });
});

describe("GET /v1/me", () => {
  it("returns the signed-in user's profile and workspace, ignoring client-supplied workspace ids", async () => {
    const iss = await createTestIssuer();
    const guard = createCustomerGuard({
      verify: createCustomerTokenVerifier({ issuer: iss.issuer, audience: iss.audience, keys: iss.keys }),
      resolveTenant: identity.resolveTenant,
      limiter: new MemoryRateLimiter({
        ip: { limit: 100, windowSeconds: 60 },
        user: { limit: 100, windowSeconds: 60 },
        auth: { limit: 100, windowSeconds: 60 },
      }),
    });
    const app = await buildTestApp({ guards: { ...noGuards(), customer: guard }, modules: [identity.module] });
    const sub = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${await iss.sign({ sub, email: "sana@mushin.pk", fullName: "Sana Riaz" })}`, "x-workspace-id": randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ id: sub, email: "sana@mushin.pk", displayName: "Sana Riaz", avatarUrl: null });
    expect(body.workspace).toMatchObject({ name: "Sana Riaz's workspace", role: "owner" });

    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project int apps/api/src/modules/identity`
Expected: FAIL, `./index` not found.

- [ ] **Step 3: Implement the module**

`apps/api/src/modules/identity/repository.ts`:
```ts
import { asc, eq, sql } from "drizzle-orm";
import { users, workspaceMembers, workspaces, type TenantTx, type UserTx } from "@mushin/db";
import type { WorkspaceRole } from "@mushin/core";

export type Membership = { workspaceId: string; role: WorkspaceRole };

export async function findMembership(tx: UserTx | TenantTx, userId: string): Promise<Membership | null> {
  const rows = await tx
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Serializes provisioning per user inside the current transaction. */
export async function lockUser(tx: TenantTx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

export async function upsertUser(tx: TenantTx, u: { id: string; email: string; displayName: string | null }): Promise<void> {
  await tx
    .insert(users)
    .values({ id: u.id, email: u.email, displayName: u.displayName })
    .onConflictDoUpdate({ target: users.id, set: { email: u.email } });
}

export async function insertWorkspace(tx: TenantTx, w: { id: string; name: string; ownerUserId: string }): Promise<void> {
  await tx.insert(workspaces).values(w);
}

export async function insertMember(tx: TenantTx, m: { workspaceId: string; userId: string; role: WorkspaceRole }): Promise<void> {
  await tx.insert(workspaceMembers).values(m);
}

export async function getMe(tx: TenantTx, ids: { userId: string; workspaceId: string }) {
  const rows = await tx
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(sql`${workspaceMembers.userId} = ${ids.userId} and ${workspaceMembers.workspaceId} = ${ids.workspaceId}`)
    .limit(1);
  return rows[0] ?? null;
}
```

`apps/api/src/modules/identity/service.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Db } from "@mushin/db";
import type { TenantContext } from "@mushin/core";
import type { CustomerIdentity } from "../../auth/customer-token";
import * as repo from "./repository";

export function workspaceNameFor(identity: CustomerIdentity): string {
  const base = identity.fullName ?? identity.email.split("@")[0] ?? "My";
  return `${base}'s workspace`.slice(0, 120);
}

export function createIdentityService(db: Db) {
  async function resolveTenant(identity: CustomerIdentity, requestId: string): Promise<TenantContext> {
    const existing = await db.withUser(identity.userId, (tx) => repo.findMembership(tx, identity.userId));
    if (existing) return { requestId, userId: identity.userId, ...existing };

    const workspaceId = randomUUID();
    const membership = await db.withTenant({ userId: identity.userId, workspaceId }, async (tx) => {
      await repo.lockUser(tx, identity.userId);
      const raced = await repo.findMembership(tx, identity.userId);
      if (raced) return raced;
      await repo.upsertUser(tx, { id: identity.userId, email: identity.email, displayName: identity.fullName });
      await repo.insertWorkspace(tx, { id: workspaceId, name: workspaceNameFor(identity), ownerUserId: identity.userId });
      await repo.insertMember(tx, { workspaceId, userId: identity.userId, role: "owner" });
      return { workspaceId, role: "owner" as const };
    });
    return { requestId, userId: identity.userId, ...membership };
  }

  function getMe(ctx: TenantContext) {
    return db.withTenant(ctx, (tx) => repo.getMe(tx, ctx));
  }

  return { resolveTenant, getMe };
}
```

`apps/api/src/modules/identity/routes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { meResponseSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { sendOk } from "../../http/validate";
import type { createIdentityService } from "./service";

export function registerIdentityRoutes(app: FastifyInstance, guards: Guards, service: ReturnType<typeof createIdentityService>) {
  app.get("/v1/me", { preHandler: guards.customer }, async (req, reply) => {
    const me = await service.getMe(tenantOf(req));
    if (!me) throw new AppError("NOT_FOUND", "Account not found");
    return sendOk(reply, meResponseSchema, {
      user: { id: me.userId, email: me.email, displayName: me.displayName, avatarUrl: me.avatarUrl },
      workspace: { id: me.workspaceId, name: me.workspaceName, role: me.role },
    });
  });
}
```

`apps/api/src/modules/identity/index.ts`:
```ts
import type { Db } from "@mushin/db";
import type { ResolveTenant } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { registerIdentityRoutes } from "./routes";
import { createIdentityService } from "./service";

export function createIdentityModule(o: { db: Db }): { resolveTenant: ResolveTenant; module: AppModule } {
  const service = createIdentityService(o.db);
  return {
    resolveTenant: service.resolveTenant,
    module: { name: "identity", register: (app, guards) => registerIdentityRoutes(app, guards, service) },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project int apps/api/src/modules/identity`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the composition root**

`apps/api/src/server.ts`:
```ts
import { AppError, createLogger, loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { buildApp } from "./app";
import { createCustomerGuard } from "./auth/customer-guard";
import { createCustomerTokenVerifier, remoteJwks } from "./auth/customer-token";
import type { Guards, ReadinessCheck } from "./http/types";
import { createIdentityModule } from "./modules/identity";
import { MemoryRateLimiter } from "./rate-limit/memory";
import { ipRateLimitHook } from "./rate-limit/plugin";
import { bucketsFromConfig, type RateLimiter } from "./rate-limit/types";
import { createUpstashRateLimiter } from "./rate-limit/upstash";

const config = loadApiConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "api" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 10, applicationName: "mushin-api", caPem: config.databaseCaPem });

const buckets = bucketsFromConfig(config.rateLimit);
const readiness: ReadinessCheck[] = [{ name: "database", check: () => db.ping() }];
let limiter: RateLimiter;
if (config.rateLimit.upstash) {
  const upstash = createUpstashRateLimiter(config.rateLimit.upstash, buckets, logger);
  limiter = upstash.limiter;
  readiness.push({ name: "redis", check: () => upstash.ping() });
} else {
  logger.warn("UPSTASH_REDIS_REST_URL/TOKEN not set: using the in-memory rate limiter");
  limiter = new MemoryRateLimiter(buckets);
  readiness.push({ name: "redis", check: async () => "skipped" });
}

const identity = createIdentityModule({ db });
const notYet = async () => {
  throw new AppError("INTERNAL", "Idempotency is not configured yet");
};
const guards: Guards = {
  customer: createCustomerGuard({
    verify: createCustomerTokenVerifier({ issuer: config.auth.issuer, audience: config.auth.audience, keys: remoteJwks(config.auth.jwksUri) }),
    resolveTenant: identity.resolveTenant,
    limiter,
  }),
  idempotent: notYet,
};

const app = await buildApp({
  logger,
  allowedOrigins: config.allowedOrigins,
  guards,
  modules: [identity.module],
  readiness,
  onRequestHooks: [ipRateLimitHook(limiter)],
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  await app.close();
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: "0.0.0.0" });
```
(`idempotent` is replaced with the real guard in Task 15.)

- [ ] **Step 6: Apply migrations to the dev database and smoke-test the server**

Requires real `DATABASE_URL` and `DIRECT_URL` in `.env`. Run:
```bash
npm run db:migrate
npm run dev:api
```
In another terminal: `curl -s localhost:4000/health/ready` → `{"status":"ok","checks":{"database":"ok","redis":...}}` and `curl -s localhost:4000/v1/me` → 401 envelope. Stop the server (Ctrl+C). If `DIRECT_URL` is still a placeholder, `db:migrate` prints the placeholder message: note it in the task report and continue (tests cover the behavior).

- [ ] **Step 7: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(identity): provision personal workspaces on first request and serve GET /v1/me"
```

---

### Task 13: Staff tables, repository and login + TOTP

**Files:**
- Create: `packages/db/migrations/0003_staff.sql`, `packages/db/src/schema/staff.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `apps/api/src/modules/staff/repository.ts`, `apps/api/src/modules/staff/service.ts`, `apps/api/src/modules/staff/routes.ts`, `apps/api/src/modules/staff/index.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/modules/staff/staff-login.int.test.ts`

**Interfaces:**
- Consumes: Task 8 primitives; `Db`, `SystemTx`; `encryptSecret`, `decryptSecret`, `sha256Hex`, `randomToken` (core); staff contracts.
- Produces:
  ```ts
  createStaffModule(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }): {
    module: AppModule;
    requireStaff(action: StaffAction): PreHandler;
    createStaffAccount(input: { email: string; name: string; role: StaffRole }): Promise<{ id: string; password: string; totpSecret: string; totpUri: string }>;
  }
  REFRESH_COOKIE = "mushin_staff_rt"
  // routes: POST /admin/v1/auth/login, POST /admin/v1/auth/totp, GET /admin/v1/me
  // Fastify request augmentation: req.staff: StaffPrincipal | null
  ```

- [ ] **Step 1: Write the migration**

`packages/db/migrations/0003_staff.sql`:
```sql
create table staff.staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null check (length(name) between 1 and 120),
  password_hash text not null,
  totp_secret_encrypted text not null,
  role text not null check (role in ('admin', 'support')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  failed_login_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index staff_users_email_key on staff.staff_users (lower(email));
create trigger staff_users_updated_at before update on staff.staff_users for each row execute function platform.set_updated_at();

create table staff.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  family_id uuid not null,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_sessions_family_idx on staff.staff_sessions (family_id);

-- Append-only: app roles get SELECT/INSERT only.
create table staff.audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff.staff_users (id),
  action text not null,
  target_type text,
  target_id text,
  workspace_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_log_staff_idx on staff.audit_log (staff_id, created_at desc);

grant select, insert, update on staff.staff_users, staff.staff_sessions to mushin_worker;
grant select, insert on staff.audit_log to mushin_worker;
```

- [ ] **Step 2: Write the Drizzle schema**

`packages/db/src/schema/staff.ts`:
```ts
import { integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const staffSchema = pgSchema("staff");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const staffUsers = staffSchema.table("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
  role: text("role", { enum: ["admin", "support"] }).notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const staffSessions = staffSchema.table("staff_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
  familyId: uuid("family_id").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = staffSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").references(() => staffUsers.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  workspaceId: uuid("workspace_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
```

`packages/db/src/schema/index.ts`:
```ts
import { users, workspaceMembers, workspaces } from "./identity";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./identity";
export * from "./staff";

export const ALL_TABLES = [users, workspaces, workspaceMembers, staffUsers, staffSessions, auditLog];
```

- [ ] **Step 3: Write the failing tests**

`apps/api/src/modules/staff/staff-login.int.test.ts`:
```ts
import { sql } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createStaffModule } from "./index";
import { createStaffTokens } from "./tokens";

const db = createTestDatabase();
const key = Buffer.alloc(32, 9);
const tokens = createStaffTokens("t".repeat(48));
const staff = createStaffModule({ db, tokens, encryptionKey: key });

beforeEach(resetTables);
afterAll(() => db.close());

async function app() {
  return buildTestApp({ modules: [staff.module] });
}

async function login(a: Awaited<ReturnType<typeof app>>, email: string, password: string) {
  return a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password } });
}

describe("staff login + TOTP", () => {
  it("completes the two-step login and returns an access token and refresh cookie", async () => {
    const acct = await staff.createStaffAccount({ email: "Admin@Mushin.pk", name: "Admin", role: "admin" });
    const a = await app();
    const step1 = await login(a, "admin@mushin.pk", acct.password);
    expect(step1.statusCode).toBe(200);
    const { challengeToken } = step1.json();

    const step2 = await a.inject({
      method: "POST",
      url: "/admin/v1/auth/totp",
      payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json()).toMatchObject({ expiresInSeconds: 900, staff: { email: "admin@mushin.pk", role: "admin" } });
    const cookie = String(step2.headers["set-cookie"]);
    expect(cookie).toMatch(/mushin_staff_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/admin\/v1\/auth/);

    const me = await a.inject({ method: "GET", url: "/admin/v1/me", headers: { authorization: `Bearer ${step2.json().accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().staff.email).toBe("admin@mushin.pk");

    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log order by created_at`);
    expect(audit.map((r) => r.action)).toContain("staff.login.succeeded");
  });

  it("gives the same error for unknown email and wrong password", async () => {
    await staff.createStaffAccount({ email: "s@mushin.pk", name: "Support", role: "support" });
    const a = await app();
    const unknown = await login(a, "nobody@mushin.pk", "x");
    const wrong = await login(a, "s@mushin.pk", "wrong");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it("locks the account after 5 failures for 15 minutes", async () => {
    const acct = await staff.createStaffAccount({ email: "l@mushin.pk", name: "L", role: "support" });
    const a = await app();
    for (let i = 0; i < 5; i++) await login(a, "l@mushin.pk", "wrong");
    const locked = await login(a, "l@mushin.pk", acct.password);
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.message).toMatch(/too many/i);
    const rows = await ownerQuery<{ locked: boolean }>(`select locked_until > now() + interval '14 minutes' as locked from staff.staff_users`);
    expect(rows[0]?.locked).toBe(true);
  });

  it("rejects a wrong TOTP code and an access token used as a challenge", async () => {
    const acct = await staff.createStaffAccount({ email: "t@mushin.pk", name: "T", role: "admin" });
    const a = await app();
    const { challengeToken } = (await login(a, "t@mushin.pk", acct.password)).json();
    const bad = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: "000000" } });
    expect(bad.statusCode).toBe(401);
    const access = await tokens.signAccess({ staffId: acct.id, role: "admin" });
    const misuse = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken: access, code: "123456" } });
    expect(misuse.statusCode).toBe(401);
  });

  it("stores the TOTP secret encrypted and the audit log is append-only", async () => {
    const acct = await staff.createStaffAccount({ email: "e@mushin.pk", name: "E", role: "admin" });
    const rows = await ownerQuery<{ s: string }>(`select totp_secret_encrypted s from staff.staff_users`);
    expect(rows[0]?.s.startsWith("v1.")).toBe(true);
    expect(rows[0]?.s).not.toContain(acct.totpSecret);
    await expect(db.withSystem((tx) => tx.execute(sql`update staff.audit_log set action = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(db.withSystem((tx) => tx.execute(sql`delete from staff.audit_log`))).rejects.toThrow(/permission denied/);
  });

  it("denies the customer API role any access to staff tables", async () => {
    const rows = await ownerQuery<{ p: boolean }>(`select has_table_privilege('mushin_app', 'staff.staff_users', 'select') as p`);
    expect(rows[0]?.p).toBe(false);
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `npx vitest run --project int apps/api/src/modules/staff`
Expected: FAIL, `./index` not found.

- [ ] **Step 5: Implement repository, service, routes and index**

`apps/api/src/modules/staff/repository.ts`:
```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { auditLog, staffSessions, staffUsers, type SystemTx } from "@mushin/db";

export type StaffRow = typeof staffUsers.$inferSelect;

export async function findStaffByEmail(tx: SystemTx, email: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(sql`lower(${staffUsers.email}) = ${email.toLowerCase()}`).limit(1);
  return rows[0] ?? null;
}

export async function findStaffById(tx: SystemTx, id: string): Promise<StaffRow | null> {
  const rows = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertStaff(
  tx: SystemTx,
  s: { email: string; name: string; passwordHash: string; totpSecretEncrypted: string; role: "admin" | "support" },
): Promise<string> {
  const rows = await tx.insert(staffUsers).values(s).returning({ id: staffUsers.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("insert returned no id");
  return id;
}

export async function registerFailure(tx: SystemTx, id: string, maxFailures: number, lockMinutes: number): Promise<void> {
  await tx.execute(sql`
    update staff.staff_users set
      failed_login_count = failed_login_count + 1,
      locked_until = case when failed_login_count + 1 >= ${maxFailures}
        then now() + make_interval(mins => ${lockMinutes}) else locked_until end
    where id = ${id}`);
}

export async function recordSuccessfulLogin(tx: SystemTx, id: string): Promise<void> {
  await tx.update(staffUsers).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(staffUsers.id, id));
}

export async function insertSession(
  tx: SystemTx,
  s: { staffId: string; familyId: string; refreshTokenHash: string; expiresAt: Date; ip: string | null; userAgent: string | null },
): Promise<void> {
  await tx.insert(staffSessions).values(s);
}

export async function findSessionByHashForUpdate(tx: SystemTx, hash: string) {
  const rows = await tx.select().from(staffSessions).where(eq(staffSessions.refreshTokenHash, hash)).for("update").limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(tx: SystemTx, id: string): Promise<void> {
  await tx.update(staffSessions).set({ revokedAt: sql`now()` }).where(and(eq(staffSessions.id, id), isNull(staffSessions.revokedAt)));
}

export async function revokeFamily(tx: SystemTx, familyId: string): Promise<void> {
  await tx.update(staffSessions).set({ revokedAt: sql`now()` }).where(and(eq(staffSessions.familyId, familyId), isNull(staffSessions.revokedAt)));
}

export async function audit(
  tx: SystemTx,
  e: { staffId: string | null; action: string; metadata?: Record<string, unknown>; ip: string | null; requestId: string | null },
): Promise<void> {
  await tx.insert(auditLog).values({ staffId: e.staffId, action: e.action, metadata: e.metadata ?? {}, ip: e.ip, requestId: e.requestId });
}
```

`apps/api/src/modules/staff/service.ts`:
```ts
import { randomUUID } from "node:crypto";
import { AppError, decryptSecret, encryptSecret, randomToken, sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import * as repo from "./repository";
import { ACCESS_TTL_SECONDS, type StaffRole, type StaffTokens } from "./tokens";
import { newTotpSecret, totpUri, verifyTotp } from "./totp";

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 7;

export type RequestMeta = { ip: string | null; userAgent: string | null; requestId: string };
export type StaffProfile = { id: string; email: string; name: string; role: StaffRole };
export type StaffSession = { accessToken: string; expiresInSeconds: number; refreshToken: string; staff: StaffProfile };

const invalidCredentials = () => new AppError("UNAUTHENTICATED", "Invalid email or password");
const tooManyAttempts = () => new AppError("UNAUTHENTICATED", "Too many attempts. Try again in 15 minutes.");
const invalidSession = () => new AppError("UNAUTHENTICATED", "Your admin session has ended. Please sign in again.");

const profileOf = (s: repo.StaffRow): StaffProfile => ({ id: s.id, email: s.email, name: s.name, role: s.role });

export function createStaffService(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }) {
  const now = o.now ?? (() => new Date());

  async function failure(staffId: string, reason: string, meta: RequestMeta) {
    await o.db.withSystem(async (tx) => {
      await repo.registerFailure(tx, staffId, MAX_FAILURES, LOCK_MINUTES);
      await repo.audit(tx, { staffId, action: "staff.login.failed", metadata: { reason }, ip: meta.ip, requestId: meta.requestId });
    });
  }

  async function issueSession(staff: repo.StaffRow, familyId: string, meta: RequestMeta): Promise<StaffSession> {
    const refreshToken = randomToken(32);
    await o.db.withSystem((tx) =>
      repo.insertSession(tx, {
        staffId: staff.id,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(now().getTime() + SESSION_DAYS * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return {
      accessToken: await o.tokens.signAccess({ staffId: staff.id, role: staff.role }),
      expiresInSeconds: ACCESS_TTL_SECONDS,
      refreshToken,
      staff: profileOf(staff),
    };
  }

  return {
    async createStaffAccount(input: { email: string; name: string; role: StaffRole }) {
      const password = randomToken(18);
      const totpSecret = newTotpSecret();
      const email = input.email.trim().toLowerCase();
      const id = await o.db.withSystem((tx) =>
        hashPassword(password).then((passwordHash) =>
          repo.insertStaff(tx, {
            email,
            name: input.name.trim(),
            role: input.role,
            passwordHash,
            totpSecretEncrypted: encryptSecret(totpSecret, o.encryptionKey),
          }),
        ),
      );
      return { id, password, totpSecret, totpUri: totpUri(email, totpSecret) };
    },

    async login(input: { email: string; password: string }, meta: RequestMeta): Promise<{ challengeToken: string }> {
      const staff = await o.db.withSystem((tx) => repo.findStaffByEmail(tx, input.email));
      if (!staff || staff.status !== "active") {
        await verifyPassword(await dummyHash(), input.password);
        await o.db.withSystem((tx) =>
          repo.audit(tx, { staffId: null, action: "staff.login.failed", metadata: { reason: "unknown_or_disabled" }, ip: meta.ip, requestId: meta.requestId }),
        );
        throw invalidCredentials();
      }
      if (staff.lockedUntil && staff.lockedUntil > now()) throw tooManyAttempts();
      if (!(await verifyPassword(staff.passwordHash, input.password))) {
        await failure(staff.id, "bad_password", meta);
        throw invalidCredentials();
      }
      return { challengeToken: await o.tokens.signChallenge(staff.id) };
    },

    async completeTotp(input: { challengeToken: string; code: string }, meta: RequestMeta): Promise<StaffSession> {
      const staffId = await o.tokens.verifyChallenge(input.challengeToken);
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      if (!staff || staff.status !== "active") throw invalidCredentials();
      if (staff.lockedUntil && staff.lockedUntil > now()) throw tooManyAttempts();
      if (!(await verifyTotp(decryptSecret(staff.totpSecretEncrypted, o.encryptionKey), input.code))) {
        await failure(staff.id, "bad_totp", meta);
        throw new AppError("UNAUTHENTICATED", "Invalid verification code");
      }
      await o.db.withSystem(async (tx) => {
        await repo.recordSuccessfulLogin(tx, staff.id);
        await repo.audit(tx, { staffId: staff.id, action: "staff.login.succeeded", ip: meta.ip, requestId: meta.requestId });
      });
      return issueSession(staff, randomUUID(), meta);
    },

    async getProfile(staffId: string): Promise<StaffProfile> {
      const staff = await o.db.withSystem((tx) => repo.findStaffById(tx, staffId));
      if (!staff || staff.status !== "active") throw invalidSession();
      return profileOf(staff);
    },

    issueSession,
    invalidSession,
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
```

`apps/api/src/modules/staff/routes.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  staffLoginRequestSchema,
  staffLoginResponseSchema,
  staffMeResponseSchema,
  staffSessionResponseSchema,
  staffTotpRequestSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { bearerToken } from "../../http/bearer";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { can, type StaffAction } from "./permissions";
import { SESSION_DAYS, type RequestMeta, type StaffService } from "./service";
import type { StaffPrincipal, StaffTokens } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    staff: StaffPrincipal | null;
  }
}

export const REFRESH_COOKIE = "mushin_staff_rt";
export const COOKIE_PATH = "/admin/v1/auth";

export function metaOf(req: FastifyRequest): RequestMeta {
  const ua = req.headers["user-agent"];
  return { ip: req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null, requestId: req.id };
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function createRequireStaff(tokens: StaffTokens) {
  return (action: StaffAction): PreHandler =>
    async (req) => {
      const token = bearerToken(req);
      if (!token) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
      const principal = await tokens.verifyAccess(token);
      if (!can(principal.role, action)) throw new AppError("FORBIDDEN", "You do not have permission to do this");
      req.staff = principal;
    };
}

export function registerStaffRoutes(app: FastifyInstance, service: StaffService, requireStaff: ReturnType<typeof createRequireStaff>) {
  app.decorateRequest("staff", null);

  app.post("/admin/v1/auth/login", async (req, reply) => {
    const body = parseInput(staffLoginRequestSchema, req.body);
    return sendOk(reply, staffLoginResponseSchema, await service.login(body, metaOf(req)));
  });

  app.post("/admin/v1/auth/totp", async (req, reply) => {
    const body = parseInput(staffTotpRequestSchema, req.body);
    const session = await service.completeTotp(body, metaOf(req));
    setRefreshCookie(reply, session.refreshToken);
    return sendOk(reply, staffSessionResponseSchema, {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      staff: session.staff,
    });
  });

  app.get("/admin/v1/me", { preHandler: requireStaff("staff.me.read") }, async (req, reply) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return sendOk(reply, staffMeResponseSchema, { staff: await service.getProfile(req.staff.staffId) });
  });
}
```

`apps/api/src/modules/staff/index.ts`:
```ts
import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import type { StaffAction } from "./permissions";
import { createRequireStaff, registerStaffRoutes } from "./routes";
import { createStaffService } from "./service";
import type { StaffRole, StaffTokens } from "./tokens";

export { createStaffTokens } from "./tokens";
export type { StaffAction, StaffRole };

export function createStaffModule(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }) {
  const service = createStaffService(o);
  const requireStaff = createRequireStaff(o.tokens);
  const module: AppModule = { name: "staff", register: (app) => registerStaffRoutes(app, service, requireStaff) };
  return { module, requireStaff, createStaffAccount: service.createStaffAccount };
}
```

In `apps/api/src/server.ts`, add the staff module:
```ts
import { createStaffModule, createStaffTokens } from "./modules/staff";
// …after `const identity = …`
const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey });
// …and in buildApp:
  modules: [identity.module, staff.module],
```

Note: `apps/api/src/modules/staff/primitives.test.ts` (Task 8) imports internals from inside the same module, which the boundary rules allow.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project int apps/api/src/modules/staff packages/db`
Expected: PASS (staff 6 tests; drift test now also checks 3 staff tables; RLS guard still passes because `staff` is not a `wp` schema).

- [ ] **Step 7: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(staff): add staff tables, audited two-step login with mandatory TOTP and lockout"
```

---

### Task 14: Staff refresh, logout and the `create-admin` script

**Files:**
- Modify: `apps/api/src/modules/staff/service.ts`, `apps/api/src/modules/staff/routes.ts`
- Create: `scripts/create-admin.ts`
- Test: `apps/api/src/modules/staff/staff-session.int.test.ts`

**Interfaces:**
- Produces: service `refresh(refreshToken: string, meta: RequestMeta): Promise<StaffSession>`, `logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void>`; routes `POST /admin/v1/auth/refresh` (cookie in, new cookie + access token out), `POST /admin/v1/auth/logout` (204, clears cookie); script `npm run create-admin -- --email <e> --name <n> [--role admin|support]`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/staff/staff-session.int.test.ts`:
```ts
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp } from "../../test-support/app";
import { createStaffModule } from "./index";
import { createStaffTokens } from "./tokens";

const db = createTestDatabase();
const staff = createStaffModule({ db, tokens: createStaffTokens("r".repeat(48)), encryptionKey: Buffer.alloc(32, 3) });

beforeEach(resetTables);
afterAll(() => db.close());

function cookieValue(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
  const m = /mushin_staff_rt=([^;]*)/.exec(raw);
  if (!m?.[1]) throw new Error("no refresh cookie");
  return m[1];
}

async function signedIn() {
  const acct = await staff.createStaffAccount({ email: "admin@mushin.pk", name: "Admin", role: "admin" });
  const a = await buildTestApp({ modules: [staff.module] });
  const { challengeToken } = (await a.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: "admin@mushin.pk", password: acct.password } })).json();
  const res = await a.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
  return { a, refresh: cookieValue(res.headers["set-cookie"]) };
}

const refreshWith = (a: Awaited<ReturnType<typeof signedIn>>["a"], token: string) =>
  a.inject({ method: "POST", url: "/admin/v1/auth/refresh", cookies: { mushin_staff_rt: token } });

describe("staff sessions", () => {
  it("rotates the refresh token", async () => {
    const { a, refresh } = await signedIn();
    const res = await refreshWith(a, refresh);
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toEqual(expect.any(String));
    expect(cookieValue(res.headers["set-cookie"])).not.toBe(refresh);
  });

  it("revokes the whole family when an old refresh token is reused", async () => {
    const { a, refresh } = await signedIn();
    const rotated = cookieValue((await refreshWith(a, refresh)).headers["set-cookie"]);
    expect((await refreshWith(a, refresh)).statusCode).toBe(401);
    expect((await refreshWith(a, rotated)).statusCode).toBe(401);
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log`);
    expect(audit.map((r) => r.action)).toContain("staff.session.reuse_detected");
  });

  it("logs out: clears the cookie and the token stops working", async () => {
    const { a, refresh } = await signedIn();
    const out = await a.inject({ method: "POST", url: "/admin/v1/auth/logout", cookies: { mushin_staff_rt: refresh } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/mushin_staff_rt=;/);
    expect((await refreshWith(a, refresh)).statusCode).toBe(401);
  });

  it("rejects refresh without a cookie or with an unknown token", async () => {
    const a = await buildTestApp({ modules: [staff.module] });
    expect((await a.inject({ method: "POST", url: "/admin/v1/auth/refresh" })).statusCode).toBe(401);
    expect((await refreshWith(a, "nope")).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project int apps/api/src/modules/staff/staff-session.int.test.ts`
Expected: FAIL, 404 on `/admin/v1/auth/refresh`.

- [ ] **Step 3: Implement refresh and logout**

Add to the object returned by `createStaffService` in `apps/api/src/modules/staff/service.ts`:
```ts
    async refresh(refreshToken: string, meta: RequestMeta): Promise<StaffSession> {
      const hash = sha256Hex(refreshToken);
      // Decide inside the transaction, throw after it commits, so reuse revocation is persisted.
      const outcome = await o.db.withSystem(async (tx) => {
        const session = await repo.findSessionByHashForUpdate(tx, hash);
        if (!session) return { kind: "invalid" as const };
        if (session.revokedAt) {
          await repo.revokeFamily(tx, session.familyId);
          await repo.audit(tx, { staffId: session.staffId, action: "staff.session.reuse_detected", ip: meta.ip, requestId: meta.requestId });
          return { kind: "invalid" as const };
        }
        if (session.expiresAt <= now()) return { kind: "invalid" as const };
        const staff = await repo.findStaffById(tx, session.staffId);
        if (!staff || staff.status !== "active") return { kind: "invalid" as const };
        await repo.revokeSession(tx, session.id);
        return { kind: "ok" as const, staff, familyId: session.familyId };
      });
      if (outcome.kind === "invalid") throw invalidSession();
      return issueSession(outcome.staff, outcome.familyId, meta);
    },

    async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
      if (!refreshToken) return;
      await o.db.withSystem(async (tx) => {
        const session = await repo.findSessionByHashForUpdate(tx, sha256Hex(refreshToken));
        if (!session) return;
        await repo.revokeSession(tx, session.id);
        await repo.audit(tx, { staffId: session.staffId, action: "staff.logout", ip: meta.ip, requestId: meta.requestId });
      });
    },
```

Add to `registerStaffRoutes` in `apps/api/src/modules/staff/routes.ts`:
```ts
  app.post("/admin/v1/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError("UNAUTHENTICATED", "Your admin session has ended. Please sign in again.");
    const session = await service.refresh(token, metaOf(req));
    setRefreshCookie(reply, session.refreshToken);
    return sendOk(reply, staffSessionResponseSchema, {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      staff: session.staff,
    });
  });

  app.post("/admin/v1/auth/logout", async (req, reply) => {
    await service.logout(req.cookies[REFRESH_COOKIE], metaOf(req));
    void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: true, sameSite: "strict" });
    return reply.status(204).send();
  });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project int apps/api/src/modules/staff`
Expected: PASS (10 tests across both staff files).

- [ ] **Step 5: Write the `create-admin` script**

`scripts/create-admin.ts`:
```ts
import { parseArgs } from "node:util";
import qrcode from "qrcode-terminal";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createStaffModule, createStaffTokens } from "../apps/api/src/modules/staff/index";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "admin" } },
});

if (!values.email || !values.name || (values.role !== "admin" && values.role !== "support")) {
  console.error('Usage: npm run create-admin -- --email you@mushin.pk --name "Your Name" [--role admin|support]');
  process.exit(1);
}

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-create-admin", caPem: config.databaseCaPem });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey });
  const acct = await staff.createStaffAccount({ email: values.email, name: values.name, role: values.role });
  console.log(`\nCreated ${values.role} ${values.email}`);
  console.log(`Temporary password (shown once): ${acct.password}`);
  console.log("\nScan this QR code with Google Authenticator, Microsoft Authenticator or 1Password:\n");
  qrcode.generate(acct.totpUri, { small: true });
  console.log(`If you cannot scan it, enter this key manually: ${acct.totpSecret}\n`);
} finally {
  await db.close();
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify` → pass. (Running `npm run create-admin` against the dev database happens in Task 18.)
```bash
git add -A
git commit -m "feat(staff): rotate refresh tokens with reuse detection, logout, and create-admin script"
```

---

### Task 15: Platform tables, outbox writer, provider-call sink and idempotency

**Files:**
- Create: `packages/db/migrations/0004_platform.sql`, `packages/db/src/schema/platform.ts`, `packages/db/src/outbox.ts`, `packages/db/src/provider-calls.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Create: `apps/api/src/modules/platform/repository.ts`, `apps/api/src/modules/platform/idempotency.ts`, `apps/api/src/modules/platform/index.ts`
- Modify: `apps/api/src/server.ts`
- Test: `packages/db/src/platform.int.test.ts`, `apps/api/src/modules/platform/idempotency.int.test.ts`

**Interfaces:**
- Produces (db):
  ```ts
  type OutboxEvent = { eventType: string; aggregateType: string; aggregateId: string; workspaceId: string | null; payload: Record<string, unknown>; requestId: string | null };
  writeOutbox(tx: TenantTx | SystemTx, e: OutboxEvent): Promise<string>     // returns event id
  type OutboxRow = OutboxEvent & { id: string; attempts: number };
  claimUnpublished(tx: SystemTx, limit: number): Promise<OutboxRow[]>       // FOR UPDATE SKIP LOCKED, attempts < 10
  markPublished(tx: SystemTx, id: string): Promise<void>
  markFailed(tx: SystemTx, id: string, error: string): Promise<void>
  createDbProviderCallSink(db: Db): ProviderCallSink
  ```
- Produces (api): `createPlatformModule(o: { db: Db; ttlHours: number }): { module: AppModule; requireIdempotencyKey: PreHandler }`; Fastify request augmentation `req.idempotency: { workspaceId: string; key: string } | null`.

- [ ] **Step 1: Write the migration**

`packages/db/migrations/0004_platform.sql`:
```sql
create table platform.outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  workspace_id uuid,
  payload jsonb not null default '{}'::jsonb,
  request_id text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index outbox_unpublished_idx on platform.outbox (created_at) where published_at is null;

create or replace function platform.notify_outbox() returns trigger
  language plpgsql as $$ begin perform pg_notify('mushin_outbox', ''); return null; end $$;
create trigger outbox_notify after insert on platform.outbox for each statement execute function platform.notify_outbox();

create table platform.provider_calls (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  model text,
  tokens_in int,
  tokens_out int,
  units numeric(14, 4),
  cost_usd numeric(12, 6) not null default 0,
  latency_ms int not null,
  status text not null check (status in ('ok', 'error')),
  error_code text,
  workspace_id uuid,
  job_id text,
  request_id text,
  created_at timestamptz not null default now()
);
create index provider_calls_provider_time_idx on platform.provider_calls (provider, created_at desc);

create table platform.idempotency_keys (
  workspace_id uuid not null,
  key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

grant insert on platform.outbox to mushin_app;
grant select, insert, update on platform.outbox to mushin_worker;
grant insert on platform.provider_calls to mushin_app, mushin_worker;
grant select, insert, update, delete on platform.idempotency_keys to mushin_worker;
```

- [ ] **Step 2: Write the Drizzle schema and db helpers**

`packages/db/src/schema/platform.ts`:
```ts
import { integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const outbox = platformSchema.table("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  workspaceId: uuid("workspace_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  requestId: text("request_id"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
});

export const providerCalls = platformSchema.table("provider_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  units: numeric("units", { precision: 14, scale: 4 }),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms").notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  errorCode: text("error_code"),
  workspaceId: uuid("workspace_id"),
  jobId: text("job_id"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const idempotencyKeys = platformSchema.table(
  "idempotency_keys",
  {
    workspaceId: uuid("workspace_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
```

`packages/db/src/schema/index.ts`:
```ts
import { users, workspaceMembers, workspaces } from "./identity";
import { idempotencyKeys, outbox, providerCalls } from "./platform";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./identity";
export * from "./platform";
export * from "./staff";

export const ALL_TABLES = [users, workspaces, workspaceMembers, staffUsers, staffSessions, auditLog, outbox, providerCalls, idempotencyKeys];
```

`packages/db/src/outbox.ts`:
```ts
import { eq, sql } from "drizzle-orm";
import type { SystemTx, TenantTx } from "./database";
import { outbox } from "./schema";

export type OutboxEvent = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  workspaceId: string | null;
  payload: Record<string, unknown>;
  requestId: string | null;
};
export type OutboxRow = OutboxEvent & { id: string; attempts: number };

export async function writeOutbox(tx: TenantTx | SystemTx, e: OutboxEvent): Promise<string> {
  const rows = await tx.insert(outbox).values(e).returning({ id: outbox.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("outbox insert returned no id");
  return id;
}

export async function claimUnpublished(tx: SystemTx, limit: number): Promise<OutboxRow[]> {
  return tx
    .select({
      id: outbox.id,
      eventType: outbox.eventType,
      aggregateType: outbox.aggregateType,
      aggregateId: outbox.aggregateId,
      workspaceId: outbox.workspaceId,
      payload: outbox.payload,
      requestId: outbox.requestId,
      attempts: outbox.attempts,
    })
    .from(outbox)
    .where(sql`${outbox.publishedAt} is null and ${outbox.attempts} < 10`)
    .orderBy(outbox.createdAt)
    .limit(limit)
    .for("update", { skipLocked: true });
}

export async function markPublished(tx: SystemTx, id: string): Promise<void> {
  await tx.update(outbox).set({ publishedAt: sql`now()` }).where(eq(outbox.id, id));
}

export async function markFailed(tx: SystemTx, id: string, error: string): Promise<void> {
  await tx
    .update(outbox)
    .set({ attempts: sql`${outbox.attempts} + 1`, lastError: error.slice(0, 1000) })
    .where(eq(outbox.id, id));
}
```

`packages/db/src/provider-calls.ts`:
```ts
import type { ProviderCallSink } from "@mushin/core";
import type { Db } from "./database";
import { providerCalls } from "./schema";

export function createDbProviderCallSink(db: Db): ProviderCallSink {
  return {
    async record(call) {
      await db.withSystem((tx) =>
        tx.insert(providerCalls).values({
          ...call,
          units: call.units === null ? null : String(call.units),
          costUsd: String(call.costUsd),
        }),
      );
    },
  };
}
```

`packages/db/src/index.ts`:
```ts
export * from "./database";
export * from "./schema";
export * from "./outbox";
export * from "./provider-calls";
export { migrate } from "./migrate";
```

- [ ] **Step 3: Write the db tests**

`packages/db/src/platform.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimUnpublished, markFailed, markPublished, writeOutbox } from "./outbox";
import { createDbProviderCallSink } from "./provider-calls";
import { createTestDatabase, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const event = (workspaceId: string) => ({
  eventType: "system.ping",
  aggregateType: "workspace",
  aggregateId: workspaceId,
  workspaceId,
  payload: { hello: "world" },
  requestId: "req-1",
});

describe("outbox", () => {
  it("is written from a tenant transaction and claimed by the worker role", async () => {
    const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
    const id = await db.withTenant(ctx, (tx) => writeOutbox(tx, event(ctx.workspaceId)));
    const claimed = await db.withSystem((tx) => claimUnpublished(tx, 10));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id, eventType: "system.ping", payload: { hello: "world" }, attempts: 0 });
    await db.withSystem((tx) => markPublished(tx, id));
    expect(await db.withSystem((tx) => claimUnpublished(tx, 10))).toEqual([]);
  });

  it("counts failures and stops retrying after 10 attempts", async () => {
    const id = await db.withSystem((tx) => writeOutbox(tx, event(randomUUID())));
    for (let i = 0; i < 10; i++) await db.withSystem((tx) => markFailed(tx, id, "no route"));
    expect(await db.withSystem((tx) => claimUnpublished(tx, 10))).toEqual([]);
    const rows = await ownerQuery<{ attempts: number; last_error: string }>(`select attempts, last_error from platform.outbox`);
    expect(rows[0]).toEqual({ attempts: 10, last_error: "no route" });
  });
});

describe("provider call sink", () => {
  it("persists calls with cost", async () => {
    await createDbProviderCallSink(db).record({
      provider: "groq",
      operation: "chat",
      model: "llama",
      tokensIn: 12,
      tokensOut: 3,
      units: null,
      costUsd: 0.000123,
      latencyMs: 250,
      status: "ok",
      errorCode: null,
      workspaceId: null,
      jobId: null,
      requestId: "r",
    });
    const rows = await ownerQuery<{ cost_usd: string }>(`select cost_usd from platform.provider_calls`);
    expect(rows[0]?.cost_usd).toBe("0.000123");
  });
});
```

- [ ] **Step 4: Write the idempotency tests**

`apps/api/src/modules/platform/idempotency.int.test.ts`:
```ts
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
```

- [ ] **Step 5: Run to confirm failure**

Run: `npx vitest run --project int packages/db/src/platform.int.test.ts apps/api/src/modules/platform`
Expected: FAIL, platform module not found (db tests may already pass once Step 2 code exists).

- [ ] **Step 6: Implement the platform module**

`apps/api/src/modules/platform/repository.ts`:
```ts
import { and, eq, sql } from "drizzle-orm";
import { idempotencyKeys, type SystemTx } from "@mushin/db";

export type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "mismatch" }
  | { kind: "in_progress" }
  | { kind: "replay"; status: number; body: unknown };

export async function claimKey(
  tx: SystemTx,
  k: { workspaceId: string; key: string; hash: string; ttlHours: number },
): Promise<ClaimOutcome> {
  const inserted = await tx.execute<{ key: string }>(sql`
    insert into platform.idempotency_keys (workspace_id, key, request_hash, expires_at)
    values (${k.workspaceId}, ${k.key}, ${k.hash}, now() + make_interval(hours => ${k.ttlHours}))
    on conflict (workspace_id, key) do update
      set request_hash = excluded.request_hash, response_status = null, response_body = null,
          expires_at = excluded.expires_at, created_at = now()
      where platform.idempotency_keys.expires_at < now()
    returning key`);
  if (inserted.length > 0) return { kind: "claimed" };

  const rows = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)))
    .limit(1);
  const row = rows[0];
  if (!row || row.requestHash !== k.hash) return { kind: "mismatch" };
  if (row.responseStatus === null) return { kind: "in_progress" };
  return { kind: "replay", status: row.responseStatus, body: row.responseBody };
}

export async function storeResponse(tx: SystemTx, k: { workspaceId: string; key: string; status: number; body: unknown }): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: k.status, responseBody: k.body })
    .where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)));
}

export async function releaseKey(tx: SystemTx, k: { workspaceId: string; key: string }): Promise<void> {
  await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.workspaceId, k.workspaceId), eq(idempotencyKeys.key, k.key)));
}
```

`apps/api/src/modules/platform/idempotency.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { AppError, sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { PreHandler } from "../../http/types";
import * as repo from "./repository";

declare module "fastify" {
  interface FastifyRequest {
    idempotency: { workspaceId: string; key: string } | null;
  }
}

const KEY = /^[A-Za-z0-9._:-]{8,200}$/;

export function createIdempotency(db: Db, ttlHours: number) {
  const requireIdempotencyKey: PreHandler = async (req, reply) => {
    const tenant = tenantOf(req);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key)) {
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key header is required (8-200 characters: letters, digits, . _ : -)");
    }
    const hash = sha256Hex(JSON.stringify({ method: req.method, route: req.routeOptions.url, body: req.body ?? null }));
    const outcome = await db.withSystem((tx) => repo.claimKey(tx, { workspaceId: tenant.workspaceId, key, hash, ttlHours }));
    if (outcome.kind === "mismatch") throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request");
    if (outcome.kind === "in_progress") throw new AppError("CONFLICT", "A request with this Idempotency-Key is still being processed");
    if (outcome.kind === "replay") {
      void reply.header("idempotent-replayed", "true");
      return reply.status(outcome.status).send(outcome.body);
    }
    req.idempotency = { workspaceId: tenant.workspaceId, key };
    return undefined;
  };

  function register(app: FastifyInstance) {
    app.decorateRequest("idempotency", null);
    app.addHook("onSend", async (req, reply, payload) => {
      const claim = req.idempotency;
      if (!claim) return payload;
      req.idempotency = null;
      if (reply.statusCode >= 500) {
        await db.withSystem((tx) => repo.releaseKey(tx, claim));
        return payload;
      }
      const body: unknown = typeof payload === "string" && payload.length > 0 ? JSON.parse(payload) : null;
      await db.withSystem((tx) => repo.storeResponse(tx, { ...claim, status: reply.statusCode, body }));
      return payload;
    });
  }

  return { requireIdempotencyKey, register };
}
```

`apps/api/src/modules/platform/index.ts`:
```ts
import type { Db } from "@mushin/db";
import type { AppModule, PreHandler } from "../../http/types";
import { createIdempotency } from "./idempotency";

export function createPlatformModule(o: { db: Db; ttlHours: number }): { module: AppModule; requireIdempotencyKey: PreHandler } {
  const idem = createIdempotency(o.db, o.ttlHours);
  return {
    module: { name: "platform", register: (app) => idem.register(app) },
    requireIdempotencyKey: idem.requireIdempotencyKey,
  };
}
```
**Ordering note:** the platform module must be registered **first** in `modules` so `decorateRequest("idempotency")` runs before any route uses it.

Update `apps/api/src/server.ts`: remove the `notYet` placeholder and its `AppError` import, then:
```ts
import { createPlatformModule } from "./modules/platform";
// …
const platform = createPlatformModule({ db, ttlHours: config.idempotencyTtlHours });
// in guards:
  idempotent: platform.requireIdempotencyKey,
// in buildApp:
  modules: [platform.module, identity.module, staff.module],
```

- [ ] **Step 7: Run the tests**

Run: `npm run test:int`
Expected: PASS (platform db 3 tests, idempotency 4 tests, drift test now includes 3 platform tables).

- [ ] **Step 8: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(platform): add outbox, provider-call sink and Idempotency-Key handling"
```

---

### Task 16: Worker (pg-boss queues, outbox relay, dispatcher, cron)

**Files:**
- Create: `apps/worker/src/queues.ts`, `apps/worker/src/dispatcher.ts`, `apps/worker/src/handlers.ts`, `apps/worker/src/relay.ts`, `apps/worker/src/boss.ts`, `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`
- Test: `apps/worker/src/queues.test.ts`, `apps/worker/src/worker.int.test.ts`

**Interfaces:**
- Consumes: `Db`, `claimUnpublished`, `markPublished`, `markFailed`, `writeOutbox` (db); `Logger`, `loadWorkerConfig` (core).
- Produces:
  ```ts
  QUEUES: readonly { name: QueueName; concurrency: number }[]; type QueueName; DEAD_LETTER_QUEUE = "dead-letter"; QUEUE_OPTIONS
  queueFor(eventType: string): QueueName
  type JobData = { eventId: string; eventType: string; aggregateType: string; aggregateId: string; workspaceId: string | null; requestId: string | null; payload: Record<string, unknown> }
  type Handler = (data: JobData, ctx: { logger: Logger; jobId: string }) => Promise<void>; type HandlerRegistry = Record<string, Handler>
  createDispatcher(handlers: HandlerRegistry, logger: Logger): (jobs: { id: string; data: JobData }[]) => Promise<void>
  type Publish = (queue: QueueName, data: JobData, id: string) => Promise<void>
  createOutboxRelay(o: { db: Db; publish: Publish; logger: Logger; batchSize?: number }): { drainOnce(): Promise<number>; start(): Promise<void>; stop(): Promise<void> }
  startBoss(url: string, logger: Logger, caPem: string | null): Promise<PgBoss>
  startWorker(o: { db: Db; boss: PgBoss; logger: Logger; handlers: HandlerRegistry }): Promise<{ stop(): Promise<void> }>
  defaultHandlers(db: Db): HandlerRegistry
  ```

- [ ] **Step 1: Add dependencies**

`apps/worker/package.json`:
```json
{
  "name": "@mushin/worker",
  "private": true,
  "type": "module",
  "dependencies": { "@mushin/core": "*", "@mushin/db": "*", "pg-boss": "^12.0.0" }
}
```
Run `npm install`.

- [ ] **Step 2: Write the failing unit test**

`apps/worker/src/queues.test.ts`:
```ts
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
```

- [ ] **Step 3: Implement routing and dispatch**

`apps/worker/src/queues.ts`:
```ts
export const DEAD_LETTER_QUEUE = "dead-letter";

export const QUEUES = [
  { name: "discovery-high", concurrency: 3 },
  { name: "discovery-standard", concurrency: 2 },
  { name: "rescore-low", concurrency: 5 },
  { name: "billing", concurrency: 1 },
  { name: "outreach", concurrency: 2 },
  { name: "erasure", concurrency: 1 },
  { name: "notify", concurrency: 5 },
  { name: "system", concurrency: 2 },
] as const;

export type QueueName = (typeof QUEUES)[number]["name"];

export const QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
  deadLetter: DEAD_LETTER_QUEUE,
} as const;

const ROUTES: ReadonlyArray<readonly [string, QueueName]> = [
  ["discovery.", "discovery-high"],
  ["refresh.", "discovery-standard"],
  ["creator.", "rescore-low"],
  ["billing.", "billing"],
  ["outreach.", "outreach"],
  ["erasure.", "erasure"],
  ["notify.", "notify"],
  ["system.", "system"],
];

export function queueFor(eventType: string): QueueName {
  const hit = ROUTES.find(([prefix]) => eventType.startsWith(prefix));
  if (!hit) throw new Error(`No queue route for event type "${eventType}"`);
  return hit[1];
}
```

`apps/worker/src/dispatcher.ts`:
```ts
import type { Logger } from "@mushin/core";

export type JobData = {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  workspaceId: string | null;
  requestId: string | null;
  payload: Record<string, unknown>;
};

export type Handler = (data: JobData, ctx: { logger: Logger; jobId: string }) => Promise<void>;
export type HandlerRegistry = Record<string, Handler>;

export function createDispatcher(handlers: HandlerRegistry, logger: Logger) {
  return async (jobs: { id: string; data: JobData }[]): Promise<void> => {
    for (const job of jobs) {
      const handler = handlers[job.data.eventType];
      if (!handler) throw new Error(`No handler for event type "${job.data.eventType}"`);
      const child = logger.child({ requestId: job.data.requestId, eventId: job.data.eventId, eventType: job.data.eventType, jobId: job.id });
      await handler(job.data, { logger: child, jobId: job.id });
    }
  };
}
```

Run: `npx vitest run --project unit apps/worker` → PASS (3 tests).

- [ ] **Step 4: Write the failing integration test**

`apps/worker/src/worker.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { writeOutbox } from "@mushin/db";
import { createTestDatabase, ownerQuery, resetTables, testCaPem, testDatabaseUrl } from "@mushin/db/testing";
import { startBoss } from "./boss";
import type { JobData } from "./dispatcher";
import { createOutboxRelay } from "./relay";
import { startWorker } from "./worker";

const logger = createLogger({ level: "silent" });
const db = createTestDatabase();
let boss: PgBoss;

beforeAll(async () => {
  boss = await startBoss(testDatabaseUrl(), logger, testCaPem());
});
beforeEach(resetTables);
afterAll(async () => {
  await boss.stop({ graceful: false, close: true });
  await db.close();
});

const ping = (requestId: string) => ({
  eventType: "system.ping",
  aggregateType: "test",
  aggregateId: randomUUID(),
  workspaceId: null,
  payload: { n: 1 },
  requestId,
});

async function waitFor(check: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("outbox relay", () => {
  it("publishes each event once, using the event id as the job id", async () => {
    const published: { queue: string; id: string }[] = [];
    const relay = createOutboxRelay({
      db,
      logger,
      publish: async (queue, _data, id) => {
        published.push({ queue, id });
      },
    });
    const id = await db.withSystem((tx) => writeOutbox(tx, ping("r1")));
    expect(await relay.drainOnce()).toBe(1);
    expect(await relay.drainOnce()).toBe(0);
    expect(published).toEqual([{ queue: "system", id }]);
    const rows = await ownerQuery<{ published: boolean }>(`select published_at is not null as published from platform.outbox`);
    expect(rows[0]?.published).toBe(true);
  });

  it("records a routing failure instead of publishing", async () => {
    const relay = createOutboxRelay({ db, logger, publish: async () => {} });
    await db.withSystem((tx) => writeOutbox(tx, { ...ping("r2"), eventType: "mystery.event" }));
    await relay.drainOnce();
    const rows = await ownerQuery<{ attempts: number; published: boolean }>(
      `select attempts, published_at is not null as published from platform.outbox`,
    );
    expect(rows[0]).toEqual({ attempts: 1, published: false });
  });
});

describe("worker end to end", () => {
  it("delivers an outbox event to its handler with the request id", async () => {
    const handled: JobData[] = [];
    const worker = await startWorker({
      db,
      boss,
      logger,
      handlers: { "system.ping": async (data) => void handled.push(data) },
    });
    try {
      const eventId = await db.withSystem((tx) => writeOutbox(tx, ping("req-e2e")));
      await waitFor(() => handled.length === 1);
      expect(handled[0]).toMatchObject({ eventId, eventType: "system.ping", requestId: "req-e2e", payload: { n: 1 } });
    } finally {
      await worker.stop();
    }
  });
});
```

- [ ] **Step 5: Implement the relay, boss and worker**

`apps/worker/src/relay.ts`:
```ts
import type { Logger } from "@mushin/core";
import { claimUnpublished, markFailed, markPublished, type Db, type OutboxRow } from "@mushin/db";
import type { JobData } from "./dispatcher";
import { queueFor, type QueueName } from "./queues";

export type Publish = (queue: QueueName, data: JobData, id: string) => Promise<void>;

const toJobData = (r: OutboxRow): JobData => ({
  eventId: r.id,
  eventType: r.eventType,
  aggregateType: r.aggregateType,
  aggregateId: r.aggregateId,
  workspaceId: r.workspaceId,
  requestId: r.requestId,
  payload: r.payload,
});

export function createOutboxRelay(o: { db: Db; publish: Publish; logger: Logger; batchSize?: number }) {
  const batchSize = o.batchSize ?? 50;
  let draining = false;
  let timer: NodeJS.Timeout | undefined;
  let unlisten: (() => Promise<void>) | undefined;

  async function drainOnce(): Promise<number> {
    if (draining) return 0;
    draining = true;
    try {
      return await o.db.withSystem(async (tx) => {
        const rows = await claimUnpublished(tx, batchSize);
        for (const row of rows) {
          try {
            await o.publish(queueFor(row.eventType), toJobData(row), row.id);
            await markPublished(tx, row.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await markFailed(tx, row.id, message);
            o.logger.error({ err, eventId: row.id, eventType: row.eventType }, "outbox publish failed");
          }
        }
        return rows.length;
      });
    } finally {
      draining = false;
    }
  }

  const tick = () => {
    drainOnce().catch((err: unknown) => o.logger.error({ err }, "outbox drain failed"));
  };

  return {
    drainOnce,
    async start() {
      unlisten = await o.db.listen("mushin_outbox", tick);
      timer = setInterval(tick, 1000);
      tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      await unlisten?.();
    },
  };
}
```

`apps/worker/src/boss.ts`:
```ts
import { PgBoss } from "pg-boss";
import type { Logger } from "@mushin/core";
import { tlsOptions } from "@mushin/db";
import { DEAD_LETTER_QUEUE, QUEUE_OPTIONS, QUEUES } from "./queues";

export async function startBoss(url: string, logger: Logger, caPem: string | null): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: url,
    schema: "pgboss",
    application_name: "mushin-worker",
    ssl: tlsOptions(caPem),
    max: 5,
  });
  boss.on("error", (err: unknown) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  if (!(await boss.getQueue(DEAD_LETTER_QUEUE))) await boss.createQueue(DEAD_LETTER_QUEUE);
  for (const q of QUEUES) {
    if (!(await boss.getQueue(q.name))) await boss.createQueue(q.name, { ...QUEUE_OPTIONS });
  }
  return boss;
}
```

`apps/worker/src/handlers.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import type { HandlerRegistry } from "./dispatcher";

export function defaultHandlers(db: Db): HandlerRegistry {
  return {
    "system.ping": async (data, { logger }) => {
      logger.info({ payload: data.payload }, "system.ping handled");
    },
    "system.purge_expired": async (_data, { logger }) => {
      const deleted = await db.withSystem((tx) =>
        tx.execute<{ n: number }>(sql`with d as (delete from platform.idempotency_keys where expires_at < now() returning 1) select count(*)::int as n from d`),
      );
      logger.info({ deleted: deleted[0]?.n ?? 0 }, "purged expired idempotency keys");
    },
  };
}
```

`apps/worker/src/worker.ts`:
```ts
import type { PgBoss } from "pg-boss";
import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import { createDispatcher, type HandlerRegistry, type JobData } from "./dispatcher";
import { QUEUES } from "./queues";
import { createOutboxRelay } from "./relay";

export async function startWorker(o: { db: Db; boss: PgBoss; logger: Logger; handlers: HandlerRegistry }) {
  const dispatch = createDispatcher(o.handlers, o.logger);
  for (const q of QUEUES) {
    await o.boss.work<JobData>(q.name, { localConcurrency: q.concurrency, batchSize: 1 }, async (jobs) => {
      await dispatch(jobs.map((j) => ({ id: j.id, data: j.data })));
    });
  }
  await o.boss.schedule("system", "15 3 * * *", {
    eventId: "cron-purge-expired",
    eventType: "system.purge_expired",
    aggregateType: "system",
    aggregateId: "purge",
    workspaceId: null,
    requestId: null,
    payload: {},
  });

  const relay = createOutboxRelay({
    db: o.db,
    logger: o.logger,
    publish: async (queue, data, id) => {
      await o.boss.send(queue, data, { id });
    },
  });
  await relay.start();

  return {
    async stop() {
      await relay.stop();
      for (const q of QUEUES) await o.boss.offWork(q.name);
    },
  };
}
```

`apps/worker/src/main.ts`:
```ts
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { startBoss } from "./boss";
import { defaultHandlers } from "./handlers";
import { startWorker } from "./worker";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "worker" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.directUrl, { max: 5, applicationName: "mushin-worker", caPem: config.databaseCaPem });
const boss = await startBoss(config.directUrl, logger, config.databaseCaPem);
const worker = await startWorker({ db, boss, logger, handlers: defaultHandlers(db) });
logger.info("worker started");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker shutting down");
  await worker.stop();
  await boss.stop({ graceful: true, close: true });
  await db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:int`
Expected: PASS (relay 2 tests, end-to-end 1 test). If pg-boss rejects an option name (it is v12; check `node_modules/pg-boss/dist/types.d.ts`), adjust to the installed type definitions and note it in the commit message.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(worker): add pg-boss queues, outbox relay with LISTEN/NOTIFY, dispatcher and nightly purge"
```

---

### Task 17: Frontend: real Supabase auth and the API client

**Files:**
- Modify: `frontend/package.json` (deps), `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/app/auth/AuthContext.tsx`, `frontend/src/app/App.tsx`, `frontend/src/app/components/auth/Login.tsx`, `frontend/src/app/components/auth/Signup.tsx`, `frontend/src/app/components/auth/ForgotPassword.tsx`, `frontend/src/app/components/dashboard/Topbar.tsx`, `frontend/src/app/components/landing/Navbar.tsx`
- Create: `frontend/src/app/lib/supabase.ts`, `frontend/src/app/api/http.ts`, `frontend/src/app/api/client.ts`
- Test: `frontend/src/app/api/http.test.ts` (runs in the root `unit` project)

**Interfaces:**
- Consumes: `GET /v1/me` (Task 12), `meResponseSchema`, `errorEnvelopeSchema` (contracts).
- Produces: `class ApiError(code, message, status, requestId)`; `readApiResponse(res, schema)`; `apiRequest(path, schema, init?)`; `useAuth()` returning `{ status: "loading" | "signedIn" | "signedOut"; user: AuthUser | null; login(email, password): Promise<void>; signup(name, email, password): Promise<{ needsConfirmation: boolean }>; logout(): Promise<void>; requestPasswordReset(email): Promise<void> }` with `AuthUser = { name; email; avatar; initials }` (same shape as before).

- [ ] **Step 1: Install frontend dependencies**

```bash
npm --prefix frontend install @supabase/supabase-js@^2 @tanstack/react-query@^5
```

- [ ] **Step 2: Write the failing test for response parsing**

`frontend/src/app/api/http.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, readApiResponse } from "./http";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("readApiResponse", () => {
  it("returns parsed data on success", async () => {
    expect(await readApiResponse(json(200, { n: 1 }), z.object({ n: z.number() }))).toEqual({ n: 1 });
  });

  it("throws ApiError from the error envelope", async () => {
    const res = json(402, { error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits", requestId: "r9" } });
    await expect(readApiResponse(res, z.object({}))).rejects.toMatchObject({
      name: "ApiError",
      code: "INSUFFICIENT_CREDITS",
      status: 402,
      requestId: "r9",
      message: "Not enough credits",
    });
  });

  it("handles non-envelope failures and unexpected success bodies", async () => {
    const proxyError = new Response("<html>Bad gateway</html>", { status: 502, headers: { "x-request-id": "r1" } });
    await expect(readApiResponse(proxyError, z.object({}))).rejects.toBeInstanceOf(ApiError);
    await expect(readApiResponse(json(200, { n: "x" }), z.object({ n: z.number() }))).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
```
Run: `npx vitest run --project unit frontend` → FAIL (module not found).

- [ ] **Step 3: Implement the HTTP helpers and client**

`frontend/src/app/api/http.ts`:
```ts
import { errorEnvelopeSchema, type ErrorCode } from "@mushin/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK",
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readApiResponse<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
  const text = await res.text();
  const body = text ? parseJson(text) : null;
  if (!res.ok) {
    const envelope = errorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      const e = envelope.data.error;
      throw new ApiError(e.code, e.message, res.status, e.requestId);
    }
    throw new ApiError("INTERNAL", `Unexpected server response (${res.status}). Please try again.`, res.status, res.headers.get("x-request-id"));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("INTERNAL", "Unexpected response from the server.", res.status, res.headers.get("x-request-id"));
  return parsed.data;
}
```

`frontend/src/app/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in the repo-root .env");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
```

`frontend/src/app/api/client.ts`:
```ts
import type { z } from "zod";
import { supabase } from "../lib/supabase";
import { ApiError, readApiResponse } from "./http";

export { ApiError };

export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<z.output<S>> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { accept: "application/json" };
  if (data.session) headers["authorization"] = `Bearer ${data.session.access_token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0, null);
  }
  return readApiResponse(res, schema);
}
```
Run: `npx vitest run --project unit frontend` → PASS (3 tests).

- [ ] **Step 4: Point Vite at the root `.env`, the API and the contracts package**

Replace `frontend/vite.config.ts` with (keeps the existing plugins and aliases):
```ts
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const apiPort = rootEnv.PORT || '4000'
  return {
    envDir: '..',
    plugins: [
      figmaAssetResolver(),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
        '@mushin/contracts': path.resolve(__dirname, '../packages/contracts/src/index.ts'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
```

- [ ] **Step 5: Provide React Query at the root**

`frontend/src/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./app/App.tsx";
import "./styles/index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
```

- [ ] **Step 6: Replace the mock AuthContext**

`frontend/src/app/auth/AuthContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema, type MeResponse } from "@mushin/contracts";
import { apiRequest } from "../api/client";
import { supabase } from "../lib/supabase";

export type AuthUser = { name: string; email: string; avatar: string; initials: string };
export type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .replace(/[^A-Z]/g, "") || "MU"
  );
}

function initialsAvatar(initials: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='#4f46e5'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Inter,Arial,sans-serif' font-size='24' fill='white'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function toAuthUser(session: Session, me: MeResponse | undefined): AuthUser {
  const email = me?.user.email ?? session.user.email ?? "";
  const metaName = session.user.user_metadata?.["full_name"];
  const name = me?.user.displayName ?? (typeof metaName === "string" && metaName ? metaName : email.split("@")[0] ?? "You");
  const initials = initialsOf(name);
  return { name, email, initials, avatar: me?.user.avatarUrl ?? initialsAvatar(initials) };
}

function messageOf(error: { message: string }): string {
  return error.message || "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) queryClient.removeQueries({ queryKey: ["me"] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const me = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => apiRequest("/v1/me", meResponseSchema),
    enabled: Boolean(session),
    staleTime: 60_000,
    retry: 1,
  });

  const status: AuthStatus =
    session === undefined ? "loading" : session === null ? "signedOut" : me.isPending ? "loading" : "signedIn";
  const user = session ? toAuthUser(session, me.data) : null;

  const value: AuthContextValue = {
    status,
    user,
    async login(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(messageOf(error));
    },
    async signup(name, email, password) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/#/dashboard` },
      });
      if (error) throw new Error(messageOf(error));
      return { needsConfirmation: !data.session };
    },
    async logout() {
      await supabase.auth.signOut();
      queryClient.clear();
    },
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/#/login` });
      if (error) throw new Error(messageOf(error));
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 7: Wire the screens**

`frontend/src/app/App.tsx`: in `Shell`, change `const { user } = useAuth();` to `const { user, status } = useAuth();` and the dashboard guard to:
```tsx
  useEffect(() => {
    if (route === "dashboard" && status === "signedOut") setRoute("login");
  }, [route, status, setRoute]);
```

`frontend/src/app/components/auth/Login.tsx`: replace the `submit` function and add error state:
```tsx
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setSubmitting(false);
    }
  };
```
and insert, immediately before `<StaggerItem index={3}>`:
```tsx
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
```

`frontend/src/app/components/auth/Signup.tsx`: replace `submit` and add state:
```tsx
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { needsConfirmation } = await signup(name, email, password);
      if (needsConfirmation) {
        setNotice(`We've sent a confirmation link to ${email}. Confirm your email, then sign in.`);
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
      setSubmitting(false);
    }
  };
```
and render, immediately before the submit button's `StaggerItem`:
```tsx
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-700">
            {notice}
          </p>
        )}
```

`frontend/src/app/components/auth/ForgotPassword.tsx`: add `import { useAuth } from "../../auth/AuthContext";`, then inside the component:
```tsx
  const { requestPasswordReset } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link. Please try again.");
    }
  };
```
and render `{error && <p role="alert" className="text-sm text-red-600">{error}</p>}` directly above the form's submit button.

`frontend/src/app/components/dashboard/Topbar.tsx` line ~122: change `logout();` to `void logout();`.
`frontend/src/app/components/landing/Navbar.tsx` line ~112: change `onClick={logout}` to `onClick={() => void logout()}`.

- [ ] **Step 8: Build the frontend**

Run: `npm --prefix frontend run build`
Expected: Vite build succeeds with no unresolved imports.

- [ ] **Step 9: Verify and commit**

Run: `npm run verify` → pass.
```bash
git add -A
git commit -m "feat(frontend): use Supabase auth and the MUSHIN API for signup, login, logout and profile"
```

---

### Task 18: End-to-end check, admin bootstrap and run instructions

**Files:**
- Create: `README.md` (repo root)
- Modify: `docs/00-requirements-analysis-and-questions.md` (no; leave), none else

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `README.md`**

````markdown
# MUSHIN 2.0

## Requirements
- Node 22.12+ (24 recommended)
- A filled-in `.env` at the repo root (see `.env.example`).

## Setup
```bash
npm install
npm --prefix frontend install
npm run env:secrets      # adds DATA_ENCRYPTION_KEY and STAFF_JWT_SECRET if missing
npm run db:migrate       # applies migrations using DIRECT_URL (session pooler, port 5432)
```

## Run everything
```bash
npm run dev              # API on :4000, worker, and the web app on :5173
```

## Create the first staff admin
```bash
npm run create-admin -- --email you@mushin.pk --name "Your Name"
```
Scan the printed QR code with an authenticator app. The temporary password is shown once.

## Checks
```bash
npm run verify           # lint + typecheck + module boundaries + all tests
npm run test:int         # database tests only (uses TEST_DATABASE_URL)
```
````

- [ ] **Step 2: Full verification**

Run: `npm run verify`
Expected: lint 0 problems, tsc clean, depcruise no violations, all unit and integration tests pass. Paste the test summary into the task report.

- [ ] **Step 3: Manual end-to-end (requires real `DATABASE_URL`/`DIRECT_URL`)**

1. `npm run db:migrate` → `already up to date` or the list of applied migrations.
2. `npm run dev` and open `http://localhost:5173`.
3. Sign up with a real email. If Supabase email confirmation is on, the "confirm your email" notice appears; confirm via the email link, then sign in.
4. After sign-in the dashboard opens and the top bar shows your name/initials.
5. Confirm the database rows (owner query in Supabase SQL editor): `select email, display_name from wp.users; select name from wp.workspaces;` → one row each for you.
6. Log out from the top-bar menu → you return to the landing page; reloading `#/dashboard` redirects to login.
7. `curl -s localhost:4000/health/ready` → `status: "ok"` (or `redis: "down"` if the Upstash database no longer exists; requests still work because the limiter fails open).
8. `npm run create-admin -- --email <your email> --name "<your name>"`, then test the staff API:
   `curl -s -X POST localhost:4000/admin/v1/auth/login -H 'content-type: application/json' -d '{"email":"<email>","password":"<temp password>"}'` → `{ "challengeToken": … }`.
   (The admin UI still uses its mock until sub-project 8.)

Record any step that could not run (for example missing pooler URLs) in the task report.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add setup and run instructions for the foundation"
```

---

## Deferred to later sub-projects (by design)

- Billing trial grant at provisioning → sub-project 2 adds `billing.startTrial` inside `resolveTenant`'s provisioning transaction.
- Admin UI wiring to the staff API, `mushin_admin` role, impersonation → sub-project 8.
- Password-change screen after a reset link, Settings → sub-project 7.
- Sentry wiring → when `SENTRY_DSN` is provided (spec §8.4).
````
