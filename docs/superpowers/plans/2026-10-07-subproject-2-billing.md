# Sub-project 2: Credits & Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace a real credit balance (trial, plans, top-ups), a reserve → commit/release credit engine with an append-only ledger, hosted checkout through a payment adapter (mock Paddle until sandbox keys exist), webhook-driven subscription state, scheduled billing jobs, and a real Billing screen and credit meter.

**Architecture:** The billing module (`apps/api/src/modules/billing`) is the only writer of credits. API routes call its service; the worker imports the same service through `index.ts` (as `scripts/create-admin.ts` does for staff) to apply payment webhooks and run cron jobs. Payment providers sit behind a `Payments` adapter in `packages/integrations`; mock and real Paddle produce identical, signed, Paddle-format webhooks, so the rest of the system cannot tell them apart.

**Tech Stack:** Node 24, TypeScript 5.9.3 strict, Fastify 5, Zod 4, Drizzle ORM 0.45 + postgres.js, pg-boss 12, @upstash/redis, Vitest 5, React 18 + @tanstack/react-query 5.

**Spec:** `docs/superpowers/specs/2026-10-07-billing-credits-design.md` (decisions D1–D16 are referenced below as `[D#]`). Umbrella spec: `docs/superpowers/specs/2026-10-06-mushin-backend-architecture-design.md`. Requirements: `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf`.

## Global Constraints

- Everything from sub-project 1's Global Constraints still applies (strict TypeScript, no `any`, module boundaries via `index.ts`, error envelope, `npm run verify` before each commit, commit messages end with the session's attribution lines).
- Money: integer minor units + ISO currency; plans/packs store a PKR **display** price and a USD **charge** price [D1]. Credits are integers.
- Credits are written **only** by `apps/api/src/modules/billing/repository.ts`. Ledger rows are never updated or deleted [D8, D9].
- Every credit operation runs inside one transaction holding `pg_advisory_xact_lock(hashtextextended('credits:' || workspace_id, 0))`.
- Subscription state changes only while applying payment-provider webhooks, except trial start and trial expiry (local) [D4].
- Customer-visible errors: `INSUFFICIENT_CREDITS` 402 `{ required, available }`; `ENTITLEMENT_REQUIRED` 403 `{ reason, lostAccess? }`; `CONFLICT` 409 for cost changes `{ confirmedCost, currentCost }`; `FORBIDDEN` 403 for Members buying [D16].
- Purchases and plan changes: Owner/Admin only, `Idempotency-Key` required.
- Webhooks: `POST /webhooks/paddle`, header `Paddle-Signature: ts=<unix>;h1=<hex HMAC-SHA256(secret, ts + ":" + rawBody)>`, 300-second tolerance; invalid → 401, nothing stored.
- Mock payments are refused when `NODE_ENV=production` (config error).
- Worker-side workspace writes use `db.withWorkspace(workspaceId, fn)` (role `mushin_worker`, workspace RLS context). The worker may **read** `wp.subscriptions`, `wp.credit_lots`, `wp.credit_reservations`, `wp.checkouts` across workspaces only to find due work (`SELECT`-only RLS policies for `mushin_worker`).
- Outbox event types: `billing.webhook_received` (billing queue); `notify.credits_low`, `notify.credits_very_low`, `notify.trial_ending`, `notify.trial_expired`, `notify.subscription_canceled`, `notify.payment_failed` (notify queue; handlers are no-ops until sub-project 7). Cron jobs are scheduled straight onto the `billing` queue as `billing.job` with `{ job }`.
- Seed values (provisional) exactly as spec §3.
- Frontend changes are wiring only, plus hiding the spend-caps section [D6].

## Review Focus

1. **Reservation created just before its lots are ended** (upgrade/cancel or expiry between reserve and commit): commit must still succeed from lots valid at reservation time, and nothing double-spends. → Task 5 test `commits from lots that were valid when reserved`.
2. **The same Paddle webhook delivered twice, or events arriving out of order** (old `subscription.updated` after a newer one): credits granted once, newer state never overwritten by older. → Task 9 tests `duplicate events grant once` and `ignores an older event`.
3. **A Member, or a trialing workspace, trying to buy** (Member → 403; trial top-up → `ENTITLEMENT_REQUIRED`), and **a canceled workspace with paid top-ups** spending only top-up credits. → Task 9 tests.
4. **A cost edited in config between "confirm" and "spend"**: nothing charged, `CONFLICT` with both costs. → Task 5 test `refuses a changed cost`.
5. **Forged, stale or unsigned webhooks** reaching `/webhooks/paddle`: 401, no `webhook_events` row, no outbox event. → Task 10 test `rejects forged and stale webhooks`.

Database tests (`*.int.test.ts`) need `TEST_DATABASE_URL`; until it is configured they are written and committed but reported as not yet run, exactly as in sub-project 1.

---

## File Map

```
packages/core/src/config.ts                payments + worker config (modified)
scripts/ensure-env-secrets.ts              adds MOCK_PADDLE_WEBHOOK_SECRET (modified)
packages/contracts/src/billing.ts          billing request/response schemas
packages/db/migrations/0005_billing.sql    config + wp billing tables, RLS, grants, seeds
packages/db/src/schema/billing.ts          Drizzle tables
packages/db/src/database.ts                + withWorkspace (modified)
packages/db/src/testing.ts                 keep config tables on reset, createTestWorkspace (modified)
packages/integrations/src/payments/
  types.ts        Payments interface, PaymentEvent, PriceRef, SubscriptionRef
  signature.ts    sign/verify Paddle-Signature
  paddle-events.ts parse Paddle webhook payloads into PaymentEvent
  mock.ts         MockPayments (+ event builders, delivery)
  paddle.ts       PaddlePayments (fetch, instrumented)
  index.ts        createPayments factory
apps/api/src/modules/billing/
  rules.ts        pure rules (allocation, meter, change classification, lost access, cursors, dates)
  repository.ts   all billing SQL
  engine.ts       credit engine (reserve/commit/release/grant/expire/reconcile/trial)
  access-cache.ts entitlement/access cache (Redis, memory, none)
  service.ts      summary, plans, ledger, invoices, checkout, plan change, cancel, webhooks, jobs
  routes.ts       /v1/billing/*, /webhooks/paddle
  mock-routes.ts  /mock-paddle/* (mock mode only)
  index.ts        createBillingService, createBillingModule
apps/api/src/modules/identity/{index,service}.ts   provisioning starts the trial (modified)
apps/api/src/rate-limit/plugin.ts                  exempt /webhooks/ (modified)
apps/api/src/server.ts                              wiring (modified)
apps/worker/src/{billing-handlers,schedules}.ts, worker.ts, main.ts, queues.test.ts (modified)
frontend/src/app/api/billing.ts            React Query hooks
frontend/src/app/lib/credits.ts            balance from the API (modified)
frontend/src/app/components/dashboard/{Billing,Topbar,Overview,Dashboard,BillingStatusBanner}.tsx
```

---

### Task 1: Configuration for payments and the worker

**Files:**
- Modify: `packages/core/src/config.ts` (full replacement below), `packages/core/src/config.test.ts`, `scripts/ensure-env-secrets.ts`, `.env.example`, `.env` (local only)

**Interfaces:**
- Produces:
  ```ts
  type PaymentsConfig =
    | { mode: "mock"; webhookSecret: string; appUrl: string; publicApiUrl: string }
    | { mode: "paddle"; apiKey: string; clientToken: string; webhookSecret: string; environment: "sandbox" | "production"; appUrl: string; publicApiUrl: string };
  ApiConfig: + appUrl: string; + payments: PaymentsConfig   (rateLimit.upstash unchanged)
  WorkerConfig: { nodeEnv; logLevel; directUrl; databaseCaPem; appUrl: string; payments: PaymentsConfig; upstash: { url: string; token: string } | null }
  ```

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/config.test.ts`, add `MOCK_PADDLE_WEBHOOK_SECRET: MOCK` to the `valid` object (declare `const MOCK = "m".repeat(40);` above it), change the worker test's call to `loadWorkerConfig({ DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres", MOCK_PADDLE_WEBHOOK_SECRET: MOCK })`, and append:

```ts
function caFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "mushin-ca-"));
  const file = join(dir, "ca.crt");
  writeFileSync(file, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
  return file;
}

describe("payments config", () => {
  it("uses the mock provider when no Paddle keys are set", () => {
    expect(loadApiConfig(valid).payments).toEqual({
      mode: "mock",
      webhookSecret: MOCK,
      appUrl: "http://localhost:5173",
      publicApiUrl: "http://localhost:4000",
    });
  });

  it("uses Paddle when all three keys are set", () => {
    const c = loadApiConfig({ ...valid, PADDLE_API_KEY: "k", PADDLE_CLIENT_TOKEN: "t", PADDLE_WEBHOOK_SECRET: "s", PADDLE_ENVIRONMENT: "sandbox" });
    expect(c.payments).toMatchObject({ mode: "paddle", apiKey: "k", clientToken: "t", webhookSecret: "s", environment: "sandbox" });
  });

  it("rejects partial Paddle keys and a missing mock secret", () => {
    expect(() => loadApiConfig({ ...valid, PADDLE_API_KEY: "k" })).toThrow(/PADDLE_CLIENT_TOKEN/);
    expect(() => loadApiConfig({ ...valid, MOCK_PADDLE_WEBHOOK_SECRET: undefined })).toThrow(/MOCK_PADDLE_WEBHOOK_SECRET/);
  });

  it("refuses the mock provider in production", () => {
    expect(() => loadApiConfig({ ...valid, NODE_ENV: "production", DATABASE_SSL_CA_FILE: caFile() })).toThrow(/PADDLE_API_KEY/);
  });

  it("gives the worker payments and Upstash settings", () => {
    const c = loadWorkerConfig({
      DIRECT_URL: "postgresql://u:p@pooler.example.com:5432/postgres",
      MOCK_PADDLE_WEBHOOK_SECRET: MOCK,
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(c.payments.mode).toBe("mock");
    expect(c.upstash).toEqual({ url: "https://x.upstash.io", token: "t" });
    expect(c.appUrl).toBe("http://localhost:5173");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/core/src/config.test.ts`
Expected: FAIL (`payments` is undefined; worker config has no `upstash`).

- [ ] **Step 3: Replace `packages/core/src/config.ts`**

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

/** Settings both the API and the worker need. */
const sharedObject = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  APP_URL: z.url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.url().default("http://localhost:4000"),
  DATABASE_SSL_CA_FILE: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_CLIENT_TOKEN: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MOCK_PADDLE_WEBHOOK_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
});
type SharedValues = z.output<typeof sharedObject>;

const PADDLE_KEYS = ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET"] as const;

function checkShared(v: SharedValues, ctx: z.RefinementCtx) {
  if (v.NODE_ENV === "production" && !v.DATABASE_SSL_CA_FILE) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_SSL_CA_FILE"], message: "is required in production so database TLS certificates are verified" });
  }
  if (Boolean(v.UPSTASH_REDIS_REST_URL) !== Boolean(v.UPSTASH_REDIS_REST_TOKEN)) {
    const missing = v.UPSTASH_REDIS_REST_URL ? "UPSTASH_REDIS_REST_TOKEN" : "UPSTASH_REDIS_REST_URL";
    ctx.addIssue({ code: "custom", path: [missing], message: "set both Upstash values or neither" });
  }
  const missingPaddle = PADDLE_KEYS.filter((key) => !v[key]);
  if (missingPaddle.length > 0 && missingPaddle.length < PADDLE_KEYS.length) {
    for (const key of missingPaddle) {
      ctx.addIssue({ code: "custom", path: [key], message: "set all three Paddle values (PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_WEBHOOK_SECRET) or none" });
    }
  }
  if (missingPaddle.length === PADDLE_KEYS.length) {
    if (v.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["PADDLE_API_KEY"], message: "is required in production: the mock payment provider is for development only" });
    } else if (!v.MOCK_PADDLE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["MOCK_PADDLE_WEBHOOK_SECRET"], message: "is required while Paddle keys are not set (run npm run env:secrets)" });
    }
  }
}

const apiSchema = sharedObject
  .extend({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    ALLOWED_PREVIEW_ORIGINS: z.string().default(""),
    DATABASE_URL: postgresUrl,
    SUPABASE_URL: z.url(),
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1).default("authenticated"),
    JWKS_URI: z.url(),
    STAFF_JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded"),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  })
  .superRefine(checkShared);

const workerSchema = sharedObject.extend({ DIRECT_URL: postgresUrl }).superRefine(checkShared);

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

export type PaymentsConfig =
  | { mode: "mock"; webhookSecret: string; appUrl: string; publicApiUrl: string }
  | {
      mode: "paddle";
      apiKey: string;
      clientToken: string;
      webhookSecret: string;
      environment: "sandbox" | "production";
      appUrl: string;
      publicApiUrl: string;
    };

function paymentsFrom(v: SharedValues): PaymentsConfig {
  const appUrl = new URL(v.APP_URL).origin;
  const publicApiUrl = v.PUBLIC_API_URL.replace(/\/+$/, "");
  if (v.PADDLE_API_KEY && v.PADDLE_CLIENT_TOKEN && v.PADDLE_WEBHOOK_SECRET) {
    return {
      mode: "paddle",
      apiKey: v.PADDLE_API_KEY,
      clientToken: v.PADDLE_CLIENT_TOKEN,
      webhookSecret: v.PADDLE_WEBHOOK_SECRET,
      environment: v.PADDLE_ENVIRONMENT,
      appUrl,
      publicApiUrl,
    };
  }
  // checkShared guarantees the mock secret outside production.
  return { mode: "mock", webhookSecret: v.MOCK_PADDLE_WEBHOOK_SECRET ?? "", appUrl, publicApiUrl };
}

function upstashFrom(v: SharedValues): { url: string; token: string } | null {
  return v.UPSTASH_REDIS_REST_URL && v.UPSTASH_REDIS_REST_TOKEN ? { url: v.UPSTASH_REDIS_REST_URL, token: v.UPSTASH_REDIS_REST_TOKEN } : null;
}

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: LogLevel;
  port: number;
  appUrl: string;
  allowedOrigins: string[];
  databaseUrl: string;
  auth: { issuer: string; audience: string; jwksUri: string };
  staffJwtSecret: string;
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; upstash: { url: string; token: string } | null };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
  payments: PaymentsConfig;
};

export function loadApiConfig(env: Env): ApiConfig {
  const v = parse(apiSchema, env);
  const previews = v.ALLOWED_PREVIEW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const appUrl = new URL(v.APP_URL).origin;
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    port: v.PORT,
    appUrl,
    allowedOrigins: [appUrl, ...previews],
    databaseUrl: v.DATABASE_URL,
    auth: { issuer: v.JWT_ISSUER, audience: v.JWT_AUDIENCE, jwksUri: v.JWKS_URI },
    staffJwtSecret: v.STAFF_JWT_SECRET,
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: { windowMs: v.RATE_LIMIT_WINDOW_MS, maxRequests: v.RATE_LIMIT_MAX_REQUESTS, upstash: upstashFrom(v) },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    payments: paymentsFrom(v),
  };
}

export type WorkerConfig = {
  nodeEnv: ApiConfig["nodeEnv"];
  logLevel: LogLevel;
  directUrl: string;
  databaseCaPem: string | null;
  appUrl: string;
  payments: PaymentsConfig;
  upstash: { url: string; token: string } | null;
};

export function loadWorkerConfig(env: Env): WorkerConfig {
  const v = parse(workerSchema, env);
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    directUrl: v.DIRECT_URL,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    appUrl: new URL(v.APP_URL).origin,
    payments: paymentsFrom(v),
    upstash: upstashFrom(v),
  };
}
```

- [ ] **Step 4: Add the mock webhook secret to the secrets script and `.env.example`**

In `scripts/ensure-env-secrets.ts`, after the `STAFF_JWT_SECRET` line add:
```ts
ensure("MOCK_PADDLE_WEBHOOK_SECRET", randomBytes(32).toString("base64url"));
```
Append to `.env.example` (names only): `PADDLE_CLIENT_TOKEN=`, `MOCK_PADDLE_WEBHOOK_SECRET=`, `PUBLIC_API_URL=`.
Run `npm run env:secrets` → expected `Added to .env: MOCK_PADDLE_WEBHOOK_SECRET`. (`.env` is never committed.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit packages/core`
Expected: PASS (all config tests, including the 5 new ones).

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass. Confirm `git status --short` does not list `.env`.
```bash
git add packages/core scripts/ensure-env-secrets.ts .env.example
git commit -m "feat(core): add payments and worker billing configuration"
```

---

### Task 2: Billing contracts

**Files:**
- Create: `packages/contracts/src/billing.ts`, `packages/contracts/src/billing.test.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./billing";`)

**Interfaces:**
- Produces (all exported from `@mushin/contracts`): `creditActionSchema`/`CreditAction`, `planIdSchema`/`PlanId`, `billingIntervalSchema`/`BillingInterval`, `subscriptionStatusSchema`/`SubscriptionStatus`, `meterStateSchema`/`MeterState`, `lostAccessItemSchema`/`LostAccessItem`, `entitlementsSchema`/`Entitlements`, `moneySchema`, `billingSummarySchema`/`BillingSummary`, `billingPlansSchema`/`BillingPlans`, `ledgerKindSchema`, `ledgerEntrySchema`, `ledgerPageSchema`/`LedgerPage`, `ledgerQuerySchema`, `invoicesResponseSchema`/`InvoicesResponse`, `checkoutRequestSchema`/`CheckoutRequest`, `checkoutResponseSchema`, `planChangeRequestSchema`/`PlanChangeRequest`, `planChangeResponseSchema`/`PlanChangeResponse`.

- [ ] **Step 1: Write the failing test** — `packages/contracts/src/billing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { billingSummarySchema, checkoutRequestSchema, ledgerQuerySchema, planChangeRequestSchema } from "./index";

describe("billing contracts", () => {
  it("accepts a subscription or a top-up checkout and nothing in between", () => {
    expect(checkoutRequestSchema.safeParse({ kind: "subscription", planId: "growth", interval: "month" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ kind: "topup", packId: "credits_1000" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ kind: "topup", planId: "growth" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ kind: "subscription", planId: "platinum", interval: "month" }).success).toBe(false);
  });

  it("bounds the ledger page size", () => {
    expect(ledgerQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(ledgerQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("describes the summary, including a workspace with no plan", () => {
    const ok = billingSummarySchema.safeParse({
      plan: null,
      interval: null,
      status: "expired",
      currentPeriodEnd: null,
      trialEndsAt: "2026-10-21T00:00:00.000Z",
      trialDaysLeft: 0,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
      balance: { available: 0, reserved: 0, base: 1000, meter: "red" },
      canPurchase: true,
      lostAccess: ["find_new", "reveal_contact", "refresh_data", "monthly_credits", "outreach", "audience_details", "export"],
    });
    expect(ok.success).toBe(true);
    expect(planChangeRequestSchema.safeParse({ planId: "scale", interval: "year" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/contracts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement `packages/contracts/src/billing.ts`**

```ts
import { z } from "zod";

export const creditActionSchema = z.enum(["search_existing", "find_new", "reveal_contact", "refresh_data"]);
export type CreditAction = z.infer<typeof creditActionSchema>;

export const planIdSchema = z.enum(["explorer", "growth", "scale"]);
export type PlanId = z.infer<typeof planIdSchema>;

export const billingIntervalSchema = z.enum(["month", "year"]);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const subscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "canceled", "expired"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const meterStateSchema = z.enum(["normal", "amber", "red"]);
export type MeterState = z.infer<typeof meterStateSchema>;

export const lostAccessItemSchema = z.enum([
  "find_new",
  "reveal_contact",
  "refresh_data",
  "monthly_credits",
  "outreach",
  "audience_details",
  "export",
]);
export type LostAccessItem = z.infer<typeof lostAccessItemSchema>;

export const entitlementsSchema = z.object({
  audienceViewsPerMonth: z.number().int().nonnegative().nullable(),
  outreachEmailsPerMonth: z.number().int().nonnegative().nullable(),
  campaignLimit: z.number().int().nonnegative().nullable(),
  export: z.boolean(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const moneySchema = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });

export const billingSummarySchema = z.object({
  plan: z.object({ id: planIdSchema, name: z.string(), monthlyCredits: z.number().int().positive() }).nullable(),
  interval: billingIntervalSchema.nullable(),
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.iso.datetime().nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
  trialDaysLeft: z.number().int().nonnegative().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  scheduledChange: z.object({ planId: planIdSchema, interval: billingIntervalSchema }).nullable(),
  balance: z.object({
    available: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    base: z.number().int().nonnegative(),
    meter: meterStateSchema,
  }),
  canPurchase: z.boolean(),
  lostAccess: z.array(lostAccessItemSchema),
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;

export const billingPlansSchema = z.object({
  plans: z.array(
    z.object({
      id: planIdSchema,
      name: z.string(),
      monthlyCredits: z.number().int().positive(),
      display: z.object({ monthly: moneySchema, yearlyPerMonth: moneySchema }),
      charge: z.object({ monthly: moneySchema, yearly: moneySchema }),
      entitlements: entitlementsSchema,
    }),
  ),
  topupPacks: z.array(
    z.object({
      id: z.string(),
      credits: z.number().int().positive(),
      display: moneySchema,
      charge: moneySchema,
      validityMonths: z.number().int().positive(),
    }),
  ),
  actionCosts: z.record(creditActionSchema, z.number().int().nonnegative()),
});
export type BillingPlans = z.infer<typeof billingPlansSchema>;

export const ledgerKindSchema = z.enum(["grant", "spend", "refund", "expire", "adjust", "reserve", "release"]);
export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  kind: ledgerKindSchema,
  amount: z.number().int(),
  action: creditActionSchema.nullable(),
  lotSource: z.enum(["trial", "monthly", "topup", "adjustment"]).nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const ledgerPageSchema = z.object({ entries: z.array(ledgerEntrySchema), nextCursor: z.string().nullable() });
export type LedgerPage = z.infer<typeof ledgerPageSchema>;
export const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const invoicesResponseSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["subscription", "topup"]),
      amount: moneySchema,
      status: z.string(),
      invoiceUrl: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type InvoicesResponse = z.infer<typeof invoicesResponseSchema>;

export const checkoutRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), planId: planIdSchema, interval: billingIntervalSchema }),
  z.object({ kind: z.literal("topup"), packId: z.string().min(1).max(50) }),
]);
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export const checkoutResponseSchema = z.object({ checkoutId: z.uuid(), url: z.url() });

export const planChangeRequestSchema = z.object({ planId: planIdSchema, interval: billingIntervalSchema });
export type PlanChangeRequest = z.infer<typeof planChangeRequestSchema>;
export const planChangeResponseSchema = z.object({
  change: z.enum(["upgrade", "downgrade", "cancel"]),
  effective: z.enum(["now", "period_end"]),
});
export type PlanChangeResponse = z.infer<typeof planChangeResponseSchema>;
```

Add `export * from "./billing";` to `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit packages/contracts`
Expected: PASS (7 tests: 4 existing + 3 new).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add packages/contracts
git commit -m "feat(contracts): add billing schemas"
```

---

### Task 3: Billing tables, seeds, grants and `withWorkspace`

**Files:**
- Create: `packages/db/migrations/0005_billing.sql`, `packages/db/src/schema/billing.ts`, `packages/db/src/billing-schema.int.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/database.ts`, `packages/db/src/testing.ts`

**Interfaces:**
- Produces (from `@mushin/db`): Drizzle tables `plans`, `topupPacks`, `creditActionCosts`, `billingSettings`, `subscriptions`, `creditLots`, `creditReservations`, `creditLedger`, `entitlementUsage`, `checkouts`, `billingPayments`, `webhookEvents`; `Db.withWorkspace<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>` (role `mushin_worker`, workspace context, no user).
- Produces (from `@mushin/db/testing`): `createTestWorkspace(): Promise<{ userId: string; workspaceId: string }>`; `resetTables()` now keeps `platform.plans`, `platform.topup_packs`, `platform.credit_action_costs`, `platform.billing_settings`.

- [ ] **Step 1: Write the migration** — `packages/db/migrations/0005_billing.sql`

```sql
-- Sub-project 2: credits & billing. Spec: docs/superpowers/specs/2026-10-07-billing-credits-design.md §3-§4.

-- ── Config (global, editable without a deploy) ─────────────────────────────
create table platform.plans (
  id text primary key check (id in ('explorer', 'growth', 'scale')),
  name text not null,
  monthly_credits integer not null check (monthly_credits > 0),
  display_currency char(3) not null default 'PKR',
  display_monthly_minor bigint not null check (display_monthly_minor >= 0),
  display_yearly_monthly_minor bigint not null check (display_yearly_monthly_minor >= 0),
  charge_currency char(3) not null default 'USD',
  charge_monthly_minor bigint not null check (charge_monthly_minor >= 0),
  charge_yearly_minor bigint not null check (charge_yearly_minor >= 0),
  entitlements jsonb not null,
  paddle_price_ids jsonb not null,
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.topup_packs (
  id text primary key,
  credits integer not null check (credits > 0),
  display_currency char(3) not null default 'PKR',
  display_price_minor bigint not null check (display_price_minor >= 0),
  charge_currency char(3) not null default 'USD',
  charge_price_minor bigint not null check (charge_price_minor >= 0),
  validity_months integer not null default 12 check (validity_months > 0),
  paddle_price_id text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.credit_action_costs (
  action text primary key check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  credits integer not null check (credits >= 0),
  updated_at timestamptz not null default now()
);

create table platform.billing_settings (
  id boolean primary key default true check (id),
  trial_days integer not null check (trial_days > 0),
  trial_credits integer not null check (trial_credits > 0),
  trial_plan_id text not null references platform.plans (id),
  reservation_ttl_minutes integer not null check (reservation_ttl_minutes > 0),
  meter_amber_pct integer not null check (meter_amber_pct between 0 and 100),
  meter_red_pct integer not null check (meter_red_pct between 0 and 100),
  trial_ending_notice_days integer not null check (trial_ending_notice_days >= 0),
  updated_at timestamptz not null default now()
);

create table platform.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, provider_event_id)
);

-- Provisional seed values (spec §3). Mock price ids are replaced with Paddle sandbox ids when keys exist.
insert into platform.plans
  (id, name, monthly_credits, display_monthly_minor, display_yearly_monthly_minor, charge_monthly_minor, charge_yearly_minor, entitlements, paddle_price_ids, sort_order)
values
  ('explorer', 'Explorer', 2500, 490000, 390000, 1800, 16800,
   '{"audienceViewsPerMonth": 5, "outreachEmailsPerMonth": 0, "campaignLimit": 3, "export": false}',
   '{"month": "pri_mock_explorer_month", "year": "pri_mock_explorer_year"}', 1),
  ('growth', 'Growth', 12000, 1290000, 1090000, 4600, 46800,
   '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 500, "campaignLimit": null, "export": false}',
   '{"month": "pri_mock_growth_month", "year": "pri_mock_growth_year"}', 2),
  ('scale', 'Scale', 35000, 2490000, 1990000, 8900, 85200,
   '{"audienceViewsPerMonth": null, "outreachEmailsPerMonth": 2000, "campaignLimit": null, "export": true}',
   '{"month": "pri_mock_scale_month", "year": "pri_mock_scale_year"}', 3);

insert into platform.topup_packs (id, credits, display_price_minor, charge_price_minor, validity_months, paddle_price_id) values
  ('credits_1000', 1000, 250000, 900, 12, 'pri_mock_credits_1000'),
  ('credits_5000', 5000, 990000, 3500, 12, 'pri_mock_credits_5000'),
  ('credits_15000', 15000, 2490000, 8900, 12, 'pri_mock_credits_15000');

insert into platform.credit_action_costs (action, credits) values
  ('search_existing', 0), ('find_new', 12), ('reveal_contact', 5), ('refresh_data', 10);

insert into platform.billing_settings
  (trial_days, trial_credits, trial_plan_id, reservation_ttl_minutes, meter_amber_pct, meter_red_pct, trial_ending_notice_days)
values (14, 200, 'explorer', 15, 20, 5, 3);

-- ── Workspace state ─────────────────────────────────────────────────────────
create table wp.subscriptions (
  workspace_id uuid primary key references wp.workspaces (id) on delete cascade,
  plan_id text references platform.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  trial_ending_notified_at timestamptz,
  next_credit_grant_at timestamptz,
  paddle_subscription_id text unique,
  paddle_customer_id text,
  cancel_at_period_end boolean not null default false,
  scheduled_plan_id text references platform.plans (id),
  scheduled_interval text check (scheduled_interval in ('month', 'year')),
  provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scheduled_plan_id is null) = (scheduled_interval is null))
);

create table wp.checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  kind text not null check (kind in ('subscription', 'topup')),
  plan_id text references platform.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  topup_pack_id text references platform.topup_packs (id),
  price_id text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  status text not null default 'open' check (status in ('open', 'paid', 'failed', 'expired')),
  provider_checkout_id text,
  hosted_url text,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'subscription' and plan_id is not null and billing_interval is not null and topup_pack_id is null)
    or (kind = 'topup' and topup_pack_id is not null and plan_id is null and billing_interval is null)
  )
);
create index checkouts_workspace_idx on wp.checkouts (workspace_id, created_at desc);

create table wp.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  paddle_transaction_id text not null unique,
  kind text not null check (kind in ('subscription', 'topup')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  status text not null,
  invoice_url text,
  checkout_id uuid references wp.checkouts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_workspace_idx on wp.payments (workspace_id, created_at desc);

create table wp.credit_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  source text not null check (source in ('trial', 'monthly', 'topup', 'adjustment')),
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining >= 0 and remaining <= amount),
  expires_at timestamptz not null,
  payment_id uuid references wp.payments (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_lots_spendable_idx on wp.credit_lots (workspace_id, expires_at) where remaining > 0;

create table wp.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  amount integer not null check (amount > 0),
  action text not null check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  confirmed_cost integer not null check (confirmed_cost >= 0),
  status text not null check (status in ('held', 'committed', 'released', 'expired')),
  expires_at timestamptz not null,
  ref_type text not null,
  ref_id text not null,
  committed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_reservations_held_idx on wp.credit_reservations (workspace_id, expires_at) where status = 'held';

-- Append-only: no UPDATE/DELETE grants to any role.
create table wp.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('grant', 'spend', 'refund', 'expire', 'adjust', 'reserve', 'release')),
  action text check (action in ('search_existing', 'find_new', 'reveal_contact', 'refresh_data')),
  lot_id uuid references wp.credit_lots (id),
  reservation_id uuid references wp.credit_reservations (id),
  source_ref text,
  actor_user_id uuid,
  actor_staff_id uuid,
  note text,
  created_at timestamptz not null default now(),
  check (kind not in ('reserve', 'release') or lot_id is null),
  check (kind not in ('grant', 'spend', 'expire') or lot_id is not null)
);
create index credit_ledger_history_idx on wp.credit_ledger (workspace_id, created_at desc, id desc);
create index credit_ledger_lot_idx on wp.credit_ledger (lot_id) where lot_id is not null;
create unique index credit_ledger_source_ref_key on wp.credit_ledger (workspace_id, kind, source_ref) where source_ref is not null;

create table wp.entitlement_usage (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  key text not null check (key in ('audience_views', 'outreach_emails')),
  period_start date not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key, period_start)
);

-- updated_at triggers
create trigger plans_updated_at before update on platform.plans for each row execute function platform.set_updated_at();
create trigger topup_packs_updated_at before update on platform.topup_packs for each row execute function platform.set_updated_at();
create trigger credit_action_costs_updated_at before update on platform.credit_action_costs for each row execute function platform.set_updated_at();
create trigger billing_settings_updated_at before update on platform.billing_settings for each row execute function platform.set_updated_at();
create trigger subscriptions_updated_at before update on wp.subscriptions for each row execute function platform.set_updated_at();
create trigger checkouts_updated_at before update on wp.checkouts for each row execute function platform.set_updated_at();
create trigger payments_updated_at before update on wp.payments for each row execute function platform.set_updated_at();
create trigger credit_lots_updated_at before update on wp.credit_lots for each row execute function platform.set_updated_at();
create trigger credit_reservations_updated_at before update on wp.credit_reservations for each row execute function platform.set_updated_at();
create trigger entitlement_usage_updated_at before update on wp.entitlement_usage for each row execute function platform.set_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'checkouts', 'payments', 'credit_lots', 'credit_reservations', 'credit_ledger', 'entitlement_usage']
  loop
    execute format('alter table wp.%I enable row level security', t);
    execute format('alter table wp.%I force row level security', t);
    execute format(
      'create policy %I on wp.%I using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id())',
      t || '_tenant', t);
  end loop;
  -- The worker may find due work across workspaces (read-only); every write still needs workspace context.
  foreach t in array array['subscriptions', 'checkouts', 'credit_lots', 'credit_reservations']
  loop
    execute format('create policy %I on wp.%I for select to mushin_worker using (true)', t || '_worker_scan', t);
  end loop;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select on platform.plans, platform.topup_packs, platform.credit_action_costs, platform.billing_settings to mushin_app, mushin_worker;
grant select, insert, update on wp.subscriptions, wp.checkouts, wp.credit_lots, wp.credit_reservations, wp.entitlement_usage to mushin_app, mushin_worker;
grant select on wp.payments to mushin_app;
grant select, insert, update on wp.payments to mushin_worker;
grant select, insert on wp.credit_ledger to mushin_app, mushin_worker;
grant select, insert, update on platform.webhook_events to mushin_worker;
```

- [ ] **Step 2: Write the Drizzle schema** — `packages/db/src/schema/billing.ts`

```ts
import { sql } from "drizzle-orm";
import { bigint, boolean, char, date, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const platform = pgSchema("platform");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });

export type PlanEntitlements = {
  audienceViewsPerMonth: number | null;
  outreachEmailsPerMonth: number | null;
  campaignLimit: number | null;
  export: boolean;
};

export const plans = platform.table("plans", {
  id: text("id", { enum: ["explorer", "growth", "scale"] }).primaryKey(),
  name: text("name").notNull(),
  monthlyCredits: integer("monthly_credits").notNull(),
  displayCurrency: char("display_currency", { length: 3 }).notNull().default("PKR"),
  displayMonthlyMinor: money("display_monthly_minor").notNull(),
  displayYearlyMonthlyMinor: money("display_yearly_monthly_minor").notNull(),
  chargeCurrency: char("charge_currency", { length: 3 }).notNull().default("USD"),
  chargeMonthlyMinor: money("charge_monthly_minor").notNull(),
  chargeYearlyMinor: money("charge_yearly_minor").notNull(),
  entitlements: jsonb("entitlements").$type<PlanEntitlements>().notNull(),
  paddlePriceIds: jsonb("paddle_price_ids").$type<{ month: string; year: string }>().notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const topupPacks = platform.table("topup_packs", {
  id: text("id").primaryKey(),
  credits: integer("credits").notNull(),
  displayCurrency: char("display_currency", { length: 3 }).notNull().default("PKR"),
  displayPriceMinor: money("display_price_minor").notNull(),
  chargeCurrency: char("charge_currency", { length: 3 }).notNull().default("USD"),
  chargePriceMinor: money("charge_price_minor").notNull(),
  validityMonths: integer("validity_months").notNull().default(12),
  paddlePriceId: text("paddle_price_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditActionCosts = platform.table("credit_action_costs", {
  action: text("action", { enum: ["search_existing", "find_new", "reveal_contact", "refresh_data"] }).primaryKey(),
  credits: integer("credits").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const billingSettings = platform.table("billing_settings", {
  id: boolean("id").primaryKey().default(true),
  trialDays: integer("trial_days").notNull(),
  trialCredits: integer("trial_credits").notNull(),
  trialPlanId: text("trial_plan_id", { enum: ["explorer", "growth", "scale"] }).notNull(),
  reservationTtlMinutes: integer("reservation_ttl_minutes").notNull(),
  meterAmberPct: integer("meter_amber_pct").notNull(),
  meterRedPct: integer("meter_red_pct").notNull(),
  trialEndingNoticeDays: integer("trial_ending_notice_days").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const webhookEvents = platform.table("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
  error: text("error"),
});

const statusEnum = ["trialing", "active", "past_due", "canceled", "expired"] as const;
const intervalEnum = ["month", "year"] as const;
const planEnum = ["explorer", "growth", "scale"] as const;
const actionEnum = ["search_existing", "find_new", "reveal_contact", "refresh_data"] as const;

export const subscriptions = wp.table("subscriptions", {
  workspaceId: uuid("workspace_id").primaryKey(),
  planId: text("plan_id", { enum: planEnum }),
  billingInterval: text("billing_interval", { enum: intervalEnum }),
  status: text("status", { enum: statusEnum }).notNull(),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  trialEndsAt: ts("trial_ends_at"),
  trialEndingNotifiedAt: ts("trial_ending_notified_at"),
  nextCreditGrantAt: ts("next_credit_grant_at"),
  paddleSubscriptionId: text("paddle_subscription_id"),
  paddleCustomerId: text("paddle_customer_id"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  scheduledPlanId: text("scheduled_plan_id", { enum: planEnum }),
  scheduledInterval: text("scheduled_interval", { enum: intervalEnum }),
  providerEventAt: ts("provider_event_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const checkouts = wp.table("checkouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  kind: text("kind", { enum: ["subscription", "topup"] }).notNull(),
  planId: text("plan_id", { enum: planEnum }),
  billingInterval: text("billing_interval", { enum: intervalEnum }),
  topupPackId: text("topup_pack_id"),
  priceId: text("price_id").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: text("status", { enum: ["open", "paid", "failed", "expired"] }).notNull().default("open"),
  providerCheckoutId: text("provider_checkout_id"),
  hostedUrl: text("hosted_url"),
  requestedBy: uuid("requested_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const billingPayments = wp.table("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  paddleTransactionId: text("paddle_transaction_id").notNull(),
  kind: text("kind", { enum: ["subscription", "topup"] }).notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: text("status").notNull(),
  invoiceUrl: text("invoice_url"),
  checkoutId: uuid("checkout_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditLots = wp.table("credit_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  source: text("source", { enum: ["trial", "monthly", "topup", "adjustment"] }).notNull(),
  amount: integer("amount").notNull(),
  remaining: integer("remaining").notNull(),
  expiresAt: ts("expires_at").notNull(),
  paymentId: uuid("payment_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditReservations = wp.table("credit_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  amount: integer("amount").notNull(),
  action: text("action", { enum: actionEnum }).notNull(),
  confirmedCost: integer("confirmed_cost").notNull(),
  status: text("status", { enum: ["held", "committed", "released", "expired"] }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  committedAt: ts("committed_at"),
  releasedAt: ts("released_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditLedger = wp.table("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  amount: integer("amount").notNull(),
  kind: text("kind", { enum: ["grant", "spend", "refund", "expire", "adjust", "reserve", "release"] }).notNull(),
  action: text("action", { enum: actionEnum }),
  lotId: uuid("lot_id"),
  reservationId: uuid("reservation_id"),
  sourceRef: text("source_ref"),
  actorUserId: uuid("actor_user_id"),
  actorStaffId: uuid("actor_staff_id"),
  note: text("note"),
  createdAt: ts("created_at").notNull().default(sql`now()`),
});

export const entitlementUsage = wp.table(
  "entitlement_usage",
  {
    workspaceId: uuid("workspace_id").notNull(),
    key: text("key", { enum: ["audience_views", "outreach_emails"] }).notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key, t.periodStart] })],
);
```

Replace `packages/db/src/schema/index.ts`:
```ts
import {
  billingPayments,
  billingSettings,
  checkouts,
  creditActionCosts,
  creditLedger,
  creditLots,
  creditReservations,
  entitlementUsage,
  plans,
  subscriptions,
  topupPacks,
  webhookEvents,
} from "./billing";
import { users, workspaceMembers, workspaces } from "./identity";
import { idempotencyKeys, outbox, providerCalls } from "./platform";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./billing";
export * from "./identity";
export * from "./platform";
export * from "./staff";

/** Every Drizzle table; the drift test compares each one with the live database. */
export const ALL_TABLES = [
  users,
  workspaces,
  workspaceMembers,
  staffUsers,
  staffSessions,
  auditLog,
  outbox,
  providerCalls,
  idempotencyKeys,
  plans,
  topupPacks,
  creditActionCosts,
  billingSettings,
  webhookEvents,
  subscriptions,
  checkouts,
  billingPayments,
  creditLots,
  creditReservations,
  creditLedger,
  entitlementUsage,
];
```

- [ ] **Step 3: Add `withWorkspace` to `packages/db/src/database.ts`**

In the `Db` type, after `withSystem`, add:
```ts
  /** Worker/system code acting inside one workspace: role mushin_worker, workspace RLS context, no user. */
  withWorkspace<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
```
In the returned object, after `withSystem(fn) { … },` add:
```ts
    withWorkspace(workspaceId, fn) {
      assertUuid("workspaceId", workspaceId);
      return run("mushin_worker", { workspaceId }, (tx) => fn(tx as TenantTx));
    },
```

- [ ] **Step 4: Keep config tables on reset and add a workspace helper** — `packages/db/src/testing.ts`

Replace `resetTables` and add `createTestWorkspace` (add `import { randomUUID } from "node:crypto";` at the top):
```ts
/** Config tables hold migration seeds; tests must not wipe them. */
const KEEP = ["schema_migrations", "plans", "topup_packs", "credit_action_costs", "billing_settings"];

/** Empties every app table except seeded config (owner privilege; app roles cannot truncate append-only tables). */
export async function resetTables(): Promise<void> {
  const rows = await ownerQuery<{ t: string }>(
    `select format('%I.%I', schemaname, tablename) as t from pg_tables
     where schemaname in ('wp','staff','platform')
       and not (schemaname = 'platform' and tablename in (${KEEP.map((k) => `'${k}'`).join(", ")}))`,
  );
  if (rows.length) await ownerQuery(`truncate ${rows.map((r) => r.t).join(", ")} restart identity cascade`);
}

/** A user + workspace + owner membership, created as the owner (bypassing the API). */
export async function createTestWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await ownerQuery(`
    insert into wp.users (id, email) values ('${userId}', '${userId}@test.mushin.pk');
    insert into wp.workspaces (id, name, owner_user_id) values ('${workspaceId}', 'Test workspace', '${userId}');
    insert into wp.workspace_members (workspace_id, user_id, role) values ('${workspaceId}', '${userId}', 'owner');`);
  return { userId, workspaceId };
}
```

- [ ] **Step 5: Write the integration test** — `packages/db/src/billing-schema.int.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function lot(workspaceId: string, remaining: number) {
  const rows = await ownerQuery<{ id: string }>(`
    insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at)
    values ('${workspaceId}', 'topup', ${remaining}, ${remaining}, now() + interval '30 days') returning id`);
  return rows[0]?.id ?? "";
}

describe("billing schema", () => {
  it("seeds plans, packs, action costs and settings, and keeps them across resets", async () => {
    await resetTables();
    const rows = await ownerQuery<{ plans: number; packs: number; costs: number; trial: number }>(`
      select (select count(*)::int from platform.plans) plans, (select count(*)::int from platform.topup_packs) packs,
             (select count(*)::int from platform.credit_action_costs) costs,
             (select trial_credits from platform.billing_settings) trial`);
    expect(rows[0]).toEqual({ plans: 3, packs: 3, costs: 4, trial: 200 });
  });

  it("keeps the ledger append-only for the API role", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await db.withTenant(ws, (tx) =>
      tx.execute(sql`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values (${ws.workspaceId}, 10, 'grant', ${lotId})`),
    );
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`update wp.credit_ledger set amount = 99`))).rejects.toThrow(/permission denied/);
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`delete from wp.credit_ledger`))).rejects.toThrow(/permission denied/);
    await expect(
      db.withTenant(ws, (tx) =>
        tx.execute(sql`insert into wp.payments (workspace_id, paddle_transaction_id, kind, amount_minor, currency, status)
                       values (${ws.workspaceId}, 'txn_x', 'topup', 100, 'USD', 'completed')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects reserve rows that point at a lot and spend rows that do not", async () => {
    const ws = await createTestWorkspace();
    const lotId = await lot(ws.workspaceId, 10);
    await expect(
      ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind, lot_id) values ('${ws.workspaceId}', 5, 'reserve', '${lotId}')`),
    ).rejects.toThrow(/check constraint/);
    await expect(ownerQuery(`insert into wp.credit_ledger (workspace_id, amount, kind) values ('${ws.workspaceId}', -5, 'spend')`)).rejects.toThrow(
      /check constraint/,
    );
  });

  it("lets the worker find lots across workspaces but change them only inside one workspace", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await lot(a.workspaceId, 5);
    await lot(b.workspaceId, 7);
    const seen = await db.withSystem((tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from wp.credit_lots`));
    expect(seen[0]?.n).toBe(2);
    const blind = await db.withSystem((tx) => tx.execute(sql`update wp.credit_lots set remaining = 0 returning id`));
    expect(blind.length).toBe(0);
    const scoped = await db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`update wp.credit_lots set remaining = 0 returning id`));
    expect(scoped.length).toBe(1);
    await expect(db.withWorkspace("not-a-uuid", async () => 1)).rejects.toThrow(/uuid/);
  });

  it("hides one workspace's billing rows from another", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await lot(a.workspaceId, 5);
    const fromB = await db.withTenant(b, (tx) => tx.execute(sql`select id from wp.credit_lots`));
    expect(fromB.length).toBe(0);
    expect(randomUUID()).not.toBe(a.workspaceId);
  });
});
```

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
Run: `npm run test:int` → expected PASS (billing schema 5 tests; RLS catalog guard now also covers the 7 new `wp` tables; drift test covers the 12 new tables). Without `TEST_DATABASE_URL` it stops with "TEST_DATABASE_URL is not set": record "integration tests not yet run" in the commit message.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): add billing tables, seeds, grants and withWorkspace"
```

---
### Task 4: Pure billing rules

**Files:**
- Create: `apps/api/src/modules/billing/rules.ts`, `apps/api/src/modules/billing/rules.test.ts`

**Interfaces:**
- Consumes: `MeterState`, `BillingInterval`, `PlanId`, `SubscriptionStatus`, `LostAccessItem` (contracts).
- Produces:
  ```ts
  type LotForSpend = { id: string; remaining: number; expiresAt: Date };
  type Allocation = { lotId: string; take: number };
  class InsufficientLotsError extends Error { required: number; available: number }
  allocateLots(lots: readonly LotForSpend[], amount: number): Allocation[]
  meterState(available: number, base: number, t: { amberPct: number; redPct: number }): MeterState
  type MeterAlert = "credits_low" | "credits_very_low"; meterAlert(before: MeterState, after: MeterState): MeterAlert | null
  type PlanChoice = { planId: PlanId; interval: BillingInterval; monthlyCredits: number };
  classifyChange(current: PlanChoice, target: PlanChoice): "upgrade" | "downgrade" | "same"
  type SpendScope = "all" | "topup_only" | "none"; spendScope(status: SubscriptionStatus | null): SpendScope
  lostAccessFor(status: SubscriptionStatus | null, topupRemaining: number): LostAccessItem[]
  daysLeft(until: Date | null, now: Date): number | null
  addMonths(date: Date, months: number): Date          // UTC, clamps to month end
  monthStart(date: Date): string                        // "YYYY-MM-01" (UTC)
  type LedgerCursor = { createdAt: Date; id: string }; encodeCursor(c): string; decodeCursor(s: string): LedgerCursor | null
  ```

- [ ] **Step 1: Write the failing tests** — `apps/api/src/modules/billing/rules.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  addMonths,
  allocateLots,
  classifyChange,
  daysLeft,
  decodeCursor,
  encodeCursor,
  InsufficientLotsError,
  lostAccessFor,
  meterAlert,
  meterState,
  monthStart,
  spendScope,
} from "./rules";

const lot = (id: string, remaining: number, day: number) => ({ id, remaining, expiresAt: new Date(Date.UTC(2026, 9, day)) });

describe("allocateLots", () => {
  it("spends the soonest-expiring lots first and splits across lots", () => {
    expect(allocateLots([lot("b", 10, 20), lot("a", 5, 10)], 8)).toEqual([
      { lotId: "a", take: 5 },
      { lotId: "b", take: 3 },
    ]);
  });

  it("breaks expiry ties by id and skips empty lots", () => {
    expect(allocateLots([lot("z", 4, 10), lot("y", 0, 1), lot("x", 4, 10)], 6)).toEqual([
      { lotId: "x", take: 4 },
      { lotId: "z", take: 2 },
    ]);
  });

  it("refuses amounts the lots cannot cover, and non-positive amounts", () => {
    expect(() => allocateLots([lot("a", 3, 1)], 4)).toThrow(InsufficientLotsError);
    expect(() => allocateLots([lot("a", 3, 1)], 0)).toThrow(/positive/);
  });
});

describe("credit meter", () => {
  const t = { amberPct: 20, redPct: 5 };

  it("turns amber below 20% and red below 5% of the base", () => {
    expect(meterState(40, 200, t)).toBe("normal");
    expect(meterState(39, 200, t)).toBe("amber");
    expect(meterState(9, 200, t)).toBe("red");
    expect(meterState(0, 0, t)).toBe("red");
    expect(meterState(5, 0, t)).toBe("normal");
  });

  it("alerts only when moving into a worse band", () => {
    expect(meterAlert("normal", "amber")).toBe("credits_low");
    expect(meterAlert("amber", "red")).toBe("credits_very_low");
    expect(meterAlert("normal", "red")).toBe("credits_very_low");
    expect(meterAlert("amber", "amber")).toBeNull();
    expect(meterAlert("red", "amber")).toBeNull();
  });
});

describe("classifyChange", () => {
  const growthMonth = { planId: "growth" as const, interval: "month" as const, monthlyCredits: 12_000 };
  it("compares monthly credits first, then the interval", () => {
    expect(classifyChange(growthMonth, { planId: "scale", interval: "month", monthlyCredits: 35_000 })).toBe("upgrade");
    expect(classifyChange(growthMonth, { planId: "explorer", interval: "year", monthlyCredits: 2_500 })).toBe("downgrade");
    expect(classifyChange(growthMonth, { planId: "growth", interval: "year", monthlyCredits: 12_000 })).toBe("upgrade");
    expect(classifyChange({ ...growthMonth, interval: "year" }, growthMonth)).toBe("downgrade");
    expect(classifyChange(growthMonth, growthMonth)).toBe("same");
  });
});

describe("access", () => {
  it("lets trialing and paying workspaces spend any credits, others top-ups only", () => {
    expect(spendScope("trialing")).toBe("all");
    expect(spendScope("past_due")).toBe("all");
    expect(spendScope("canceled")).toBe("topup_only");
    expect(spendScope("expired")).toBe("topup_only");
    expect(spendScope(null)).toBe("none");
  });

  it("lists what a workspace without a plan has lost", () => {
    expect(lostAccessFor("active", 0)).toEqual([]);
    expect(lostAccessFor("expired", 0)).toEqual([
      "find_new",
      "reveal_contact",
      "refresh_data",
      "monthly_credits",
      "outreach",
      "audience_details",
      "export",
    ]);
    expect(lostAccessFor("canceled", 500)).toEqual(["monthly_credits", "outreach", "audience_details", "export"]);
  });
});

describe("dates and cursors", () => {
  it("adds months in UTC and clamps to the month end", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-10-07T00:00:00Z"), 12).toISOString()).toBe("2027-10-07T00:00:00.000Z");
    expect(monthStart(new Date("2026-10-07T23:00:00Z"))).toBe("2026-10-01");
  });

  it("counts whole days left, never negative", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(daysLeft(new Date("2026-10-21T00:00:00Z"), now)).toBe(14);
    expect(daysLeft(new Date("2026-10-07T12:00:00Z"), now)).toBe(1);
    expect(daysLeft(new Date("2026-10-01T00:00:00Z"), now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });

  it("round-trips ledger cursors and rejects garbage", () => {
    const c = { createdAt: new Date("2026-10-07T01:02:03.456Z"), id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-07T00:00:00Z|nope").toString("base64url"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/modules/billing/rules.test.ts`
Expected: FAIL, cannot find `./rules`.

- [ ] **Step 3: Implement** — `apps/api/src/modules/billing/rules.ts`

```ts
import type { BillingInterval, LostAccessItem, MeterState, PlanId, SubscriptionStatus } from "@mushin/contracts";

export type LotForSpend = { id: string; remaining: number; expiresAt: Date };
export type Allocation = { lotId: string; take: number };

export class InsufficientLotsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`lots cover ${available} of ${required} credits`);
    this.name = "InsufficientLotsError";
  }
}

/** Takes credits from the soonest-expiring lots first (ties by id, so the order is deterministic). */
export function allocateLots(lots: readonly LotForSpend[], amount: number): Allocation[] {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer");
  const ordered = lots
    .filter((l) => l.remaining > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
  const out: Allocation[] = [];
  let left = amount;
  for (const lot of ordered) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, take });
    left -= take;
  }
  if (left > 0) throw new InsufficientLotsError(amount, amount - left);
  return out;
}

export function meterState(available: number, base: number, t: { amberPct: number; redPct: number }): MeterState {
  if (base <= 0) return available > 0 ? "normal" : "red";
  if (available * 100 < base * t.redPct) return "red";
  if (available * 100 < base * t.amberPct) return "amber";
  return "normal";
}

export type MeterAlert = "credits_low" | "credits_very_low";

export function meterAlert(before: MeterState, after: MeterState): MeterAlert | null {
  if (after === "red" && before !== "red") return "credits_very_low";
  if (after === "amber" && before === "normal") return "credits_low";
  return null;
}

export type PlanChoice = { planId: PlanId; interval: BillingInterval; monthlyCredits: number };

/** More monthly credits = upgrade; same credits: switching to yearly = upgrade, to monthly = downgrade. */
export function classifyChange(current: PlanChoice, target: PlanChoice): "upgrade" | "downgrade" | "same" {
  if (current.planId === target.planId && current.interval === target.interval) return "same";
  if (target.monthlyCredits !== current.monthlyCredits) return target.monthlyCredits > current.monthlyCredits ? "upgrade" : "downgrade";
  return target.interval === "year" ? "upgrade" : "downgrade";
}

export type SpendScope = "all" | "topup_only" | "none";

/** Spec D3/D14: without a plan only paid top-up credits stay spendable. */
export function spendScope(status: SubscriptionStatus | null): SpendScope {
  if (status === "trialing" || status === "active" || status === "past_due") return "all";
  if (status === "canceled" || status === "expired") return "topup_only";
  return "none";
}

export function lostAccessFor(status: SubscriptionStatus | null, topupRemaining: number): LostAccessItem[] {
  if (spendScope(status) === "all") return [];
  const lost: LostAccessItem[] = ["monthly_credits", "outreach", "audience_details", "export"];
  return topupRemaining > 0 ? lost : ["find_new", "reveal_contact", "refresh_data", ...lost];
}

export function daysLeft(until: Date | null, now: Date): number | null {
  if (!until) return null;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function monthStart(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export type LedgerCursor = { createdAt: Date; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: LedgerCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(s: string): LedgerCursor | null {
  const [iso, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (!iso || !id || !UUID.test(id)) return null;
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit apps/api/src/modules/billing/rules.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add apps/api/src/modules/billing
git commit -m "feat(billing): add pure credit and plan rules"
```

---

### Task 5: Billing repository and credit engine

**Files:**
- Create: `apps/api/src/modules/billing/repository.ts`, `apps/api/src/modules/billing/engine.ts`, `apps/api/src/modules/billing/index.ts`, `apps/api/src/modules/billing/engine.int.test.ts`

**Interfaces:**
- Consumes: Task 3 tables, `Db.withWorkspace`, `writeOutbox`, `createTestWorkspace`; Task 4 rules.
- Produces:
  ```ts
  // engine.ts
  type Actor = { userId: string | null; requestId: string | null };
  type SpendRequest = { action: CreditAction; confirmedCost: number; refType: string; refId: string };
  type GrantRequest = { source: LotSource; amount: number; expiresAt: Date; sourceRef: string; paymentId?: string | null; note?: string | null };
  type Balance = { status: SubscriptionStatus | null; available: number; reserved: number; base: number; meter: MeterState; topupRemaining: number };
  createCreditEngine(o?: { now?: () => Date }): CreditEngine
  type CreditEngine = {
    balance(tx: TenantTx, workspaceId: string): Promise<Balance>;
    reserve(tx, workspaceId, req: SpendRequest, actor: Actor): Promise<{ reservationId: string; amount: number }>;
    extend(tx, workspaceId, reservationId: string): Promise<void>;
    commit(tx, workspaceId, reservationId: string, actor: Actor): Promise<void>;
    release(tx, workspaceId, reservationId: string, reason: string, actor: Actor): Promise<void>;
    spendInstant(tx, workspaceId, req: SpendRequest, actor: Actor): Promise<{ reservationId: string; amount: number }>;
    grant(tx, workspaceId, g: GrantRequest): Promise<string | null>;   // null = duplicate sourceRef
    startTrial(tx, workspaceId): Promise<void>;
    expireLots(tx, workspaceId): Promise<number>;                       // skips workspaces with held reservations
    endLots(tx, workspaceId, source: LotSource): Promise<void>;         // ends unexpired lots of a source now, then expires
    releaseAbandoned(tx, workspaceId): Promise<number>;
    reconcile(tx, workspaceId): Promise<{ lotId: string; remaining: number; ledgerSum: number }[]>;
    useEntitlement(tx, workspaceId, key: "audience_views" | "outreach_emails", limit: number | null): Promise<boolean>;
  }
  // repository.ts exports the row types SettingsRow, PlanRow, PackRow, SubscriptionRow, SubscriptionPatch, ReservationRow, CheckoutRow,
  // LotSource, BillingJob and the functions listed in Step 3.
  // index.ts (for now): export { createCreditEngine } and types Actor, SpendRequest, GrantRequest, Balance, CreditEngine.
  ```
- Note: meter alerts are written when a **reservation** lowers the available balance (commit does not change `available`, because the held amount was already subtracted). This satisfies spec §5 rule 10's intent; `spendInstant` reserves first, so it alerts too.

- [ ] **Step 1: Write the failing integration test** — `apps/api/src/modules/billing/engine.int.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantTx } from "@mushin/db";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createCreditEngine } from "./engine";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

let clock = new Date("2026-10-07T10:00:00Z");
const engine = createCreditEngine({ now: () => clock });
const actor = { userId: null, requestId: "req-test" };
const findNew = (refId = randomUUID()) => ({ action: "find_new" as const, confirmedCost: 12, refType: "test", refId });
const minutes = (n: number) => new Date(clock.getTime() + n * 60_000);

async function trialWorkspace() {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => engine.startTrial(tx, ws.workspaceId));
  return ws;
}
const inWs = <T>(ws: { userId: string; workspaceId: string }, fn: (tx: TenantTx) => Promise<T>) => db.withTenant(ws, fn);

beforeEach(() => {
  clock = new Date("2026-10-07T10:00:00Z");
});

describe("trial", () => {
  it("grants 200 trial credits once", async () => {
    const ws = await trialWorkspace();
    await inWs(ws, (tx) => engine.startTrial(tx, ws.workspaceId));
    const b = await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId));
    expect(b).toMatchObject({ status: "trialing", available: 200, reserved: 0, base: 200, meter: "normal" });
    const lots = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_lots where workspace_id = '${ws.workspaceId}'`);
    expect(lots[0]?.n).toBe(1);
  });
});

describe("reserve, commit, release", () => {
  it("holds credits, then spends the soonest-expiring lot first", async () => {
    const ws = await trialWorkspace();
    const topup = await inWs(ws, (tx) =>
      engine.grant(tx, ws.workspaceId, { source: "topup", amount: 100, expiresAt: minutes(60 * 24 * 365), sourceRef: "txn:1" }),
    );
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 288, reserved: 12 });
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor)); // repeat is a no-op
    const lots = await ownerQuery<{ source: string; remaining: number }>(
      `select source, remaining from wp.credit_lots where workspace_id = '${ws.workspaceId}' order by source`,
    );
    expect(lots).toEqual([
      { source: "topup", remaining: 100 },
      { source: "trial", remaining: 188 },
    ]);
    const kinds = await ownerQuery<{ kind: string; amount: number }>(
      `select kind, amount from wp.credit_ledger where reservation_id = '${reservationId}' order by created_at, kind`,
    );
    expect(kinds).toEqual([
      { kind: "reserve", amount: 12 },
      { kind: "spend", amount: -12 },
    ]);
    expect(topup).toEqual(expect.any(String));
    await expect(inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "test", actor))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("releases a hold without touching lots, and a repeated release is a no-op", async () => {
    const ws = await trialWorkspace();
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    await inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "job failed", actor));
    await inWs(ws, (tx) => engine.release(tx, ws.workspaceId, reservationId, "job failed", actor));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 200, reserved: 0 });
    const rows = await ownerQuery<{ kind: string }>(`select kind from wp.credit_ledger where reservation_id = '${reservationId}' order by created_at`);
    expect(rows.map((r) => r.kind)).toEqual(["reserve", "release"]);
  });

  it("refuses a changed cost (Review Focus 4) and too few credits", async () => {
    const ws = await trialWorkspace();
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, { ...findNew(), confirmedCost: 10 }, actor))).rejects.toMatchObject({
      code: "CONFLICT",
      details: { confirmedCost: 10, currentCost: 12 },
    });
    await ownerQuery(`update wp.credit_lots set remaining = 5 where workspace_id = '${ws.workspaceId}'`);
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      details: { required: 12, available: 5 },
    });
    const held = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_reservations`);
    expect(held[0]?.n).toBe(0);
  });

  it("never overspends under 20 concurrent reserves", async () => {
    const ws = await trialWorkspace();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(16); // 16 × 12 = 192 ≤ 200
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 8, reserved: 192 });
  });
});

describe("plans and access", () => {
  it("requires a plan, but lets an expired workspace spend paid top-ups only", async () => {
    const bare = await createTestWorkspace();
    await expect(inWs(bare, (tx) => engine.reserve(tx, bare.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
    });

    const ws = await trialWorkspace();
    await ownerQuery(`update wp.subscriptions set status = 'expired' where workspace_id = '${ws.workspaceId}'`);
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      details: { reason: "no_active_plan" },
    });
    await inWs(ws, (tx) => engine.grant(tx, ws.workspaceId, { source: "topup", amount: 20, expiresAt: minutes(1000), sourceRef: "txn:2" }));
    expect(await inWs(ws, (tx) => engine.balance(tx, ws.workspaceId))).toMatchObject({ available: 20, topupRemaining: 20 });
    await expect(inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor))).resolves.toMatchObject({ amount: 12 });
  });

  it("grants each source reference once", async () => {
    const ws = await trialWorkspace();
    const g = { source: "topup" as const, amount: 50, expiresAt: minutes(1000), sourceRef: "txn:dup" };
    expect(await inWs(ws, (tx) => engine.grant(tx, ws.workspaceId, g))).toEqual(expect.any(String));
    expect(await inWs(ws, (tx) => engine.grant(tx, ws.workspaceId, g))).toBeNull();
  });
});

describe("expiry and cleanup", () => {
  it("commits from lots that were valid when reserved (Review Focus 1)", async () => {
    const ws = await createTestWorkspace();
    await ownerQuery(`insert into wp.subscriptions (workspace_id, status) values ('${ws.workspaceId}', 'active')`);
    await inWs(ws, (tx) => engine.grant(tx, ws.workspaceId, { source: "monthly", amount: 20, expiresAt: minutes(5), sourceRef: "m:1" }));
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    clock = minutes(10);
    expect(await inWs(ws, (tx) => engine.expireLots(tx, ws.workspaceId))).toBe(0); // skipped: a hold exists
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    expect(await inWs(ws, (tx) => engine.expireLots(tx, ws.workspaceId))).toBe(1);
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([]);
  });

  it("releases abandoned holds but keeps renewed ones", async () => {
    const ws = await trialWorkspace();
    const kept = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    const dropped = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    clock = minutes(10);
    await inWs(ws, (tx) => engine.extend(tx, ws.workspaceId, kept.reservationId));
    clock = minutes(10); // 20 minutes after the holds were made
    expect(await inWs(ws, (tx) => engine.releaseAbandoned(tx, ws.workspaceId))).toBe(1);
    const rows = await ownerQuery<{ id: string; status: string }>(`select id, status from wp.credit_reservations order by status`);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: dropped.reservationId, status: "expired" },
        { id: kept.reservationId, status: "held" },
      ]),
    );
  });

  it("detects a lot that no longer matches its ledger", async () => {
    const ws = await trialWorkspace();
    const { reservationId } = await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor));
    await inWs(ws, (tx) => engine.commit(tx, ws.workspaceId, reservationId, actor));
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([]);
    await ownerQuery(`update wp.credit_lots set remaining = remaining + 1 where workspace_id = '${ws.workspaceId}'`);
    expect(await inWs(ws, (tx) => engine.reconcile(tx, ws.workspaceId))).toEqual([expect.objectContaining({ remaining: 189, ledgerSum: 188 })]);
  });
});

describe("meter alerts", () => {
  it("writes low and very-low notifications once each as the balance falls", async () => {
    const ws = await trialWorkspace();
    for (let i = 0; i < 16; i++) await inWs(ws, (tx) => engine.reserve(tx, ws.workspaceId, findNew(), actor)); // 200 → 8
    const rows = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox order by created_at`);
    expect(rows.map((r) => r.event_type)).toEqual(["notify.credits_low", "notify.credits_very_low"]);
  });
});

describe("plan limits", () => {
  it("counts monthly usage up to the limit", async () => {
    const ws = await trialWorkspace();
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(true);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(true);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "audience_views", 2))).toBe(false);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "outreach_emails", 0))).toBe(false);
    expect(await inWs(ws, (tx) => engine.useEntitlement(tx, ws.workspaceId, "outreach_emails", null))).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run: `npx tsc -p tsconfig.json` → FAIL (cannot find `./engine`). (`npm run test:int` also fails while `TEST_DATABASE_URL` is missing; the compile error is the failure to confirm.)

- [ ] **Step 3: Implement the repository** — `apps/api/src/modules/billing/repository.ts`

```ts
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { BillingInterval, CreditAction, PlanId } from "@mushin/contracts";
import {
  billingPayments,
  billingSettings,
  checkouts,
  creditActionCosts,
  creditLedger,
  creditLots,
  creditReservations,
  plans,
  subscriptions,
  topupPacks,
  webhookEvents,
  type SystemTx,
  type TenantTx,
} from "@mushin/db";
import type { LedgerCursor, LotForSpend } from "./rules";

type AnyTx = TenantTx | SystemTx;

export type LotSource = (typeof creditLots.$inferSelect)["source"];
export type SettingsRow = typeof billingSettings.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type PackRow = typeof topupPacks.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionPatch = Partial<Omit<typeof subscriptions.$inferInsert, "workspaceId" | "createdAt" | "updatedAt">>;
export type ReservationRow = typeof creditReservations.$inferSelect;
export type CheckoutRow = typeof checkouts.$inferSelect;
export type PaymentRow = typeof billingPayments.$inferSelect;
export type LedgerInsert = typeof creditLedger.$inferInsert;
export type BillingJob =
  | "release_abandoned"
  | "expire_lots"
  | "end_trials"
  | "trial_notices"
  | "monthly_grants"
  | "scheduled_changes"
  | "reconcile"
  | "mock_renewals";

/** Serializes every credit operation of one workspace until the transaction ends. */
export async function lockCredits(tx: TenantTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${workspaceId}`}, 0))`);
}

// ── config ──────────────────────────────────────────────────────────────────
export async function getSettings(tx: AnyTx): Promise<SettingsRow> {
  const rows = await tx.select().from(billingSettings).limit(1);
  const row = rows[0];
  if (!row) throw new Error("platform.billing_settings has no row; run the migrations");
  return row;
}

export async function getActionCost(tx: AnyTx, action: CreditAction): Promise<number> {
  const rows = await tx.select({ credits: creditActionCosts.credits }).from(creditActionCosts).where(eq(creditActionCosts.action, action)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`no credit cost configured for ${action}`);
  return row.credits;
}

export function listActionCosts(tx: AnyTx) {
  return tx.select().from(creditActionCosts);
}

export function listPlans(tx: AnyTx): Promise<PlanRow[]> {
  return tx.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder));
}

export async function getPlan(tx: AnyTx, id: PlanId): Promise<PlanRow | null> {
  const rows = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0] ?? null;
}

export function listPacks(tx: AnyTx): Promise<PackRow[]> {
  return tx.select().from(topupPacks).where(eq(topupPacks.active, true)).orderBy(asc(topupPacks.credits));
}

export async function getPack(tx: AnyTx, id: string): Promise<PackRow | null> {
  const rows = await tx.select().from(topupPacks).where(and(eq(topupPacks.id, id), eq(topupPacks.active, true))).limit(1);
  return rows[0] ?? null;
}

export async function findPriceOwner(
  tx: AnyTx,
  priceId: string,
): Promise<{ kind: "plan"; plan: PlanRow; interval: BillingInterval } | { kind: "topup"; pack: PackRow } | null> {
  const planRows = await tx
    .select()
    .from(plans)
    .where(sql`${plans.paddlePriceIds}->>'month' = ${priceId} or ${plans.paddlePriceIds}->>'year' = ${priceId}`)
    .limit(1);
  const plan = planRows[0];
  if (plan) return { kind: "plan", plan, interval: plan.paddlePriceIds.month === priceId ? "month" : "year" };
  const packRows = await tx.select().from(topupPacks).where(eq(topupPacks.paddlePriceId, priceId)).limit(1);
  const pack = packRows[0];
  return pack ? { kind: "topup", pack } : null;
}

// ── subscriptions ───────────────────────────────────────────────────────────
export async function getSubscription(tx: TenantTx, workspaceId: string, opts: { forUpdate?: boolean } = {}): Promise<SubscriptionRow | null> {
  const base = tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  const rows = opts.forUpdate ? await base.for("update").limit(1) : await base.limit(1);
  return rows[0] ?? null;
}

export async function insertTrialSubscription(tx: TenantTx, workspaceId: string, trialEndsAt: Date): Promise<boolean> {
  const rows = await tx
    .insert(subscriptions)
    .values({ workspaceId, status: "trialing", trialEndsAt })
    .onConflictDoNothing({ target: subscriptions.workspaceId })
    .returning({ id: subscriptions.workspaceId });
  return rows.length === 1;
}

export async function upsertSubscription(tx: TenantTx, workspaceId: string, patch: SubscriptionPatch & { status: SubscriptionRow["status"] }): Promise<void> {
  await tx
    .insert(subscriptions)
    .values({ workspaceId, ...patch })
    .onConflictDoUpdate({ target: subscriptions.workspaceId, set: patch });
}

export async function updateSubscription(tx: TenantTx, workspaceId: string, patch: SubscriptionPatch): Promise<void> {
  await tx.update(subscriptions).set(patch).where(eq(subscriptions.workspaceId, workspaceId));
}

// ── lots ────────────────────────────────────────────────────────────────────
export async function sumRemaining(tx: TenantTx, workspaceId: string, now: Date, sources: readonly LotSource[] | "all"): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${creditLots.remaining}), 0)::int` })
    .from(creditLots)
    .where(
      and(
        eq(creditLots.workspaceId, workspaceId),
        gt(creditLots.remaining, 0),
        gt(creditLots.expiresAt, now),
        sources === "all" ? undefined : inArray(creditLots.source, [...sources]),
      ),
    );
  return rows[0]?.total ?? 0;
}

export async function lotsValidAt(tx: TenantTx, workspaceId: string, at: Date): Promise<LotForSpend[]> {
  return tx
    .select({ id: creditLots.id, remaining: creditLots.remaining, expiresAt: creditLots.expiresAt })
    .from(creditLots)
    .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0), gt(creditLots.expiresAt, at)));
}

export async function insertLot(
  tx: TenantTx,
  l: { workspaceId: string; source: LotSource; amount: number; expiresAt: Date; paymentId: string | null },
): Promise<string> {
  const rows = await tx.insert(creditLots).values({ ...l, remaining: l.amount }).returning({ id: creditLots.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("credit lot insert returned no id");
  return id;
}

export async function takeFromLot(tx: TenantTx, lotId: string, take: number): Promise<void> {
  const rows = await tx
    .update(creditLots)
    .set({ remaining: sql`${creditLots.remaining} - ${take}` })
    .where(and(eq(creditLots.id, lotId), sql`${creditLots.remaining} >= ${take}`))
    .returning({ id: creditLots.id });
  if (rows.length !== 1) throw new Error(`credit lot ${lotId} cannot cover ${take} credits`);
}

export function expiredLots(tx: TenantTx, workspaceId: string, now: Date): Promise<{ id: string; remaining: number }[]> {
  return tx
    .select({ id: creditLots.id, remaining: creditLots.remaining })
    .from(creditLots)
    .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0), lte(creditLots.expiresAt, now)));
}

export async function zeroLot(tx: TenantTx, lotId: string): Promise<void> {
  await tx.update(creditLots).set({ remaining: 0 }).where(eq(creditLots.id, lotId));
}

/** Moves the expiry of a source's unexpired lots to `at` (the expiry job then writes the ledger rows). */
export async function endLotsOfSource(tx: TenantTx, workspaceId: string, source: LotSource, at: Date): Promise<void> {
  await tx
    .update(creditLots)
    .set({ expiresAt: at })
    .where(and(eq(creditLots.workspaceId, workspaceId), eq(creditLots.source, source), gt(creditLots.remaining, 0), gt(creditLots.expiresAt, at)));
}

export async function hasGrant(tx: TenantTx, workspaceId: string, sourceRef: string): Promise<boolean> {
  const rows = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.workspaceId, workspaceId), eq(creditLedger.kind, "grant"), eq(creditLedger.sourceRef, sourceRef)))
    .limit(1);
  return rows.length === 1;
}

export async function insertLedger(tx: TenantTx, rows: LedgerInsert[]): Promise<void> {
  if (rows.length > 0) await tx.insert(creditLedger).values(rows);
}

export async function lotLedgerMismatches(tx: TenantTx, workspaceId: string): Promise<{ lotId: string; remaining: number; ledgerSum: number }[]> {
  const rows = await tx.execute<{ lot_id: string; remaining: number; ledger_sum: number }>(sql`
    select l.id as lot_id, l.remaining, coalesce(sum(e.amount), 0)::int as ledger_sum
    from wp.credit_lots l left join wp.credit_ledger e on e.lot_id = l.id
    where l.workspace_id = ${workspaceId}
    group by l.id, l.remaining
    having l.remaining <> coalesce(sum(e.amount), 0)`);
  return rows.map((r) => ({ lotId: r.lot_id, remaining: r.remaining, ledgerSum: r.ledger_sum }));
}

// ── reservations ────────────────────────────────────────────────────────────
export async function sumHeld(tx: TenantTx, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${creditReservations.amount}), 0)::int` })
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held")));
  return rows[0]?.total ?? 0;
}

export async function insertReservation(tx: TenantTx, r: typeof creditReservations.$inferInsert): Promise<ReservationRow> {
  const rows = await tx.insert(creditReservations).values(r).returning();
  const row = rows[0];
  if (!row) throw new Error("reservation insert returned no row");
  return row;
}

export async function getReservationForUpdate(tx: TenantTx, workspaceId: string, id: string): Promise<ReservationRow | null> {
  const rows = await tx
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.id, id)))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

/** Guarded held → final transition; false if the reservation was no longer held. */
export async function finishReservation(tx: TenantTx, id: string, status: "committed" | "released" | "expired", at: Date): Promise<boolean> {
  const rows = await tx
    .update(creditReservations)
    .set(status === "committed" ? { status, committedAt: at } : { status, releasedAt: at })
    .where(and(eq(creditReservations.id, id), eq(creditReservations.status, "held")))
    .returning({ id: creditReservations.id });
  return rows.length === 1;
}

export async function extendReservation(tx: TenantTx, workspaceId: string, id: string, until: Date): Promise<boolean> {
  const rows = await tx
    .update(creditReservations)
    .set({ expiresAt: until })
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.id, id), eq(creditReservations.status, "held")))
    .returning({ id: creditReservations.id });
  return rows.length === 1;
}

export function abandonedReservations(tx: TenantTx, workspaceId: string, now: Date): Promise<ReservationRow[]> {
  return tx
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held"), lte(creditReservations.expiresAt, now)));
}

export async function countHeld(tx: TenantTx, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held")));
  return rows[0]?.n ?? 0;
}

// ── ledger history, payments, checkouts ────────────────────────────────────
export function ledgerPage(tx: TenantTx, workspaceId: string, cursor: LedgerCursor | null, limit: number) {
  return tx
    .select({
      id: creditLedger.id,
      kind: creditLedger.kind,
      amount: creditLedger.amount,
      action: creditLedger.action,
      note: creditLedger.note,
      createdAt: creditLedger.createdAt,
      lotSource: creditLots.source,
    })
    .from(creditLedger)
    .leftJoin(creditLots, eq(creditLots.id, creditLedger.lotId))
    .where(
      and(
        eq(creditLedger.workspaceId, workspaceId),
        cursor
          ? sql`(${creditLedger.createdAt}, ${creditLedger.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit + 1);
}

export async function insertPayment(tx: TenantTx, p: typeof billingPayments.$inferInsert): Promise<string | null> {
  const rows = await tx
    .insert(billingPayments)
    .values(p)
    .onConflictDoNothing({ target: billingPayments.paddleTransactionId })
    .returning({ id: billingPayments.id });
  return rows[0]?.id ?? null;
}

export function listPayments(tx: TenantTx, workspaceId: string): Promise<PaymentRow[]> {
  return tx.select().from(billingPayments).where(eq(billingPayments.workspaceId, workspaceId)).orderBy(desc(billingPayments.createdAt)).limit(24);
}

export async function insertCheckout(tx: TenantTx, c: typeof checkouts.$inferInsert): Promise<CheckoutRow> {
  const rows = await tx.insert(checkouts).values(c).returning();
  const row = rows[0];
  if (!row) throw new Error("checkout insert returned no row");
  return row;
}

export async function setCheckoutProvider(tx: TenantTx, workspaceId: string, id: string, providerCheckoutId: string, hostedUrl: string): Promise<void> {
  await tx.update(checkouts).set({ providerCheckoutId, hostedUrl }).where(and(eq(checkouts.workspaceId, workspaceId), eq(checkouts.id, id)));
}

export async function setCheckoutStatus(tx: TenantTx, workspaceId: string, id: string, status: "paid" | "failed" | "expired"): Promise<boolean> {
  const rows = await tx
    .update(checkouts)
    .set({ status })
    .where(and(eq(checkouts.workspaceId, workspaceId), eq(checkouts.id, id), eq(checkouts.status, "open")))
    .returning({ id: checkouts.id });
  return rows.length === 1;
}

/** Mock checkout pages run without a signed-in user; the worker role may read checkouts (SELECT-only policy). */
export async function getCheckoutById(tx: SystemTx, id: string): Promise<CheckoutRow | null> {
  const rows = await tx.select().from(checkouts).where(eq(checkouts.id, id)).limit(1);
  return rows[0] ?? null;
}

// ── webhooks ────────────────────────────────────────────────────────────────
export async function insertWebhookEvent(
  tx: SystemTx,
  e: { provider: string; providerEventId: string; eventType: string; payload: unknown },
): Promise<string | null> {
  const rows = await tx
    .insert(webhookEvents)
    .values(e)
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.providerEventId] })
    .returning({ id: webhookEvents.id });
  return rows[0]?.id ?? null;
}

export async function getWebhookEvent(tx: SystemTx, id: string) {
  const rows = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markWebhook(tx: SystemTx, id: string, error: string | null): Promise<void> {
  await tx
    .update(webhookEvents)
    .set(error ? { error: error.slice(0, 1000) } : { processedAt: sql`now()`, error: null })
    .where(eq(webhookEvents.id, id));
}

// ── due work (worker scans across workspaces; SELECT-only policies) ─────────
export async function dueWorkspaces(tx: SystemTx, job: BillingJob, now: Date, noticeDays: number): Promise<string[]> {
  const queries: Record<BillingJob, ReturnType<typeof sql>> = {
    release_abandoned: sql`select distinct workspace_id as id from wp.credit_reservations where status = 'held' and expires_at <= ${now}`,
    expire_lots: sql`select distinct workspace_id as id from wp.credit_lots where remaining > 0 and expires_at <= ${now}`,
    end_trials: sql`select workspace_id as id from wp.subscriptions where status = 'trialing' and trial_ends_at <= ${now}`,
    trial_notices: sql`select workspace_id as id from wp.subscriptions
      where status = 'trialing' and trial_ending_notified_at is null and trial_ends_at > ${now}
        and trial_ends_at <= ${now}::timestamptz + make_interval(days => ${noticeDays})`,
    monthly_grants: sql`select workspace_id as id from wp.subscriptions
      where status in ('active', 'past_due') and billing_interval = 'year' and next_credit_grant_at <= ${now}`,
    scheduled_changes: sql`select workspace_id as id from wp.subscriptions
      where scheduled_plan_id is not null and status in ('active', 'past_due') and current_period_end <= ${now}`,
    reconcile: sql`select distinct workspace_id as id from wp.credit_lots`,
    mock_renewals: sql`select workspace_id as id from wp.subscriptions
      where status in ('active', 'past_due') and current_period_end <= ${now} and paddle_subscription_id like 'sub_mock_%'`,
  };
  const rows = await tx.execute<{ id: string }>(queries[job]);
  return rows.map((r) => r.id);
}

// ── plan limits ─────────────────────────────────────────────────────────────
export async function incrementUsage(
  tx: TenantTx,
  workspaceId: string,
  key: "audience_views" | "outreach_emails",
  periodStart: string,
  limit: number | null,
): Promise<boolean> {
  if (limit === 0) return false;
  const rows = await tx.execute<{ count: number }>(sql`
    insert into wp.entitlement_usage (workspace_id, key, period_start, count)
    values (${workspaceId}, ${key}, ${periodStart}::date, 1)
    on conflict (workspace_id, key, period_start) do update
      set count = wp.entitlement_usage.count + 1
      where ${limit}::int is null or wp.entitlement_usage.count < ${limit}::int
    returning count`);
  return rows.length === 1;
}
```

- [ ] **Step 4: Implement the engine** — `apps/api/src/modules/billing/engine.ts`

```ts
import type { CreditAction, MeterState, SubscriptionStatus } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { writeOutbox, type TenantTx } from "@mushin/db";
import * as repo from "./repository";
import { allocateLots, InsufficientLotsError, lostAccessFor, meterAlert, meterState, monthStart, spendScope, type Allocation } from "./rules";

export type Actor = { userId: string | null; requestId: string | null };
export type SpendRequest = { action: CreditAction; confirmedCost: number; refType: string; refId: string };
export type GrantRequest = {
  source: repo.LotSource;
  amount: number;
  expiresAt: Date;
  sourceRef: string;
  paymentId?: string | null;
  note?: string | null;
};
export type Balance = {
  status: SubscriptionStatus | null;
  available: number;
  reserved: number;
  base: number;
  meter: MeterState;
  topupRemaining: number;
};

const FALLBACK_BASE = 1000;

export function createCreditEngine(o: { now?: () => Date } = {}) {
  const now = o.now ?? (() => new Date());

  async function baseFor(tx: TenantTx, sub: repo.SubscriptionRow | null, settings: repo.SettingsRow): Promise<number> {
    if (sub?.status === "trialing") return settings.trialCredits;
    if ((sub?.status === "active" || sub?.status === "past_due") && sub.planId) {
      const plan = await repo.getPlan(tx, sub.planId);
      if (plan) return plan.monthlyCredits;
    }
    const packs = await repo.listPacks(tx);
    return packs[0]?.credits ?? FALLBACK_BASE;
  }

  async function balance(tx: TenantTx, workspaceId: string): Promise<Balance> {
    const t = now();
    const settings = await repo.getSettings(tx);
    const sub = await repo.getSubscription(tx, workspaceId);
    const status = sub?.status ?? null;
    const scope = spendScope(status);
    const reserved = await repo.sumHeld(tx, workspaceId);
    const topupRemaining = await repo.sumRemaining(tx, workspaceId, t, ["topup"]);
    const spendable = scope === "all" ? await repo.sumRemaining(tx, workspaceId, t, "all") : scope === "topup_only" ? topupRemaining : 0;
    const available = Math.max(0, spendable - reserved);
    const base = await baseFor(tx, sub, settings);
    return {
      status,
      available,
      reserved,
      base,
      meter: meterState(available, base, { amberPct: settings.meterAmberPct, redPct: settings.meterRedPct }),
      topupRemaining,
    };
  }

  async function alertIfCrossed(tx: TenantTx, workspaceId: string, before: Balance, after: Balance, actor: Actor) {
    const alert = meterAlert(before.meter, after.meter);
    if (!alert) return;
    await writeOutbox(tx, {
      eventType: `notify.${alert}`,
      aggregateType: "workspace",
      aggregateId: workspaceId,
      workspaceId,
      payload: { available: after.available, base: after.base },
      requestId: actor.requestId,
    });
  }

  async function reserveLocked(tx: TenantTx, workspaceId: string, req: SpendRequest, actor: Actor) {
    const cost = await repo.getActionCost(tx, req.action);
    if (cost === 0) throw new AppError("VALIDATION_FAILED", "This action is free and is never charged");
    if (cost !== req.confirmedCost) {
      throw new AppError("CONFLICT", "The cost of this action has changed. Please review it and confirm again.", {
        confirmedCost: req.confirmedCost,
        currentCost: cost,
      });
    }
    const before = await balance(tx, workspaceId);
    const scope = spendScope(before.status);
    if (scope === "none" || (scope === "topup_only" && before.topupRemaining === 0)) {
      throw new AppError("ENTITLEMENT_REQUIRED", "Choose a plan to use credit actions.", {
        reason: "no_active_plan",
        lostAccess: lostAccessFor(before.status, before.topupRemaining),
      });
    }
    if (before.available < cost) {
      throw new AppError("INSUFFICIENT_CREDITS", "You don't have enough credits for this action.", { required: cost, available: before.available });
    }
    const settings = await repo.getSettings(tx);
    const t = now();
    const reservation = await repo.insertReservation(tx, {
      workspaceId,
      amount: cost,
      action: req.action,
      confirmedCost: req.confirmedCost,
      status: "held",
      expiresAt: new Date(t.getTime() + settings.reservationTtlMinutes * 60_000),
      refType: req.refType,
      refId: req.refId,
      createdAt: t,
    });
    await repo.insertLedger(tx, [
      { workspaceId, amount: cost, kind: "reserve", action: req.action, reservationId: reservation.id, actorUserId: actor.userId },
    ]);
    await alertIfCrossed(tx, workspaceId, before, await balance(tx, workspaceId), actor);
    return { reservationId: reservation.id, amount: cost };
  }

  async function commitLocked(tx: TenantTx, workspaceId: string, reservationId: string, actor: Actor) {
    const r = await repo.getReservationForUpdate(tx, workspaceId, reservationId);
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found");
    if (r.status === "committed") return;
    if (r.status !== "held") throw new AppError("CONFLICT", "This reservation was already released");
    const lots = await repo.lotsValidAt(tx, workspaceId, r.createdAt);
    let plan: Allocation[];
    try {
      plan = allocateLots(lots, r.amount);
    } catch (err) {
      if (err instanceof InsufficientLotsError) {
        throw new AppError("INTERNAL", "Credit lots cannot cover a held reservation", { reservationId }, { cause: err });
      }
      throw err;
    }
    for (const a of plan) await repo.takeFromLot(tx, a.lotId, a.take);
    await repo.insertLedger(
      tx,
      plan.map((a) => ({
        workspaceId,
        amount: -a.take,
        kind: "spend" as const,
        action: r.action,
        lotId: a.lotId,
        reservationId: r.id,
        actorUserId: actor.userId,
      })),
    );
    await repo.finishReservation(tx, r.id, "committed", now());
  }

  async function releaseLocked(
    tx: TenantTx,
    workspaceId: string,
    reservationId: string,
    reason: string,
    actor: Actor,
    status: "released" | "expired",
  ) {
    const r = await repo.getReservationForUpdate(tx, workspaceId, reservationId);
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found");
    if (r.status === "committed") throw new AppError("CONFLICT", "This reservation was already spent");
    if (r.status !== "held") return;
    await repo.finishReservation(tx, r.id, status, now());
    await repo.insertLedger(tx, [
      { workspaceId, amount: r.amount, kind: "release", action: r.action, reservationId: r.id, actorUserId: actor.userId, note: reason.slice(0, 200) },
    ]);
  }

  async function grantLocked(tx: TenantTx, workspaceId: string, g: GrantRequest): Promise<string | null> {
    if (!Number.isInteger(g.amount) || g.amount <= 0) throw new Error("grant amount must be a positive integer");
    if (await repo.hasGrant(tx, workspaceId, g.sourceRef)) return null;
    const lotId = await repo.insertLot(tx, { workspaceId, source: g.source, amount: g.amount, expiresAt: g.expiresAt, paymentId: g.paymentId ?? null });
    await repo.insertLedger(tx, [{ workspaceId, amount: g.amount, kind: "grant", lotId, sourceRef: g.sourceRef, note: g.note ?? null }]);
    return lotId;
  }

  async function expireLocked(tx: TenantTx, workspaceId: string): Promise<number> {
    if ((await repo.countHeld(tx, workspaceId)) > 0) return 0; // a running job may still need these credits
    const lots = await repo.expiredLots(tx, workspaceId, now());
    for (const lot of lots) {
      await repo.insertLedger(tx, [{ workspaceId, amount: -lot.remaining, kind: "expire", lotId: lot.id, note: "Expired" }]);
      await repo.zeroLot(tx, lot.id);
    }
    return lots.length;
  }

  const locked =
    <A extends unknown[], R>(fn: (tx: TenantTx, workspaceId: string, ...args: A) => Promise<R>) =>
    async (tx: TenantTx, workspaceId: string, ...args: A): Promise<R> => {
      await repo.lockCredits(tx, workspaceId);
      return fn(tx, workspaceId, ...args);
    };

  return {
    balance,
    reserve: locked(reserveLocked),
    commit: locked(commitLocked),
    release: locked((tx, workspaceId, reservationId: string, reason: string, actor: Actor) =>
      releaseLocked(tx, workspaceId, reservationId, reason, actor, "released"),
    ),
    spendInstant: locked(async (tx, workspaceId, req: SpendRequest, actor: Actor) => {
      const held = await reserveLocked(tx, workspaceId, req, actor);
      await commitLocked(tx, workspaceId, held.reservationId, actor);
      return held;
    }),
    extend: locked(async (tx, workspaceId, reservationId: string) => {
      const settings = await repo.getSettings(tx);
      const until = new Date(now().getTime() + settings.reservationTtlMinutes * 60_000);
      if (!(await repo.extendReservation(tx, workspaceId, reservationId, until))) {
        throw new AppError("CONFLICT", "This reservation is no longer held");
      }
    }),
    grant: locked(grantLocked),
    startTrial: locked(async (tx, workspaceId) => {
      const settings = await repo.getSettings(tx);
      const trialEndsAt = new Date(now().getTime() + settings.trialDays * 86_400_000);
      if (!(await repo.insertTrialSubscription(tx, workspaceId, trialEndsAt))) return;
      await grantLocked(tx, workspaceId, {
        source: "trial",
        amount: settings.trialCredits,
        expiresAt: trialEndsAt,
        sourceRef: `trial:${workspaceId}`,
        note: "Free trial credits",
      });
    }),
    expireLots: locked(expireLocked),
    endLots: locked(async (tx, workspaceId, source: repo.LotSource) => {
      await repo.endLotsOfSource(tx, workspaceId, source, now());
      await expireLocked(tx, workspaceId);
    }),
    releaseAbandoned: locked(async (tx, workspaceId) => {
      const rows = await repo.abandonedReservations(tx, workspaceId, now());
      for (const r of rows) await releaseLocked(tx, workspaceId, r.id, "Abandoned: the job stopped renewing its hold", { userId: null, requestId: null }, "expired");
      return rows.length;
    }),
    reconcile: (tx: TenantTx, workspaceId: string) => repo.lotLedgerMismatches(tx, workspaceId),
    useEntitlement: locked((tx, workspaceId, key: "audience_views" | "outreach_emails", limit: number | null) =>
      repo.incrementUsage(tx, workspaceId, key, monthStart(now()), limit),
    ),
  };
}

export type CreditEngine = ReturnType<typeof createCreditEngine>;
```

Create `apps/api/src/modules/billing/index.ts` (extended in later tasks):
```ts
export { createCreditEngine } from "./engine";
export type { Actor, Balance, CreditEngine, GrantRequest, SpendRequest } from "./engine";
```

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
Run: `npm run test:int` → expected PASS (engine 13 tests). If `TEST_DATABASE_URL` is still missing, record that the integration tests did not run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing
git commit -m "feat(billing): add credit engine with reservations, ledger, expiry and reconciliation"
```

---

### Task 6: Start the trial during provisioning

**Files:**
- Modify: `apps/api/src/modules/identity/index.ts`, `apps/api/src/modules/identity/service.ts`, `apps/api/src/modules/identity/identity.int.test.ts`, `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `createCreditEngine().startTrial` (Task 5).
- Produces: `type StartTrial = (tx: TenantTx, workspaceId: string) => Promise<void>`; `createIdentityModule(o: { db: Db; startTrial: StartTrial })`.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/modules/identity/identity.int.test.ts`, replace `const identity = createIdentityModule({ db });` with:
```ts
import { createCreditEngine } from "../billing/index";
// …
const identity = createIdentityModule({ db, startTrial: createCreditEngine().startTrial });
```
and add inside `describe("identity provisioning", …)`:
```ts
  it("starts the 14-day, 200-credit trial in the same transaction, once", async () => {
    const who = person();
    await Promise.all([identity.resolveTenant(who, "a"), identity.resolveTenant(who, "b"), identity.resolveTenant(who, "c")]);
    const rows = await ownerQuery<{ status: string; days: number; lots: number; credits: number }>(`
      select s.status, round(extract(epoch from (s.trial_ends_at - s.created_at)) / 86400)::int as days,
             (select count(*)::int from wp.credit_lots) as lots, (select sum(remaining)::int from wp.credit_lots) as credits
      from wp.subscriptions s`);
    expect(rows).toEqual([{ status: "trialing", days: 14, lots: 1, credits: 200 }]);
  });
```

- [ ] **Step 2: Confirm it fails**

Run: `npx tsc -p tsconfig.json` → FAIL (`startTrial` is not a known property of the identity module options).

- [ ] **Step 3: Implement**

`apps/api/src/modules/identity/service.ts`: change the signature and call the trial after the owner membership is inserted:
```ts
import type { Db, TenantTx } from "@mushin/db";
// …
export type StartTrial = (tx: TenantTx, workspaceId: string) => Promise<void>;

export function createIdentityService(db: Db, startTrial: StartTrial) {
```
and inside the provisioning transaction, directly after `await repo.insertMember(tx, { workspaceId, userId: identity.userId, role: "owner" });` add:
```ts
      await startTrial(tx, workspaceId);
```

`apps/api/src/modules/identity/index.ts`:
```ts
import type { Db } from "@mushin/db";
import type { ResolveTenant } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { registerIdentityRoutes } from "./routes";
import { createIdentityService, type StartTrial } from "./service";

export type { StartTrial };

export function createIdentityModule(o: { db: Db; startTrial: StartTrial }): { resolveTenant: ResolveTenant; module: AppModule } {
  const service = createIdentityService(o.db, o.startTrial);
  return {
    resolveTenant: service.resolveTenant,
    module: { name: "identity", register: (app, guards) => registerIdentityRoutes(app, guards, service) },
  };
}
```

`apps/api/src/server.ts`: add `import { createCreditEngine } from "./modules/billing";` and change the identity line to:
```ts
const identity = createIdentityModule({ db, startTrial: createCreditEngine().startTrial });
```
(Task 10 replaces this with the billing service.)

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass. Run `npm run test:int` → identity tests (6) pass, or record that they did not run.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/identity apps/api/src/server.ts
git commit -m "feat(identity): start the billing trial when a workspace is provisioned"
```

---
### Task 7: Payment adapter (signatures, Paddle events, mock and real Paddle)

**Files:**
- Create: `packages/integrations/src/payments/types.ts`, `signature.ts`, `paddle-events.ts`, `mock.ts`, `paddle.ts`, `index.ts`, `payments.test.ts` (all under `packages/integrations/src/payments/`)
- Modify: `packages/integrations/src/index.ts` (add `export * from "./payments";`)

**Interfaces:**
- Consumes: `instrumented` (sub-project 1), `PaymentsConfig`, `ProviderCallSink`, `Logger` (core).
- Produces (from `@mushin/integrations`):
  ```ts
  type PaymentInterval = "month" | "year";
  type PriceRef = { priceId: string; interval: PaymentInterval | null; amountMinor: number; currency: string };
  type SubscriptionRef = { subscriptionId: string; customerId: string | null; workspaceId: string; price: PriceRef; periodStart: Date; periodEnd: Date };
  type SubscriptionSnapshot = { subscriptionId: string; customerId: string | null; status: "active" | "past_due" | "canceled" | "trialing" | "paused"; priceId: string; periodStart: Date | null; periodEnd: Date | null; cancelScheduled: boolean };
  type PaymentEvent =
    | { kind: "transaction.completed"; eventId; occurredAt: Date; workspaceId; transactionId; subscriptionId: string | null; checkoutId: string | null; priceId; amountMinor: number; currency; invoiceUrl: string | null }
    | { kind: "transaction.payment_failed"; eventId; occurredAt; workspaceId; transactionId; checkoutId: string | null }
    | { kind: "subscription.created" | "subscription.activated" | "subscription.updated" | "subscription.past_due" | "subscription.canceled"; eventId; occurredAt; workspaceId; subscription: SubscriptionSnapshot }
    | { kind: "ignored"; eventId: string; occurredAt: Date; eventType: string };
  interface Payments {
    readonly mode: "mock" | "paddle";
    createCheckout(i: { checkoutId: string; workspaceId: string; customerEmail: string; price: PriceRef }): Promise<{ providerCheckoutId: string; url: string }>;
    changePlan(i: { subscription: SubscriptionRef; target: PriceRef }): Promise<void>;
    cancelAtPeriodEnd(i: { subscription: SubscriptionRef }): Promise<void>;
    verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent;   // throws WebhookSignatureError / WebhookPayloadError
  }
  class WebhookSignatureError extends Error; class WebhookPayloadError extends Error
  signPaddleWebhook(secret: string, rawBody: string, at: Date): string
  verifyPaddleSignature(header: string | undefined, rawBody: string, secret: string, now: Date, toleranceSeconds?: number): void
  parsePaddleEvent(payload: unknown): PaymentEvent
  type Deliver = (rawBody: string, signature: string) => Promise<void>;
  type MockCheckout = { checkoutId: string; workspaceId: string; kind: "subscription" | "topup"; price: PriceRef };
  class MockPayments implements Payments {
    constructor(o: { webhookSecret: string; publicApiUrl: string; deliver?: Deliver; now?: () => Date });
    completeCheckout(c: MockCheckout, outcome: "paid" | "failed"): Promise<void>;
    renew(subscription: SubscriptionRef, cancel: boolean): Promise<void>;
  }
  isMockPayments(p: Payments): p is MockPayments
  class PaddlePayments implements Payments { constructor(o: { apiKey; webhookSecret; environment: "sandbox" | "production"; sink; logger; fetch?: typeof fetch; now?: () => Date }) }
  createPayments(config: PaymentsConfig, deps: { sink: ProviderCallSink; logger: Logger }): Payments
  ```

- [ ] **Step 1: Write the failing tests** — `packages/integrations/src/payments/payments.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { MockPayments, PaddlePayments, parsePaddleEvent, signPaddleWebhook, verifyPaddleSignature, WebhookSignatureError } from "./index";

const SECRET = "s".repeat(40);
const WS = "0b7d7c3e-5d1a-4f7e-8c2b-9a1e3f4d5c6b";
const CHECKOUT = "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10";
const at = new Date("2026-10-07T10:00:00Z");
const growthMonth = { priceId: "pri_mock_growth_month", interval: "month" as const, amountMinor: 4600, currency: "USD" };

function capture(now = () => at) {
  const sent: { raw: string; sig: string }[] = [];
  const mock = new MockPayments({ webhookSecret: SECRET, publicApiUrl: "http://api.test", now, deliver: async (raw, sig) => void sent.push({ raw, sig }) });
  const events = () => sent.map((s) => mock.verifyWebhook(s.raw, s.sig));
  return { mock, sent, events };
}

describe("Paddle-Signature", () => {
  it("accepts a valid signature and rejects tampering, stale timestamps, wrong secrets and garbage", () => {
    const body = '{"a":1}';
    const header = signPaddleWebhook(SECRET, body, at);
    expect(() => verifyPaddleSignature(header, body, SECRET, at)).not.toThrow();
    expect(() => verifyPaddleSignature(header, '{"a":2}', SECRET, at)).toThrow(WebhookSignatureError);
    expect(() => verifyPaddleSignature(header, body, SECRET, new Date(at.getTime() + 301_000))).toThrow(/stale/);
    expect(() => verifyPaddleSignature(header, body, "x".repeat(40), at)).toThrow(/mismatch/);
    expect(() => verifyPaddleSignature(undefined, body, SECRET, at)).toThrow(/missing/);
    expect(() => verifyPaddleSignature("ts=abc;h1=zz", body, SECRET, at)).toThrow(/malformed/);
  });
});

describe("parsePaddleEvent", () => {
  it("reads completed transactions and subscriptions, and ignores what it does not handle", () => {
    expect(
      parsePaddleEvent({
        event_id: "evt_1",
        event_type: "transaction.completed",
        occurred_at: "2026-10-07T10:00:00.123456Z",
        data: {
          id: "txn_1",
          subscription_id: null,
          custom_data: { workspaceId: WS, checkoutId: CHECKOUT },
          items: [{ price: { id: "pri_mock_credits_1000" }, quantity: 1 }],
          currency_code: "USD",
          details: { totals: { grand_total: "900" } },
        },
      }),
    ).toMatchObject({ kind: "transaction.completed", workspaceId: WS, checkoutId: CHECKOUT, priceId: "pri_mock_credits_1000", amountMinor: 900, subscriptionId: null });

    expect(
      parsePaddleEvent({
        event_id: "evt_2",
        event_type: "subscription.updated",
        occurred_at: "2026-10-07T10:00:00Z",
        data: {
          id: "sub_1",
          status: "active",
          customer_id: "ctm_1",
          custom_data: { workspaceId: WS },
          items: [{ price: { id: "pri_mock_growth_month" } }],
          current_billing_period: { starts_at: "2026-10-07T10:00:00Z", ends_at: "2026-11-07T10:00:00Z" },
          scheduled_change: { action: "cancel", effective_at: "2026-11-07T10:00:00Z" },
        },
      }),
    ).toMatchObject({ kind: "subscription.updated", subscription: { subscriptionId: "sub_1", priceId: "pri_mock_growth_month", cancelScheduled: true } });

    expect(parsePaddleEvent({ event_id: "evt_3", event_type: "customer.created", occurred_at: "2026-10-07T10:00:00Z", data: {} })).toMatchObject({
      kind: "ignored",
      eventType: "customer.created",
    });
    // A transaction MUSHIN did not start (no workspace in custom_data) is ignored, not retried forever.
    expect(
      parsePaddleEvent({ event_id: "evt_4", event_type: "transaction.completed", occurred_at: "2026-10-07T10:00:00Z", data: { id: "txn_x", custom_data: null } }),
    ).toMatchObject({ kind: "ignored" });
  });
});

describe("MockPayments", () => {
  it("hosts the checkout on its own route", async () => {
    const { mock } = capture();
    expect(await mock.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).toEqual({
      providerCheckoutId: `chk_mock_${CHECKOUT}`,
      url: `http://api.test/mock-paddle/checkout/${CHECKOUT}`,
    });
  });

  it("pays a subscription with signed transaction and subscription events, one billing month long", async () => {
    const { mock, events } = capture();
    await mock.completeCheckout({ checkoutId: CHECKOUT, workspaceId: WS, kind: "subscription", price: growthMonth }, "paid");
    const [txn, sub] = events();
    expect(txn).toMatchObject({ kind: "transaction.completed", subscriptionId: `sub_mock_${CHECKOUT}`, checkoutId: CHECKOUT, amountMinor: 4600 });
    expect(sub).toMatchObject({
      kind: "subscription.created",
      workspaceId: WS,
      subscription: { subscriptionId: `sub_mock_${CHECKOUT}`, status: "active", priceId: "pri_mock_growth_month", cancelScheduled: false },
    });
    if (sub?.kind !== "subscription.created") throw new Error("expected a subscription event");
    expect(sub.subscription.periodEnd?.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("reports failed payments, plan changes, scheduled cancellation and renewals", async () => {
    const { mock, events } = capture();
    await mock.completeCheckout({ checkoutId: CHECKOUT, workspaceId: WS, kind: "topup", price: { ...growthMonth, interval: null } }, "failed");
    const ref = { subscriptionId: "sub_mock_1", customerId: "ctm_1", workspaceId: WS, price: growthMonth, periodStart: at, periodEnd: new Date("2026-11-07T10:00:00Z") };
    await mock.changePlan({ subscription: ref, target: { ...growthMonth, priceId: "pri_mock_scale_month" } });
    await mock.cancelAtPeriodEnd({ subscription: ref });
    await mock.renew(ref, false);
    await mock.renew(ref, true);
    expect(events().map((e) => e.kind)).toEqual([
      "transaction.payment_failed",
      "subscription.updated",
      "subscription.updated",
      "transaction.completed",
      "subscription.updated",
      "subscription.canceled",
    ]);
    const [, change, cancel, , renewal] = events();
    expect(change).toMatchObject({ subscription: { priceId: "pri_mock_scale_month" } });
    expect(cancel).toMatchObject({ subscription: { cancelScheduled: true } });
    if (renewal?.kind !== "subscription.updated") throw new Error("expected a renewal");
    expect(renewal.subscription.periodStart?.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });
});

describe("PaddlePayments", () => {
  function paddle(respond: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return respond(url, init ?? {});
    };
    const p = new PaddlePayments({
      apiKey: "pdl_key",
      webhookSecret: SECRET,
      environment: "sandbox",
      sink: new MemoryProviderCallSink(),
      logger: createLogger({ level: "silent" }),
      fetch: fetchFake as typeof fetch,
    });
    return { p, calls };
  }

  it("creates a transaction with our ids in custom_data and returns Paddle's hosted checkout URL", async () => {
    const { p, calls } = paddle(() => Response.json({ data: { id: "txn_9", checkout: { url: "https://pay.paddle.io/txn_9" } } }));
    expect(await p.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).toEqual({
      providerCheckoutId: "txn_9",
      url: "https://pay.paddle.io/txn_9",
    });
    expect(calls[0]?.url).toBe("https://sandbox-api.paddle.com/transactions");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ custom_data: { workspaceId: WS, checkoutId: CHECKOUT }, items: [{ price_id: "pri_mock_growth_month" }] });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer pdl_key");
  });

  it("does not retry a failed checkout creation and reports the provider as unavailable", async () => {
    const { p, calls } = paddle(() => new Response("boom", { status: 500 }));
    await expect(p.createCheckout({ checkoutId: CHECKOUT, workspaceId: WS, customerEmail: "a@b.pk", price: growthMonth })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(calls).toHaveLength(1);
  });

  it("schedules cancellation at the next billing period", async () => {
    const { p, calls } = paddle(() => Response.json({ data: {} }));
    const ref = { subscriptionId: "sub_1", customerId: null, workspaceId: WS, price: growthMonth, periodStart: at, periodEnd: at };
    await p.cancelAtPeriodEnd({ subscription: ref });
    expect(calls[0]?.url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_1/cancel");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ effective_from: "next_billing_period" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit packages/integrations/src/payments`
Expected: FAIL, cannot find `./index`.

- [ ] **Step 3: Implement** — `packages/integrations/src/payments/types.ts`

```ts
export type PaymentInterval = "month" | "year";
export type PriceRef = { priceId: string; interval: PaymentInterval | null; amountMinor: number; currency: string };
export type SubscriptionRef = {
  subscriptionId: string;
  customerId: string | null;
  workspaceId: string;
  price: PriceRef;
  periodStart: Date;
  periodEnd: Date;
};
export type SubscriptionSnapshot = {
  subscriptionId: string;
  customerId: string | null;
  status: "active" | "past_due" | "canceled" | "trialing" | "paused";
  priceId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelScheduled: boolean;
};

type EventBase = { eventId: string; occurredAt: Date; workspaceId: string };
export const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.past_due",
  "subscription.canceled",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export type PaymentEvent =
  | (EventBase & {
      kind: "transaction.completed";
      transactionId: string;
      subscriptionId: string | null;
      checkoutId: string | null;
      priceId: string;
      amountMinor: number;
      currency: string;
      invoiceUrl: string | null;
    })
  | (EventBase & { kind: "transaction.payment_failed"; transactionId: string; checkoutId: string | null })
  | (EventBase & { kind: SubscriptionEventType; subscription: SubscriptionSnapshot })
  | { kind: "ignored"; eventId: string; occurredAt: Date; eventType: string };

export interface Payments {
  readonly mode: "mock" | "paddle";
  createCheckout(input: { checkoutId: string; workspaceId: string; customerEmail: string; price: PriceRef }): Promise<{ providerCheckoutId: string; url: string }>;
  changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void>;
  cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent;
}
```

`packages/integrations/src/payments/signature.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const hmac = (secret: string, ts: number, rawBody: string) => createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");

/** Paddle's scheme: `ts=<unix seconds>;h1=<hex HMAC-SHA256(secret, ts + ":" + rawBody)>`. */
export function signPaddleWebhook(secret: string, rawBody: string, at: Date): string {
  const ts = Math.floor(at.getTime() / 1000);
  return `ts=${ts};h1=${hmac(secret, ts, rawBody)}`;
}

export function verifyPaddleSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  now: Date,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): void {
  if (!header) throw new WebhookSignatureError("missing Paddle-Signature header");
  let ts: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "ts" && value && /^\d{1,12}$/.test(value)) ts = Number(value);
    else if (key === "h1" && value && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (ts === null || signatures.length === 0) throw new WebhookSignatureError("malformed Paddle-Signature header");
  if (Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) throw new WebhookSignatureError("stale webhook timestamp");
  const expected = Buffer.from(hmac(secret, ts, rawBody), "hex");
  const ok = signatures.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookSignatureError("signature mismatch");
}
```

`packages/integrations/src/payments/paddle-events.ts`:
```ts
import { z } from "zod";
import { SUBSCRIPTION_EVENT_TYPES, type PaymentEvent, type SubscriptionEventType } from "./types";

export class WebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookPayloadError";
  }
}

const timestamp = z.iso.datetime({ offset: true });
const envelope = z.object({ event_id: z.string().min(1), event_type: z.string().min(1), occurred_at: timestamp, data: z.unknown() });
const customData = z.object({ workspaceId: z.uuid(), checkoutId: z.uuid().nullish() });
const withCustomData = z.object({ custom_data: customData });
const items = z.array(z.object({ price: z.object({ id: z.string().min(1) }) })).min(1);

const transaction = z.object({
  id: z.string().min(1),
  subscription_id: z.string().nullish(),
  items,
  currency_code: z.string().length(3),
  details: z.object({ totals: z.object({ grand_total: z.string().regex(/^\d+$/) }) }),
  invoice_url: z.string().nullish(),
});
const failedTransaction = z.object({ id: z.string().min(1) });
const subscription = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "past_due", "canceled", "trialing", "paused"]),
  customer_id: z.string().nullish(),
  items,
  current_billing_period: z.object({ starts_at: timestamp, ends_at: timestamp }).nullish(),
  scheduled_change: z.object({ action: z.string() }).nullish(),
});

function parseData<S extends z.ZodType>(schema: S, data: unknown, type: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new WebhookPayloadError(`unexpected ${type} payload: ${result.error.issues[0]?.message ?? "invalid"}`);
  return result.data;
}

function firstPrice(list: { price: { id: string } }[]): string {
  const id = list[0]?.price.id;
  if (!id) throw new WebhookPayloadError("event has no price");
  return id;
}

const isSubscriptionEvent = (type: string): type is SubscriptionEventType => (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(type);

/** Turns a verified Paddle webhook body into a PaymentEvent. Events MUSHIN did not start (no workspace in custom_data) are ignored. */
export function parsePaddleEvent(payload: unknown): PaymentEvent {
  const env = envelope.safeParse(payload);
  if (!env.success) throw new WebhookPayloadError("not a Paddle event");
  const { event_id: eventId, event_type: type, occurred_at: occurredAtRaw, data } = env.data;
  const occurredAt = new Date(occurredAtRaw);
  const handled = type === "transaction.completed" || type === "transaction.payment_failed" || isSubscriptionEvent(type);
  const owner = withCustomData.safeParse(data);
  if (!handled || !owner.success) return { kind: "ignored", eventId, occurredAt, eventType: type };
  const { workspaceId, checkoutId } = owner.data.custom_data;

  if (type === "transaction.completed") {
    const t = parseData(transaction, data, type);
    return {
      kind: type,
      eventId,
      occurredAt,
      workspaceId,
      transactionId: t.id,
      subscriptionId: t.subscription_id ?? null,
      checkoutId: checkoutId ?? null,
      priceId: firstPrice(t.items),
      amountMinor: Number(t.details.totals.grand_total),
      currency: t.currency_code,
      invoiceUrl: t.invoice_url ?? null,
    };
  }
  if (type === "transaction.payment_failed") {
    const t = parseData(failedTransaction, data, type);
    return { kind: type, eventId, occurredAt, workspaceId, transactionId: t.id, checkoutId: checkoutId ?? null };
  }
  const s = parseData(subscription, data, type);
  return {
    kind: type,
    eventId,
    occurredAt,
    workspaceId,
    subscription: {
      subscriptionId: s.id,
      customerId: s.customer_id ?? null,
      status: s.status,
      priceId: firstPrice(s.items),
      periodStart: s.current_billing_period ? new Date(s.current_billing_period.starts_at) : null,
      periodEnd: s.current_billing_period ? new Date(s.current_billing_period.ends_at) : null,
      cancelScheduled: s.scheduled_change?.action === "cancel",
    },
  };
}
```

`packages/integrations/src/payments/mock.ts`:
```ts
import { randomUUID } from "node:crypto";
import { parsePaddleEvent } from "./paddle-events";
import { signPaddleWebhook, verifyPaddleSignature } from "./signature";
import type { PaymentEvent, PaymentInterval, Payments, PriceRef, SubscriptionRef } from "./types";

export type Deliver = (rawBody: string, signature: string) => Promise<void>;
export type MockCheckout = { checkoutId: string; workspaceId: string; kind: "subscription" | "topup"; price: PriceRef };
type PaddlePayload = { event_id: string; event_type: string; occurred_at: string; notification_id: string; data: Record<string, unknown> };

function addInterval(date: Date, interval: PaymentInterval): Date {
  const months = interval === "year" ? 12 : 1;
  const day = date.getUTCDate();
  const out = new Date(date.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

const customerIdFor = (workspaceId: string) => `ctm_mock_${workspaceId.slice(0, 8)}`;

async function postWebhook(url: string, rawBody: string, signature: string): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "paddle-signature": signature }, body: rawBody });
  if (!res.ok) throw new Error(`mock webhook delivery to ${url} failed with ${res.status}`);
}

/**
 * Development stand-in for Paddle. It hosts a test-mode checkout page (served by the API's mock routes)
 * and sends the same signed, Paddle-format webhooks Paddle would, so the rest of MUSHIN cannot tell the difference.
 */
export class MockPayments implements Payments {
  readonly mode = "mock" as const;
  private readonly now: () => Date;
  private readonly deliver: Deliver;

  constructor(private readonly o: { webhookSecret: string; publicApiUrl: string; deliver?: Deliver; now?: () => Date }) {
    this.now = o.now ?? (() => new Date());
    this.deliver = o.deliver ?? ((raw, sig) => postWebhook(`${o.publicApiUrl}/webhooks/paddle`, raw, sig));
  }

  async createCheckout(input: { checkoutId: string }): Promise<{ providerCheckoutId: string; url: string }> {
    return { providerCheckoutId: `chk_mock_${input.checkoutId}`, url: `${this.o.publicApiUrl}/mock-paddle/checkout/${input.checkoutId}` };
  }

  async changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void> {
    const start = this.now();
    const next = { ...input.subscription, price: input.target, periodStart: start, periodEnd: addInterval(start, input.target.interval ?? "month") };
    await this.send(this.subscriptionEvent("subscription.updated", next, "active", false, null));
  }

  async cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void> {
    await this.send(this.subscriptionEvent("subscription.updated", input.subscription, "active", true, null));
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    verifyPaddleSignature(signatureHeader, rawBody, this.o.webhookSecret, this.now());
    return parsePaddleEvent(JSON.parse(rawBody) as unknown);
  }

  /** The hosted test page's "Pay" and "Simulate failed payment" buttons. */
  async completeCheckout(c: MockCheckout, outcome: "paid" | "failed"): Promise<void> {
    const transactionId = `txn_mock_${randomUUID()}`;
    if (outcome === "failed") {
      await this.send(this.payload("transaction.payment_failed", { id: transactionId, status: "past_due", custom_data: { workspaceId: c.workspaceId, checkoutId: c.checkoutId } }));
      return;
    }
    const subscriptionId = c.kind === "subscription" ? `sub_mock_${c.checkoutId}` : null;
    await this.send(this.transactionEvent(transactionId, c.workspaceId, c.checkoutId, subscriptionId, c.price));
    if (subscriptionId) {
      const start = this.now();
      const ref: SubscriptionRef = {
        subscriptionId,
        customerId: customerIdFor(c.workspaceId),
        workspaceId: c.workspaceId,
        price: c.price,
        periodStart: start,
        periodEnd: addInterval(start, c.price.interval ?? "month"),
      };
      await this.send(this.subscriptionEvent("subscription.created", ref, "active", false, c.checkoutId));
    }
  }

  /** Period-end renewal (Paddle renews by itself in real mode). A scheduled cancellation ends the subscription instead. */
  async renew(subscription: SubscriptionRef, cancel: boolean): Promise<void> {
    if (cancel) {
      await this.send(this.subscriptionEvent("subscription.canceled", subscription, "canceled", false, null));
      return;
    }
    const start = subscription.periodEnd;
    const next = { ...subscription, periodStart: start, periodEnd: addInterval(start, subscription.price.interval ?? "month") };
    await this.send(this.transactionEvent(`txn_mock_${randomUUID()}`, subscription.workspaceId, null, subscription.subscriptionId, subscription.price));
    await this.send(this.subscriptionEvent("subscription.updated", next, "active", false, null));
  }

  private payload(type: string, data: Record<string, unknown>): PaddlePayload {
    return { event_id: `evt_mock_${randomUUID()}`, event_type: type, occurred_at: this.now().toISOString(), notification_id: `ntf_mock_${randomUUID()}`, data };
  }

  private transactionEvent(id: string, workspaceId: string, checkoutId: string | null, subscriptionId: string | null, price: PriceRef): PaddlePayload {
    return this.payload("transaction.completed", {
      id,
      status: "completed",
      subscription_id: subscriptionId,
      customer_id: customerIdFor(workspaceId),
      currency_code: price.currency,
      custom_data: { workspaceId, checkoutId },
      items: [{ price: { id: price.priceId }, quantity: 1 }],
      details: { totals: { grand_total: String(price.amountMinor) } },
      invoice_url: null,
    });
  }

  private subscriptionEvent(
    type: "subscription.created" | "subscription.updated" | "subscription.canceled",
    s: SubscriptionRef,
    status: "active" | "canceled",
    cancelScheduled: boolean,
    checkoutId: string | null,
  ): PaddlePayload {
    return this.payload(type, {
      id: s.subscriptionId,
      status,
      customer_id: s.customerId ?? customerIdFor(s.workspaceId),
      custom_data: { workspaceId: s.workspaceId, checkoutId },
      items: [{ price: { id: s.price.priceId }, quantity: 1 }],
      current_billing_period: { starts_at: s.periodStart.toISOString(), ends_at: s.periodEnd.toISOString() },
      scheduled_change: cancelScheduled ? { action: "cancel", effective_at: s.periodEnd.toISOString() } : null,
    });
  }

  private async send(p: PaddlePayload): Promise<void> {
    const raw = JSON.stringify(p);
    await this.deliver(raw, signPaddleWebhook(this.o.webhookSecret, raw, this.now()));
  }
}

export function isMockPayments(p: Payments): p is MockPayments {
  return p instanceof MockPayments;
}
```

`packages/integrations/src/payments/paddle.ts`:
```ts
import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { parsePaddleEvent } from "./paddle-events";
import { verifyPaddleSignature } from "./signature";
import type { PaymentEvent, Payments, PriceRef, SubscriptionRef } from "./types";

type PaddleOptions = {
  apiKey: string;
  webhookSecret: string;
  environment: "sandbox" | "production";
  sink: ProviderCallSink;
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => Date;
};

/** Paddle Billing API. Writes are never retried automatically (a retry could create a second transaction). */
export class PaddlePayments implements Payments {
  readonly mode = "paddle" as const;
  private readonly base: string;

  constructor(private readonly o: PaddleOptions) {
    this.base = o.environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  }

  private call<T>(operation: string, method: "GET" | "POST" | "PATCH", path: string, body: unknown, workspaceId: string): Promise<T> {
    const doFetch = this.o.fetch ?? fetch;
    return instrumented(
      { provider: "paddle", operation, timeoutMs: 10_000, retries: method === "GET" ? 2 : 0, sink: this.o.sink, logger: this.o.logger, ctx: { workspaceId } },
      async (signal) => {
        const res = await doFetch(`${this.base}${path}`, {
          method,
          signal,
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Paddle ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
        return (text ? JSON.parse(text) : {}) as T;
      },
    );
  }

  async createCheckout(input: { checkoutId: string; workspaceId: string; price: PriceRef }): Promise<{ providerCheckoutId: string; url: string }> {
    const res = await this.call<{ data?: { id?: string; checkout?: { url?: string | null } | null } }>(
      "create_checkout",
      "POST",
      "/transactions",
      { items: [{ price_id: input.price.priceId, quantity: 1 }], custom_data: { workspaceId: input.workspaceId, checkoutId: input.checkoutId } },
      input.workspaceId,
    );
    const id = res.data?.id;
    const url = res.data?.checkout?.url;
    if (!id || !url) throw new Error("Paddle returned no checkout URL; set a default payment link in the Paddle dashboard");
    return { providerCheckoutId: id, url };
  }

  async changePlan(input: { subscription: SubscriptionRef; target: PriceRef }): Promise<void> {
    await this.call(
      "change_plan",
      "PATCH",
      `/subscriptions/${encodeURIComponent(input.subscription.subscriptionId)}`,
      { items: [{ price_id: input.target.priceId, quantity: 1 }], proration_billing_mode: "prorated_immediately" },
      input.subscription.workspaceId,
    );
  }

  async cancelAtPeriodEnd(input: { subscription: SubscriptionRef }): Promise<void> {
    await this.call(
      "cancel",
      "POST",
      `/subscriptions/${encodeURIComponent(input.subscription.subscriptionId)}/cancel`,
      { effective_from: "next_billing_period" },
      input.subscription.workspaceId,
    );
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): PaymentEvent {
    verifyPaddleSignature(signatureHeader, rawBody, this.o.webhookSecret, (this.o.now ?? (() => new Date()))());
    return parsePaddleEvent(JSON.parse(rawBody) as unknown);
  }
}
```

`packages/integrations/src/payments/index.ts`:
```ts
import type { Logger, PaymentsConfig, ProviderCallSink } from "@mushin/core";
import { MockPayments } from "./mock";
import { PaddlePayments } from "./paddle";
import type { Payments } from "./types";

export * from "./types";
export * from "./signature";
export * from "./paddle-events";
export * from "./mock";
export * from "./paddle";

export function createPayments(config: PaymentsConfig, deps: { sink: ProviderCallSink; logger: Logger }): Payments {
  if (config.mode === "paddle") {
    return new PaddlePayments({ apiKey: config.apiKey, webhookSecret: config.webhookSecret, environment: config.environment, sink: deps.sink, logger: deps.logger });
  }
  deps.logger.warn("Paddle keys are not set: using the MOCK payment provider (test-mode checkout, no real charges)");
  return new MockPayments({ webhookSecret: config.webhookSecret, publicApiUrl: config.publicApiUrl });
}
```
Add `export * from "./payments";` to `packages/integrations/src/index.ts`, and add `"zod": "*"` to `packages/integrations/package.json` dependencies (it already resolves through the workspace; listing it keeps the package honest), then `npm install`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit packages/integrations`
Expected: PASS (payments 9 tests; instrumented tests unchanged).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add packages/integrations package-lock.json
git commit -m "feat(integrations): add payment adapter with signed Paddle webhooks, mock and Paddle providers"
```

---

### Task 8: Entitlement (access) cache

**Files:**
- Create: `apps/api/src/modules/billing/access-cache.ts`, `apps/api/src/modules/billing/access-cache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Access = { status: SubscriptionStatus | null; planId: PlanId | null; entitlements: Entitlements; spend: SpendScope };
  interface AccessCache { get(workspaceId: string): Promise<Access | null>; set(workspaceId: string, access: Access): Promise<void>; invalidate(workspaceId: string): Promise<void> }
  type RedisLike = { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>; del(key: string): Promise<unknown> };
  ACCESS_TTL_SECONDS = 60
  createRedisAccessCache(redis: RedisLike, logger: Logger, ttlSeconds?: number): AccessCache   // fails open
  class MemoryAccessCache implements AccessCache { readonly entries: Map<string, Access> }
  noAccessCache: AccessCache
  ```

- [ ] **Step 1: Write the failing test** — `apps/api/src/modules/billing/access-cache.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createRedisAccessCache, MemoryAccessCache, type Access, type RedisLike } from "./access-cache";

const access: Access = {
  status: "active",
  planId: "growth",
  entitlements: { audienceViewsPerMonth: null, outreachEmailsPerMonth: 500, campaignLimit: null, export: false },
  spend: "all",
};
const logger = createLogger({ level: "silent" });

describe("access cache", () => {
  it("stores entries in Redis for 60 seconds under a workspace key", async () => {
    const store = new Map<string, unknown>();
    const ttl: number[] = [];
    const redis: RedisLike = {
      get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
      set: async (key, value, opts) => {
        store.set(key, value);
        ttl.push(opts.ex);
      },
      del: async (key) => store.delete(key),
    };
    const cache = createRedisAccessCache(redis, logger);
    await cache.set("w1", access);
    expect(await cache.get("w1")).toEqual(access);
    expect([...store.keys()]).toEqual(["mushin:access:w1"]);
    expect(ttl).toEqual([60]);
    await cache.invalidate("w1");
    expect(await cache.get("w1")).toBeNull();
  });

  it("fails open when Redis is unreachable", async () => {
    const down: RedisLike = {
      get: async () => Promise.reject(new Error("ENOTFOUND")),
      set: async () => Promise.reject(new Error("ENOTFOUND")),
      del: async () => Promise.reject(new Error("ENOTFOUND")),
    };
    const cache = createRedisAccessCache(down, logger);
    await expect(cache.get("w1")).resolves.toBeNull();
    await expect(cache.set("w1", access)).resolves.toBeUndefined();
    await expect(cache.invalidate("w1")).resolves.toBeUndefined();
  });

  it("has an in-memory variant for tests", async () => {
    const cache = new MemoryAccessCache();
    await cache.set("w1", access);
    expect(await cache.get("w1")).toEqual(access);
    await cache.invalidate("w1");
    expect(cache.entries.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/modules/billing/access-cache.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/api/src/modules/billing/access-cache.ts`

```ts
import type { Entitlements, PlanId, SubscriptionStatus } from "@mushin/contracts";
import type { Logger } from "@mushin/core";
import type { SpendScope } from "./rules";

/** What a workspace may do right now (spec D15: cached in Redis, never the spendable balance). */
export type Access = { status: SubscriptionStatus | null; planId: PlanId | null; entitlements: Entitlements; spend: SpendScope };

export interface AccessCache {
  get(workspaceId: string): Promise<Access | null>;
  set(workspaceId: string, access: Access): Promise<void>;
  invalidate(workspaceId: string): Promise<void>;
}

/** The subset of @upstash/redis used here. */
export type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export const ACCESS_TTL_SECONDS = 60;
const keyFor = (workspaceId: string) => `mushin:access:${workspaceId}`;

/** Fails open: if Redis is down, callers read the database and nothing breaks. */
export function createRedisAccessCache(redis: RedisLike, logger: Logger, ttlSeconds = ACCESS_TTL_SECONDS): AccessCache {
  return {
    async get(workspaceId) {
      try {
        return await redis.get<Access>(keyFor(workspaceId));
      } catch (err) {
        logger.warn({ err }, "access cache unavailable; reading the database");
        return null;
      }
    },
    async set(workspaceId, access) {
      try {
        await redis.set(keyFor(workspaceId), access, { ex: ttlSeconds });
      } catch (err) {
        logger.warn({ err }, "could not write the access cache");
      }
    },
    async invalidate(workspaceId) {
      try {
        await redis.del(keyFor(workspaceId));
      } catch (err) {
        logger.warn({ err, workspaceId }, `could not invalidate the access cache; the entry expires within ${ttlSeconds} s`);
      }
    },
  };
}

export class MemoryAccessCache implements AccessCache {
  readonly entries = new Map<string, Access>();
  async get(workspaceId: string) {
    return this.entries.get(workspaceId) ?? null;
  }
  async set(workspaceId: string, access: Access) {
    this.entries.set(workspaceId, access);
  }
  async invalidate(workspaceId: string) {
    this.entries.delete(workspaceId);
  }
}

export const noAccessCache: AccessCache = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => undefined,
};
```

- [ ] **Step 4: Run the tests** → PASS (3 tests).

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
```bash
git add apps/api/src/modules/billing
git commit -m "feat(billing): add Redis-backed entitlement cache that fails open"
```

---

### Task 9: Billing service (summary, checkout, plan changes, webhooks, jobs)

**Files:**
- Create: `apps/api/src/modules/billing/service.ts`, `apps/api/src/modules/billing/service.int.test.ts`
- Modify: `apps/api/src/modules/billing/index.ts`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  ```ts
  type BillingDeps = { db: Db; payments: Payments; cache: AccessCache; logger: Logger; now?: () => Date };
  type Customer = TenantContext & { email: string };
  createBillingService(deps: BillingDeps): BillingService
  type BillingService = {
    engine: CreditEngine;                                   // tx-level, for same-transaction use by later modules
    startTrial(tx: TenantTx, workspaceId: string): Promise<void>;
    summary(ctx: TenantContext): Promise<BillingSummary>;
    plans(ctx: TenantContext): Promise<BillingPlans>;
    ledger(ctx: TenantContext, q: { cursor?: string; limit: number }): Promise<LedgerPage>;
    invoices(ctx: TenantContext): Promise<InvoicesResponse>;
    startCheckout(c: Customer, req: CheckoutRequest): Promise<{ checkoutId: string; url: string }>;
    requestPlanChange(c: TenantContext, req: PlanChangeRequest): Promise<PlanChangeResponse>;
    requestCancel(c: TenantContext): Promise<PlanChangeResponse>;
    getAccess(ctx: TenantContext): Promise<Access>;
    useEntitlement(ctx: TenantContext, key: "audience_views" | "outreach_emails"): Promise<void>;
    reserve / commit / release / extend / spendInstant (ctx-level wrappers around the engine);
    recordWebhook(event: PaymentEvent, rawBody: string, requestId: string): Promise<void>;
    processStoredWebhook(webhookEventId: string): Promise<void>;
    applyEvent(event: PaymentEvent): Promise<void>;
    runJob(job: BillingJob): Promise<{ processed: number }>;
    mockCheckout(checkoutId: string): Promise<CheckoutRow | null>;   // mock routes
    completeMockCheckout(checkoutId: string, outcome: "paid" | "failed"): Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing integration test** — `apps/api/src/modules/billing/service.int.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { MemoryAccessCache } from "./access-cache";
import { createBillingService } from "./service";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const SECRET = "w".repeat(40);
let clock = new Date("2026-10-07T10:00:00Z");
const sent: { raw: string; sig: string }[] = [];
const payments = new MockPayments({ webhookSecret: SECRET, publicApiUrl: "http://api.test", now: () => clock, deliver: async (raw, sig) => void sent.push({ raw, sig }) });
const cache = new MemoryAccessCache();
const billing = createBillingService({ db, payments, cache, logger: createLogger({ level: "silent" }), now: () => clock });

beforeEach(() => {
  clock = new Date("2026-10-07T10:00:00Z");
  sent.length = 0;
  cache.entries.clear();
});

const days = (n: number) => new Date(clock.getTime() + n * 86_400_000);

/** Applies every webhook the mock has "sent", in order, the way the worker would. */
async function flush() {
  for (const s of sent.splice(0)) await billing.applyEvent(payments.verifyWebhook(s.raw, s.sig));
}

async function trialCustomer(role: TenantContext["role"] = "owner") {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req", role, email: "owner@test.mushin.pk" };
}

async function subscribe(c: Awaited<ReturnType<typeof trialCustomer>>, planId: "explorer" | "growth" | "scale", interval: "month" | "year" = "month") {
  const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId, interval });
  await billing.completeMockCheckout(checkoutId, "paid");
  await flush();
  return checkoutId;
}

describe("summary and plans", () => {
  it("shows a fresh trial", async () => {
    const c = await trialCustomer();
    expect(await billing.summary(c)).toMatchObject({
      plan: null,
      status: "trialing",
      trialDaysLeft: 14,
      balance: { available: 200, reserved: 0, base: 200, meter: "normal" },
      canPurchase: true,
      lostAccess: [],
    });
    expect((await billing.summary({ ...c, role: "member" })).canPurchase).toBe(false);
  });

  it("lists plans with PKR display and USD charge prices, packs and action costs", async () => {
    const c = await trialCustomer();
    const p = await billing.plans(c);
    expect(p.plans.map((x) => x.id)).toEqual(["explorer", "growth", "scale"]);
    expect(p.plans[1]).toMatchObject({
      monthlyCredits: 12_000,
      display: { monthly: { amountMinor: 1_290_000, currency: "PKR" } },
      charge: { monthly: { amountMinor: 4_600, currency: "USD" }, yearly: { amountMinor: 46_800 } },
    });
    expect(p.topupPacks.map((x) => x.credits)).toEqual([1000, 5000, 15000]);
    expect(p.actionCosts).toEqual({ search_existing: 0, find_new: 12, reveal_contact: 5, refresh_data: 10 });
  });
});

describe("checkout (Review Focus 3)", () => {
  it("lets only owners and admins buy, and blocks top-ups during the trial", async () => {
    const member = await trialCustomer("member");
    await expect(billing.startCheckout(member, { kind: "subscription", planId: "growth", interval: "month" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const owner = await trialCustomer();
    await expect(billing.startCheckout(owner, { kind: "topup", packId: "credits_1000" })).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      details: { reason: "trial_topup_blocked" },
    });
  });

  it("subscribes through the hosted mock checkout and grants the plan's monthly credits", async () => {
    const c = await trialCustomer();
    const { checkoutId, url } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    expect(url).toBe(`http://api.test/mock-paddle/checkout/${checkoutId}`);
    await billing.completeMockCheckout(checkoutId, "paid");
    await flush();
    const s = await billing.summary(c);
    expect(s).toMatchObject({ plan: { id: "growth" }, interval: "month", status: "active", balance: { available: 12_200, base: 12_000 } });
    expect(s.currentPeriodEnd).toBe("2026-11-07T10:00:00.000Z");
    const checkout = await ownerQuery<{ status: string }>(`select status from wp.checkouts where id = '${checkoutId}'`);
    expect(checkout[0]?.status).toBe("paid");
    expect((await billing.invoices(c)).invoices).toEqual([expect.objectContaining({ kind: "subscription", amount: { amountMinor: 4600, currency: "USD" } })]);
    await expect(billing.startCheckout(c, { kind: "subscription", planId: "scale", interval: "month" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("marks a failed payment and notifies, granting nothing", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(checkoutId, "failed");
    await flush();
    expect((await billing.summary(c)).status).toBe("trialing");
    const rows = await ownerQuery<{ status: string; n: number }>(`
      select (select status from wp.checkouts) status, (select count(*)::int from platform.outbox where event_type = 'notify.payment_failed') n`);
    expect(rows[0]).toEqual({ status: "failed", n: 1 });
  });
});

describe("webhook safety (Review Focus 2)", () => {
  it("duplicate events grant once", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(checkoutId, "paid");
    const copies = [...sent];
    await flush();
    for (const s of copies) await billing.applyEvent(payments.verifyWebhook(s.raw, s.sig));
    const lots = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_lots where source = 'monthly'`);
    const pays = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.payments`);
    expect([lots[0]?.n, pays[0]?.n]).toEqual([1, 1]);
  });

  it("ignores an older event that arrives after a newer one", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(checkoutId, "paid");
    // Verify while the clock is still at day 0 (signatures are only valid for 5 minutes).
    const [payment, created] = sent.splice(0).map((s) => payments.verifyWebhook(s.raw, s.sig));
    if (!payment || !created) throw new Error("expected a payment and a subscription event");
    await billing.applyEvent(payment);
    await billing.applyEvent(created); // subscription.created, stamped day 0
    clock = days(1);
    await billing.requestPlanChange(c, { planId: "scale", interval: "month" }); // mock sends subscription.updated, stamped day 1
    await flush();
    await billing.applyEvent(created); // the day-0 event delivered late
    expect((await billing.summary(c)).plan?.id).toBe("scale");
  });

  it("records each delivery once and processes it from storage", async () => {
    const c = await trialCustomer();
    const { checkoutId } = await billing.startCheckout(c, { kind: "subscription", planId: "growth", interval: "month" });
    await billing.completeMockCheckout(checkoutId, "paid");
    for (const s of sent) {
      const event = payments.verifyWebhook(s.raw, s.sig);
      await billing.recordWebhook(event, s.raw, "req-1");
      await billing.recordWebhook(event, s.raw, "req-2");
    }
    const stored = await ownerQuery<{ id: string }>(`select id from platform.webhook_events order by received_at`);
    const outbox = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'billing.webhook_received'`);
    expect([stored.length, outbox[0]?.n]).toEqual([2, 2]);
    for (const row of stored) await billing.processStoredWebhook(row.id);
    expect((await billing.summary(c)).status).toBe("active");
    const processed = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.webhook_events where processed_at is not null`);
    expect(processed[0]?.n).toBe(2);
  });
});

describe("plan changes", () => {
  it("upgrades now: unused monthly credits end and the new plan's credits are granted", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    expect(await billing.requestPlanChange(c, { planId: "scale", interval: "month" })).toEqual({ change: "upgrade", effective: "now" });
    await flush();
    const lots = await ownerQuery<{ amount: number; remaining: number }>(`select amount, remaining from wp.credit_lots where source = 'monthly' order by amount`);
    expect(lots).toEqual([
      { amount: 12_000, remaining: 0 },
      { amount: 35_000, remaining: 35_000 },
    ]);
  });

  it("schedules a downgrade for the period end and applies it then", async () => {
    const c = await trialCustomer();
    await subscribe(c, "scale");
    expect(await billing.requestPlanChange(c, { planId: "explorer", interval: "month" })).toEqual({ change: "downgrade", effective: "period_end" });
    expect((await billing.summary(c)).scheduledChange).toEqual({ planId: "explorer", interval: "month" });
    clock = days(31);
    await billing.runJob("scheduled_changes");
    await flush();
    const s = await billing.summary(c);
    expect(s.plan?.id).toBe("explorer");
    expect(s.scheduledChange).toBeNull();
  });

  it("cancels at period end; afterwards only paid top-ups remain spendable", async () => {
    const c = await trialCustomer();
    await subscribe(c, "growth");
    const { checkoutId } = await billing.startCheckout(c, { kind: "topup", packId: "credits_1000" });
    await billing.completeMockCheckout(checkoutId, "paid");
    await flush();
    expect(await billing.requestCancel(c)).toEqual({ change: "cancel", effective: "period_end" });
    await flush();
    expect((await billing.summary(c)).cancelAtPeriodEnd).toBe(true);
    clock = days(31);
    await billing.runJob("mock_renewals");
    await flush();
    const s = await billing.summary(c);
    expect(s).toMatchObject({ status: "canceled", plan: null, balance: { available: 1000 } });
    expect(s.lostAccess).toEqual(["monthly_credits", "outreach", "audience_details", "export"]);
    await expect(billing.reserve(c, { action: "find_new", confirmedCost: 12, refType: "test", refId: "1" })).resolves.toMatchObject({ amount: 12 });
  });
});

describe("jobs", () => {
  it("warns before the trial ends, then expires it", async () => {
    const c = await trialCustomer();
    clock = days(12);
    await billing.runJob("trial_notices");
    await billing.runJob("trial_notices");
    clock = days(3);
    await billing.runJob("end_trials");
    const s = await billing.summary(c);
    expect(s).toMatchObject({ status: "expired", balance: { available: 0 } });
    expect(s.lostAccess).toContain("find_new");
    const events = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox where event_type like 'notify.trial%' order by created_at`);
    expect(events.map((e) => e.event_type)).toEqual(["notify.trial_ending", "notify.trial_expired"]);
  });

  it("grants a yearly plan's credits month by month", async () => {
    const c = await trialCustomer();
    await subscribe(c, "explorer", "year");
    const first = await ownerQuery<{ expires: string }>(`select to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') expires from wp.credit_lots where source = 'monthly'`);
    expect(first[0]?.expires).toBe("2026-11-07");
    clock = new Date("2026-11-07T10:00:01Z");
    await billing.runJob("monthly_grants");
    const lots = await ownerQuery<{ remaining: number; expires: string }>(`
      select remaining, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD') expires from wp.credit_lots where source = 'monthly' order by expires_at`);
    expect(lots).toEqual([
      { remaining: 0, expires: "2026-11-07" },
      { remaining: 2500, expires: "2026-12-07" },
    ]);
  });

  it("releases abandoned reservations and expires lots", async () => {
    const c = await trialCustomer();
    await billing.reserve(c, { action: "find_new", confirmedCost: 12, refType: "test", refId: "1" });
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect(await billing.runJob("release_abandoned")).toEqual({ processed: 1 });
    expect((await billing.summary(c)).balance.reserved).toBe(0);
    expect(await billing.runJob("reconcile")).toEqual({ processed: 1 });
  });
});

describe("access cache", () => {
  it("caches access and invalidates it when billing changes", async () => {
    const c = await trialCustomer();
    expect(await billing.getAccess(c)).toMatchObject({ status: "trialing", spend: "all", entitlements: { campaignLimit: 3 } });
    expect(cache.entries.has(c.workspaceId)).toBe(true);
    await subscribe(c, "scale");
    expect(cache.entries.has(c.workspaceId)).toBe(false);
    expect(await billing.getAccess(c)).toMatchObject({ status: "active", planId: "scale", entitlements: { export: true } });
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run: `npx tsc -p tsconfig.json` → FAIL (cannot find `./service`).

- [ ] **Step 3: Implement** — `apps/api/src/modules/billing/service.ts`

```ts
import type {
  BillingInterval,
  BillingPlans,
  BillingSummary,
  CheckoutRequest,
  CreditAction,
  Entitlements,
  InvoicesResponse,
  LedgerPage,
  PlanChangeRequest,
  PlanChangeResponse,
} from "@mushin/contracts";
import { AppError, type Logger, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import { isMockPayments, parsePaddleEvent, type PaymentEvent, type Payments, type PriceRef, type SubscriptionRef } from "@mushin/integrations";
import type { Access, AccessCache } from "./access-cache";
import { createCreditEngine, type SpendRequest } from "./engine";
import * as repo from "./repository";
import { addMonths, classifyChange, daysLeft, decodeCursor, encodeCursor, lostAccessFor, spendScope } from "./rules";

export type BillingDeps = { db: Db; payments: Payments; cache: AccessCache; logger: Logger; now?: () => Date };
export type Customer = TenantContext & { email: string };

const BILLING_ROLES = new Set<TenantContext["role"]>(["owner", "admin"]);
const NO_ENTITLEMENTS: Entitlements = { audienceViewsPerMonth: 0, outreachEmailsPerMonth: 0, campaignLimit: 0, export: false };

function requireBillingRole(ctx: TenantContext) {
  if (!BILLING_ROLES.has(ctx.role)) throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can manage billing");
}

const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const isPaying = (s: repo.SubscriptionRow | null) => s?.status === "active" || s?.status === "past_due";

export function createBillingService(deps: BillingDeps) {
  const now = deps.now ?? (() => new Date());
  const engine = createCreditEngine({ now });
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const actorOf = (ctx: TenantContext) => ({ userId: ctx.userId, requestId: ctx.requestId });

  function priceForPlan(plan: repo.PlanRow, interval: BillingInterval): PriceRef {
    return {
      priceId: plan.paddlePriceIds[interval],
      interval,
      amountMinor: interval === "month" ? plan.chargeMonthlyMinor : plan.chargeYearlyMinor,
      currency: plan.chargeCurrency,
    };
  }

  function subscriptionRef(sub: repo.SubscriptionRow, plan: repo.PlanRow): SubscriptionRef {
    if (!sub.paddleSubscriptionId || !sub.billingInterval || !sub.currentPeriodStart || !sub.currentPeriodEnd) {
      throw new AppError("CONFLICT", "There is no active subscription to change. Choose a plan instead.");
    }
    return {
      subscriptionId: sub.paddleSubscriptionId,
      customerId: sub.paddleCustomerId,
      workspaceId: sub.workspaceId,
      price: priceForPlan(plan, sub.billingInterval),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    };
  }

  async function notify(tx: TenantTx, workspaceId: string, type: string, payload: Record<string, unknown>) {
    await writeOutbox(tx, { eventType: `notify.${type}`, aggregateType: "workspace", aggregateId: workspaceId, workspaceId, payload, requestId: null });
  }

  // ── reads ────────────────────────────────────────────────────────────────
  async function summary(ctx: TenantContext): Promise<BillingSummary> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const sub = await repo.getSubscription(tx, ctx.workspaceId);
      const b = await engine.balance(tx, ctx.workspaceId);
      const plan = isPaying(sub) && sub?.planId ? await repo.getPlan(tx, sub.planId) : null;
      return {
        plan: plan ? { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits } : null,
        interval: plan ? (sub?.billingInterval ?? null) : null,
        status: sub?.status ?? "expired",
        currentPeriodEnd: plan ? (sub?.currentPeriodEnd?.toISOString() ?? null) : null,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft: sub?.status === "trialing" ? daysLeft(sub.trialEndsAt, now()) : null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        scheduledChange: sub?.scheduledPlanId && sub.scheduledInterval ? { planId: sub.scheduledPlanId, interval: sub.scheduledInterval } : null,
        balance: { available: b.available, reserved: b.reserved, base: b.base, meter: b.meter },
        canPurchase: BILLING_ROLES.has(ctx.role),
        lostAccess: lostAccessFor(b.status, b.topupRemaining),
      };
    });
  }

  async function plans(ctx: TenantContext): Promise<BillingPlans> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const planRows = await repo.listPlans(tx);
      const packRows = await repo.listPacks(tx);
      const costs = new Map((await repo.listActionCosts(tx)).map((c) => [c.action, c.credits]));
      const cost = (a: CreditAction) => {
        const value = costs.get(a);
        if (value === undefined) throw new Error(`no credit cost configured for ${a}`);
        return value;
      };
      return {
        plans: planRows.map((p) => ({
          id: p.id,
          name: p.name,
          monthlyCredits: p.monthlyCredits,
          display: {
            monthly: { amountMinor: p.displayMonthlyMinor, currency: p.displayCurrency },
            yearlyPerMonth: { amountMinor: p.displayYearlyMonthlyMinor, currency: p.displayCurrency },
          },
          charge: {
            monthly: { amountMinor: p.chargeMonthlyMinor, currency: p.chargeCurrency },
            yearly: { amountMinor: p.chargeYearlyMinor, currency: p.chargeCurrency },
          },
          entitlements: p.entitlements,
        })),
        topupPacks: packRows.map((k) => ({
          id: k.id,
          credits: k.credits,
          display: { amountMinor: k.displayPriceMinor, currency: k.displayCurrency },
          charge: { amountMinor: k.chargePriceMinor, currency: k.chargeCurrency },
          validityMonths: k.validityMonths,
        })),
        actionCosts: {
          search_existing: cost("search_existing"),
          find_new: cost("find_new"),
          reveal_contact: cost("reveal_contact"),
          refresh_data: cost("refresh_data"),
        },
      };
    });
  }

  async function ledger(ctx: TenantContext, q: { cursor?: string | undefined; limit: number }): Promise<LedgerPage> {
    requireBillingRole(ctx);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const rows = await repo.ledgerPage(tx, ctx.workspaceId, cursor, q.limit);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          amount: r.amount,
          action: r.action,
          lotSource: r.lotSource,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    });
  }

  async function invoices(ctx: TenantContext): Promise<InvoicesResponse> {
    requireBillingRole(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => ({
      invoices: (await repo.listPayments(tx, ctx.workspaceId)).map((p) => ({
        id: p.id,
        kind: p.kind,
        amount: { amountMinor: p.amountMinor, currency: p.currency },
        status: p.status,
        invoiceUrl: p.invoiceUrl,
        createdAt: p.createdAt.toISOString(),
      })),
    }));
  }

  async function getAccess(ctx: TenantContext): Promise<Access> {
    const cached = await deps.cache.get(ctx.workspaceId);
    if (cached) return cached;
    const access = await deps.db.withTenant(tenant(ctx), async (tx): Promise<Access> => {
      const sub = await repo.getSubscription(tx, ctx.workspaceId);
      const settings = await repo.getSettings(tx);
      const planId = sub?.status === "trialing" ? settings.trialPlanId : isPaying(sub) ? (sub?.planId ?? null) : null;
      const plan = planId ? await repo.getPlan(tx, planId) : null;
      return {
        status: sub?.status ?? null,
        planId: sub?.status === "trialing" ? null : (plan?.id ?? null),
        entitlements: plan?.entitlements ?? NO_ENTITLEMENTS,
        spend: spendScope(sub?.status ?? null),
      };
    });
    await deps.cache.set(ctx.workspaceId, access);
    return access;
  }

  async function useEntitlement(ctx: TenantContext, key: "audience_views" | "outreach_emails"): Promise<void> {
    const access = await getAccess(ctx);
    const limit = key === "audience_views" ? access.entitlements.audienceViewsPerMonth : access.entitlements.outreachEmailsPerMonth;
    const ok = await deps.db.withTenant(tenant(ctx), (tx) => engine.useEntitlement(tx, ctx.workspaceId, key, limit));
    if (!ok) throw new AppError("ENTITLEMENT_REQUIRED", "Your plan's monthly limit for this feature is used up.", { reason: "plan_limit", key });
  }

  // ── purchases ────────────────────────────────────────────────────────────
  async function startCheckout(c: Customer, req: CheckoutRequest): Promise<{ checkoutId: string; url: string }> {
    requireBillingRole(c);
    const created = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId);
      if (req.kind === "topup") {
        if (sub?.status === "trialing") {
          throw new AppError("ENTITLEMENT_REQUIRED", "Credit top-ups are available once you choose a plan.", { reason: "trial_topup_blocked" });
        }
        const pack = await repo.getPack(tx, req.packId);
        if (!pack) throw new AppError("NOT_FOUND", "That credit pack is not available");
        const price: PriceRef = { priceId: pack.paddlePriceId, interval: null, amountMinor: pack.chargePriceMinor, currency: pack.chargeCurrency };
        const checkout = await repo.insertCheckout(tx, {
          workspaceId: c.workspaceId,
          kind: "topup",
          topupPackId: pack.id,
          priceId: price.priceId,
          amountMinor: price.amountMinor,
          currency: price.currency,
          requestedBy: c.userId,
        });
        return { checkout, price };
      }
      if (isPaying(sub)) throw new AppError("CONFLICT", "You already have a subscription. Change your plan instead.");
      const plan = await repo.getPlan(tx, req.planId);
      if (!plan || !plan.active) throw new AppError("NOT_FOUND", "That plan is not available");
      const price = priceForPlan(plan, req.interval);
      const checkout = await repo.insertCheckout(tx, {
        workspaceId: c.workspaceId,
        kind: "subscription",
        planId: plan.id,
        billingInterval: req.interval,
        priceId: price.priceId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        requestedBy: c.userId,
      });
      return { checkout, price };
    });

    let hosted: { providerCheckoutId: string; url: string };
    try {
      hosted = await deps.payments.createCheckout({ checkoutId: created.checkout.id, workspaceId: c.workspaceId, customerEmail: c.email, price: created.price });
    } catch (err) {
      await deps.db.withTenant(tenant(c), (tx) => repo.setCheckoutStatus(tx, c.workspaceId, created.checkout.id, "failed"));
      throw err instanceof AppError
        ? err
        : new AppError("PROVIDER_UNAVAILABLE", "The payment provider is unavailable right now. Please try again shortly.", undefined, { cause: err });
    }
    await deps.db.withTenant(tenant(c), (tx) => repo.setCheckoutProvider(tx, c.workspaceId, created.checkout.id, hosted.providerCheckoutId, hosted.url));
    return { checkoutId: created.checkout.id, url: hosted.url };
  }

  async function requestPlanChange(c: TenantContext, req: PlanChangeRequest): Promise<PlanChangeResponse> {
    requireBillingRole(c);
    const decision = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId, { forUpdate: true });
      if (!sub || !isPaying(sub) || !sub.planId || !sub.billingInterval) {
        throw new AppError("CONFLICT", "There is no active subscription to change. Choose a plan instead.");
      }
      if (sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", "Your subscription is set to end at the end of this period.");
      const current = await repo.getPlan(tx, sub.planId);
      const target = await repo.getPlan(tx, req.planId);
      if (!current || !target || !target.active) throw new AppError("NOT_FOUND", "That plan is not available");
      const change = classifyChange(
        { planId: current.id, interval: sub.billingInterval, monthlyCredits: current.monthlyCredits },
        { planId: target.id, interval: req.interval, monthlyCredits: target.monthlyCredits },
      );
      if (change === "same") throw new AppError("CONFLICT", "You are already on this plan");
      if (change === "downgrade") {
        await repo.updateSubscription(tx, c.workspaceId, { scheduledPlanId: target.id, scheduledInterval: req.interval });
        return { change, ref: null, target };
      }
      await repo.updateSubscription(tx, c.workspaceId, { scheduledPlanId: null, scheduledInterval: null });
      return { change, ref: subscriptionRef(sub, current), target };
    });
    if (decision.ref) await deps.payments.changePlan({ subscription: decision.ref, target: priceForPlan(decision.target, req.interval) });
    await deps.cache.invalidate(c.workspaceId);
    return decision.change === "upgrade" ? { change: "upgrade", effective: "now" } : { change: "downgrade", effective: "period_end" };
  }

  async function requestCancel(c: TenantContext): Promise<PlanChangeResponse> {
    requireBillingRole(c);
    const ref = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId);
      if (!sub || !isPaying(sub) || !sub.planId) throw new AppError("CONFLICT", "There is no active subscription to cancel.");
      if (sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", "Your subscription is already set to end.");
      const plan = await repo.getPlan(tx, sub.planId);
      if (!plan) throw new AppError("NOT_FOUND", "That plan is not available");
      return subscriptionRef(sub, plan);
    });
    await deps.payments.cancelAtPeriodEnd({ subscription: ref });
    return { change: "cancel", effective: "period_end" };
  }

  // ── webhooks ─────────────────────────────────────────────────────────────
  async function recordWebhook(event: PaymentEvent, rawBody: string, requestId: string): Promise<void> {
    const payload = JSON.parse(rawBody) as unknown;
    await deps.db.withSystem(async (tx) => {
      const id = await repo.insertWebhookEvent(tx, {
        provider: "paddle",
        providerEventId: event.eventId,
        eventType: event.kind === "ignored" ? event.eventType : event.kind,
        payload,
      });
      if (!id) return; // duplicate delivery
      await writeOutbox(tx, {
        eventType: "billing.webhook_received",
        aggregateType: "webhook_event",
        aggregateId: id,
        workspaceId: event.kind === "ignored" ? null : event.workspaceId,
        payload: { webhookEventId: id },
        requestId,
      });
    });
  }

  async function processStoredWebhook(webhookEventId: string): Promise<void> {
    const row = await deps.db.withSystem((tx) => repo.getWebhookEvent(tx, webhookEventId));
    if (!row || row.processedAt) return;
    try {
      await applyEvent(parsePaddleEvent(row.payload));
      await deps.db.withSystem((tx) => repo.markWebhook(tx, webhookEventId, null));
    } catch (err) {
      await deps.db.withSystem((tx) => repo.markWebhook(tx, webhookEventId, err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async function onTransaction(e: Extract<PaymentEvent, { kind: "transaction.completed" }>) {
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      const kind = e.subscriptionId ? "subscription" : "topup";
      const paymentId = await repo.insertPayment(tx, {
        workspaceId: e.workspaceId,
        paddleTransactionId: e.transactionId,
        kind,
        amountMinor: e.amountMinor,
        currency: e.currency,
        status: "completed",
        invoiceUrl: e.invoiceUrl,
        checkoutId: e.checkoutId,
      });
      if (!paymentId) return; // already applied
      if (e.checkoutId) await repo.setCheckoutStatus(tx, e.workspaceId, e.checkoutId, "paid");
      if (kind === "topup") {
        const owner = await repo.findPriceOwner(tx, e.priceId);
        if (owner?.kind !== "topup") throw new Error(`unknown top-up price ${e.priceId}`);
        await engine.grant(tx, e.workspaceId, {
          source: "topup",
          amount: owner.pack.credits,
          expiresAt: addMonths(e.occurredAt, owner.pack.validityMonths),
          sourceRef: `txn:${e.transactionId}`,
          paymentId,
          note: `${owner.pack.credits.toLocaleString("en-US")} credit top-up`,
        });
      }
    });
  }

  async function onPaymentFailed(e: Extract<PaymentEvent, { kind: "transaction.payment_failed" }>) {
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      if (e.checkoutId) await repo.setCheckoutStatus(tx, e.workspaceId, e.checkoutId, "failed");
      await notify(tx, e.workspaceId, "payment_failed", { transactionId: e.transactionId });
    });
  }

  async function onSubscription(e: Extract<PaymentEvent, { subscription: unknown }>) {
    const s = e.subscription;
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      const owner = await repo.findPriceOwner(tx, s.priceId);
      if (owner?.kind !== "plan") throw new Error(`unknown plan price ${s.priceId}`);
      const { plan, interval } = owner;
      const sub = await repo.getSubscription(tx, e.workspaceId, { forUpdate: true });
      if (sub?.providerEventAt && sub.providerEventAt.getTime() > e.occurredAt.getTime()) {
        deps.logger.info({ eventId: e.eventId, workspaceId: e.workspaceId }, "ignoring an older subscription event");
        return;
      }
      const status =
        e.kind === "subscription.canceled" || s.status === "canceled"
          ? "canceled"
          : e.kind === "subscription.past_due" || s.status === "past_due"
            ? "past_due"
            : "active";
      const patch: repo.SubscriptionPatch & { status: repo.SubscriptionRow["status"] } = {
        status,
        planId: plan.id,
        billingInterval: interval,
        currentPeriodStart: s.periodStart,
        currentPeriodEnd: s.periodEnd,
        paddleSubscriptionId: s.subscriptionId,
        paddleCustomerId: s.customerId,
        cancelAtPeriodEnd: status === "canceled" ? false : s.cancelScheduled,
        providerEventAt: e.occurredAt,
      };
      if (sub?.scheduledPlanId === plan.id && sub.scheduledInterval === interval) {
        patch.scheduledPlanId = null;
        patch.scheduledInterval = null;
      }
      if (status === "canceled") {
        await engine.endLots(tx, e.workspaceId, "monthly");
        Object.assign(patch, { nextCreditGrantAt: null, scheduledPlanId: null, scheduledInterval: null });
        await notify(tx, e.workspaceId, "subscription_canceled", { planId: plan.id });
      } else if (status === "active" && s.periodStart && s.periodEnd) {
        const newCreditPeriod =
          !isPaying(sub) ||
          sub?.planId !== plan.id ||
          sub.billingInterval !== interval ||
          sub.currentPeriodStart?.getTime() !== s.periodStart.getTime();
        if (newCreditPeriod) {
          await engine.endLots(tx, e.workspaceId, "monthly");
          const creditEnd = interval === "year" ? minDate(addMonths(s.periodStart, 1), s.periodEnd) : s.periodEnd;
          await engine.grant(tx, e.workspaceId, {
            source: "monthly",
            amount: plan.monthlyCredits,
            expiresAt: creditEnd,
            sourceRef: `monthly:${s.subscriptionId}:${s.periodStart.toISOString()}:${plan.id}:${interval}`,
            note: `${plan.name} monthly credits`,
          });
          patch.nextCreditGrantAt = creditEnd.getTime() < s.periodEnd.getTime() ? creditEnd : null;
        }
      }
      await repo.upsertSubscription(tx, e.workspaceId, patch);
    });
  }

  async function applyEvent(e: PaymentEvent): Promise<void> {
    if (e.kind === "ignored") return;
    if (e.kind === "transaction.completed") await onTransaction(e);
    else if (e.kind === "transaction.payment_failed") await onPaymentFailed(e);
    else await onSubscription(e);
    await deps.cache.invalidate(e.workspaceId);
  }

  // ── jobs ─────────────────────────────────────────────────────────────────
  async function runJobFor(job: repo.BillingJob, workspaceId: string): Promise<void> {
    const t = now();
    switch (job) {
      case "release_abandoned":
        await deps.db.withWorkspace(workspaceId, (tx) => engine.releaseAbandoned(tx, workspaceId));
        return;
      case "expire_lots":
        await deps.db.withWorkspace(workspaceId, (tx) => engine.expireLots(tx, workspaceId));
        return;
      case "reconcile": {
        const mismatches = await deps.db.withWorkspace(workspaceId, (tx) => engine.reconcile(tx, workspaceId));
        if (mismatches.length > 0) deps.logger.error({ workspaceId, mismatches }, "credit lots do not match the ledger");
        return;
      }
      case "end_trials":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          if (sub?.status !== "trialing" || !sub.trialEndsAt || sub.trialEndsAt.getTime() > t.getTime()) return;
          await repo.updateSubscription(tx, workspaceId, { status: "expired" });
          await engine.expireLots(tx, workspaceId);
          await notify(tx, workspaceId, "trial_expired", {});
        });
        await deps.cache.invalidate(workspaceId);
        return;
      case "trial_notices":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          if (sub?.status !== "trialing" || sub.trialEndingNotifiedAt || !sub.trialEndsAt) return;
          await repo.updateSubscription(tx, workspaceId, { trialEndingNotifiedAt: t });
          await notify(tx, workspaceId, "trial_ending", { trialEndsAt: sub.trialEndsAt.toISOString() });
        });
        return;
      case "monthly_grants":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          const start = sub?.nextCreditGrantAt;
          if (!sub || !isPaying(sub) || !start || start.getTime() > t.getTime() || !sub.planId || !sub.currentPeriodEnd || !sub.paddleSubscriptionId) return;
          const plan = await repo.getPlan(tx, sub.planId);
          if (!plan) return;
          const end = minDate(addMonths(start, 1), sub.currentPeriodEnd);
          await engine.endLots(tx, workspaceId, "monthly");
          await engine.grant(tx, workspaceId, {
            source: "monthly",
            amount: plan.monthlyCredits,
            expiresAt: end,
            sourceRef: `monthly:${sub.paddleSubscriptionId}:${start.toISOString()}:${plan.id}:year`,
            note: `${plan.name} monthly credits`,
          });
          await repo.updateSubscription(tx, workspaceId, { nextCreditGrantAt: end.getTime() < sub.currentPeriodEnd.getTime() ? end : null });
        });
        return;
      case "scheduled_changes": {
        const work = await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId);
          if (!sub || !isPaying(sub) || !sub.planId || !sub.scheduledPlanId || !sub.scheduledInterval) return null;
          if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > t.getTime()) return null;
          const current = await repo.getPlan(tx, sub.planId);
          const target = await repo.getPlan(tx, sub.scheduledPlanId);
          if (!current || !target) return null;
          return { ref: subscriptionRef(sub, current), target: priceForPlan(target, sub.scheduledInterval) };
        });
        if (work) await deps.payments.changePlan({ subscription: work.ref, target: work.target });
        return;
      }
      case "mock_renewals": {
        if (!isMockPayments(deps.payments)) return;
        const work = await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId);
          if (!sub || !isPaying(sub) || !sub.planId || sub.scheduledPlanId) return null;
          if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > t.getTime()) return null;
          const plan = await repo.getPlan(tx, sub.planId);
          return plan ? { ref: subscriptionRef(sub, plan), cancel: sub.cancelAtPeriodEnd } : null;
        });
        if (work) await deps.payments.renew(work.ref, work.cancel);
        return;
      }
    }
  }

  async function runJob(job: repo.BillingJob): Promise<{ processed: number }> {
    if (job === "mock_renewals" && !isMockPayments(deps.payments)) return { processed: 0 };
    const t = now();
    const settings = await deps.db.withSystem((tx) => repo.getSettings(tx));
    const workspaceIds = await deps.db.withSystem((tx) => repo.dueWorkspaces(tx, job, t, settings.trialEndingNoticeDays));
    let failed = 0;
    for (const workspaceId of workspaceIds) {
      try {
        await runJobFor(job, workspaceId);
      } catch (err) {
        failed += 1;
        deps.logger.error({ err, job, workspaceId }, "billing job failed for a workspace");
      }
    }
    if (failed > 0) throw new Error(`billing job ${job} failed for ${failed} of ${workspaceIds.length} workspaces`);
    return { processed: workspaceIds.length };
  }

  // ── mock checkout pages ─────────────────────────────────────────────────
  async function mockCheckout(checkoutId: string): Promise<repo.CheckoutRow | null> {
    if (!isMockPayments(deps.payments)) return null;
    return deps.db.withSystem((tx) => repo.getCheckoutById(tx, checkoutId));
  }

  async function completeMockCheckout(checkoutId: string, outcome: "paid" | "failed"): Promise<void> {
    if (!isMockPayments(deps.payments)) throw new AppError("NOT_FOUND", "Route not found");
    const checkout = await deps.db.withSystem((tx) => repo.getCheckoutById(tx, checkoutId));
    if (!checkout) throw new AppError("NOT_FOUND", "Checkout not found");
    if (checkout.status !== "open") throw new AppError("CONFLICT", "This checkout is already finished");
    await deps.payments.completeCheckout(
      {
        checkoutId: checkout.id,
        workspaceId: checkout.workspaceId,
        kind: checkout.kind,
        price: { priceId: checkout.priceId, interval: checkout.billingInterval, amountMinor: checkout.amountMinor, currency: checkout.currency },
      },
      outcome,
    );
  }

  return {
    engine,
    startTrial: engine.startTrial,
    summary,
    plans,
    ledger,
    invoices,
    getAccess,
    useEntitlement,
    startCheckout,
    requestPlanChange,
    requestCancel,
    recordWebhook,
    processStoredWebhook,
    applyEvent,
    runJob,
    mockCheckout,
    completeMockCheckout,
    reserve: (ctx: TenantContext, req: SpendRequest) => deps.db.withTenant(tenant(ctx), (tx) => engine.reserve(tx, ctx.workspaceId, req, actorOf(ctx))),
    commit: (ctx: TenantContext, reservationId: string) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.commit(tx, ctx.workspaceId, reservationId, actorOf(ctx))),
    release: (ctx: TenantContext, reservationId: string, reason: string) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.release(tx, ctx.workspaceId, reservationId, reason, actorOf(ctx))),
    extend: (ctx: TenantContext, reservationId: string) => deps.db.withTenant(tenant(ctx), (tx) => engine.extend(tx, ctx.workspaceId, reservationId)),
    spendInstant: (ctx: TenantContext, req: SpendRequest) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.spendInstant(tx, ctx.workspaceId, req, actorOf(ctx))),
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
```

Replace `apps/api/src/modules/billing/index.ts`:
```ts
export { createCreditEngine } from "./engine";
export type { Actor, Balance, CreditEngine, GrantRequest, SpendRequest } from "./engine";
export { createBillingService } from "./service";
export type { BillingDeps, BillingService, Customer } from "./service";
export { createRedisAccessCache, MemoryAccessCache, noAccessCache } from "./access-cache";
export type { Access, AccessCache, RedisLike } from "./access-cache";
export type { BillingJob } from "./repository";
```

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
Run: `npm run test:int` → expected PASS (service 15 tests), or record that the integration tests did not run.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing
git commit -m "feat(billing): add billing service for checkout, plan changes, webhooks and scheduled jobs"
```

---
### Task 10: Billing API routes, webhook intake and the mock checkout page

**Files:**
- Create: `apps/api/src/modules/billing/routes.ts`, `apps/api/src/modules/billing/mock-routes.ts`, `apps/api/src/modules/billing/billing-api.int.test.ts`
- Modify: `apps/api/src/modules/billing/index.ts`, `apps/api/src/rate-limit/plugin.ts`, `apps/api/src/rate-limit/rate-limit.test.ts`, `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `BillingService` (Task 9), `Payments`, `isMockPayments`, `WebhookPayloadError` (Task 7), billing contracts (Task 2), `Guards`, `tenantOf`, `parseInput`, `sendOk` (sub-project 1).
- Produces: `createBillingModule(o: { service: BillingService; payments: Payments; appUrl: string }): AppModule`; routes `GET /v1/billing/{summary,plans,ledger,invoices}`, `POST /v1/billing/{checkout,subscription/change,subscription/cancel}`, `POST /webhooks/paddle`, mock-only `GET /mock-paddle/checkout/:id`, `POST /mock-paddle/checkout/:id/{pay,fail}`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/rate-limit/rate-limit.test.ts` inside `describe("IP rate limit hook", …)`:
```ts
  it("never rate-limits payment webhooks", async () => {
    const app = await buildTestApp({
      onRequestHooks: [ipRateLimitHook(new MemoryRateLimiter(buckets))],
      modules: [{ name: "hook", register: (a) => void a.post("/webhooks/paddle", async () => ({ ok: true })) }],
    });
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: "/webhooks/paddle" })).statusCode).toBe(200);
  });
```

Create `apps/api/src/modules/billing/billing-api.int.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments, signPaddleWebhook } from "@mushin/integrations";
import { createCustomerGuard } from "../../auth/customer-guard";
import { createCustomerTokenVerifier } from "../../auth/customer-token";
import { MemoryRateLimiter } from "../../rate-limit/memory";
import { buildTestApp } from "../../test-support/app";
import { createTestIssuer } from "../../test-support/keys";
import { createIdentityModule } from "../identity/index";
import { createPlatformModule } from "../platform/index";
import { createBillingModule, createBillingService, MemoryAccessCache, type BillingService } from "./index";

const SECRET = "h".repeat(40);
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const roomy = () =>
  new MemoryRateLimiter({ ip: { limit: 1000, windowSeconds: 60 }, user: { limit: 1000, windowSeconds: 60 }, auth: { limit: 1000, windowSeconds: 60 } });

async function setup() {
  let target: FastifyInstance | undefined;
  const payments = new MockPayments({
    webhookSecret: SECRET,
    publicApiUrl: "http://api.test",
    // Deliver the mock's webhooks to this very app, as Paddle would over HTTPS.
    deliver: async (raw, sig) => {
      if (!target) throw new Error("app not ready");
      const res = await target.inject({ method: "POST", url: "/webhooks/paddle", headers: { "content-type": "application/json", "paddle-signature": sig }, payload: raw });
      if (res.statusCode !== 200) throw new Error(`webhook rejected: ${res.statusCode} ${res.body}`);
    },
  });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger: createLogger({ level: "silent" }) });
  const identity = createIdentityModule({ db, startTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: {
      customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter: roomy() }),
      idempotent: platform.requireIdempotencyKey,
    },
    modules: [platform.module, identity.module, createBillingModule({ service: billing, payments, appUrl: "http://localhost:5173" })],
  });
  target = app;
  const token = await iss.sign({ sub: randomUUID(), email: "owner@mushin.pk", fullName: "Owner" });
  return { app, billing, auth: { authorization: `Bearer ${token}` } };
}

/** What the worker does for each `billing.webhook_received` outbox event. */
async function processWebhooks(billing: BillingService) {
  const rows = await ownerQuery<{ id: string }>(`select id from platform.webhook_events where processed_at is null order by received_at`);
  for (const row of rows) await billing.processStoredWebhook(row.id);
}

describe("billing API", () => {
  it("shows the trial, then buys a plan through the hosted mock checkout", async () => {
    const { app, billing, auth } = await setup();
    const summary = await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ status: "trialing", balance: { available: 200 } });

    const body = { kind: "subscription", planId: "growth", interval: "month" };
    expect((await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: body })).statusCode).toBe(400);
    const checkout = await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: { ...auth, "idempotency-key": "checkout-0001" }, payload: body });
    expect(checkout.statusCode).toBe(201);
    const { checkoutId, url } = checkout.json() as { checkoutId: string; url: string };
    expect(url).toBe(`http://api.test/mock-paddle/checkout/${checkoutId}`);

    const page = await app.inject({ method: "GET", url: `/mock-paddle/checkout/${checkoutId}` });
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).toContain("$46.00");

    const pay = await app.inject({
      method: "POST",
      url: `/mock-paddle/checkout/${checkoutId}/pay`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(pay.statusCode).toBe(303);
    expect(pay.headers.location).toBe("http://localhost:5173/?checkout=success#/dashboard");
    await processWebhooks(billing);

    const after = await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    expect(after.json()).toMatchObject({ status: "active", plan: { id: "growth" }, balance: { available: 12_200 } });
    const invoices = await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: auth });
    expect(invoices.json().invoices).toHaveLength(1);
    const again = await app.inject({
      method: "POST",
      url: `/mock-paddle/checkout/${checkoutId}/pay`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(again.statusCode).toBe(409);
  });

  it("returns ledger history and rejects a bad cursor", async () => {
    const { app, auth } = await setup();
    await app.inject({ method: "GET", url: "/v1/billing/summary", headers: auth });
    const ledger = await app.inject({ method: "GET", url: "/v1/billing/ledger?limit=1", headers: auth });
    expect(ledger.json()).toMatchObject({ entries: [{ kind: "grant", amount: 200, lotSource: "trial" }], nextCursor: null });
    expect((await app.inject({ method: "GET", url: "/v1/billing/ledger?cursor=garbage", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/billing/plans" })).statusCode).toBe(401);
  });

  it("rejects forged and stale webhooks (Review Focus 5) and stores each delivery once", async () => {
    const { app } = await setup();
    const body = JSON.stringify({ event_id: "evt_x", event_type: "customer.created", occurred_at: new Date().toISOString(), data: {} });
    const post = (sig?: string) =>
      app.inject({
        method: "POST",
        url: "/webhooks/paddle",
        headers: sig ? { "content-type": "application/json", "paddle-signature": sig } : { "content-type": "application/json" },
        payload: body,
      });
    expect((await post(signPaddleWebhook("x".repeat(40), body, new Date()))).statusCode).toBe(401);
    expect((await post(signPaddleWebhook(SECRET, body, new Date(Date.now() - 600_000)))).statusCode).toBe(401);
    expect((await post()).statusCode).toBe(401);
    const none = await ownerQuery<{ n: number }>(`select (select count(*)::int from platform.webhook_events) + (select count(*)::int from platform.outbox) as n`);
    expect(none[0]?.n).toBe(0);
    expect((await post(signPaddleWebhook(SECRET, body, new Date()))).statusCode).toBe(200);
    expect((await post(signPaddleWebhook(SECRET, body, new Date()))).statusCode).toBe(200);
    const stored = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.webhook_events`);
    expect(stored[0]?.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/api/src/rate-limit` → FAIL (the webhook call is limited: 429 after the first request). `npx tsc -p tsconfig.json` → FAIL (`createBillingModule` missing).

- [ ] **Step 3: Exempt webhooks from the IP limiter** — in `apps/api/src/rate-limit/plugin.ts`, after `if (path.startsWith("/health/")) return;` add:
```ts
    // Signed provider callbacks: the provider retries on 429, and blocking it would delay payments.
    if (path.startsWith("/webhooks/")) return;
```

- [ ] **Step 4: Implement the routes** — `apps/api/src/modules/billing/routes.ts`

```ts
import type { FastifyInstance } from "fastify";
import {
  billingPlansSchema,
  billingSummarySchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  invoicesResponseSchema,
  ledgerPageSchema,
  ledgerQuerySchema,
  planChangeRequestSchema,
  planChangeResponseSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { WebhookPayloadError, type PaymentEvent, type Payments } from "@mushin/integrations";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { BillingService } from "./service";

export function registerBillingRoutes(app: FastifyInstance, guards: Guards, service: BillingService, payments: Payments): void {
  const read = { preHandler: guards.customer };
  const write = { preHandler: [guards.customer, guards.idempotent] };

  app.get("/v1/billing/summary", read, async (req, reply) => sendOk(reply, billingSummarySchema, await service.summary(tenantOf(req))));
  app.get("/v1/billing/plans", read, async (req, reply) => sendOk(reply, billingPlansSchema, await service.plans(tenantOf(req))));
  app.get("/v1/billing/ledger", read, async (req, reply) => {
    const q = parseInput(ledgerQuerySchema, req.query);
    return sendOk(reply, ledgerPageSchema, await service.ledger(tenantOf(req), q));
  });
  app.get("/v1/billing/invoices", read, async (req, reply) => sendOk(reply, invoicesResponseSchema, await service.invoices(tenantOf(req))));

  app.post("/v1/billing/checkout", write, async (req, reply) => {
    const body = parseInput(checkoutRequestSchema, req.body);
    if (!req.customer) throw new AppError("UNAUTHENTICATED", "Authentication required");
    const result = await service.startCheckout({ ...tenantOf(req), email: req.customer.email }, body);
    return sendOk(reply, checkoutResponseSchema, result, 201);
  });
  app.post("/v1/billing/subscription/change", write, async (req, reply) => {
    const body = parseInput(planChangeRequestSchema, req.body);
    return sendOk(reply, planChangeResponseSchema, await service.requestPlanChange(tenantOf(req), body), 202);
  });
  app.post("/v1/billing/subscription/cancel", write, async (req, reply) =>
    sendOk(reply, planChangeResponseSchema, await service.requestCancel(tenantOf(req)), 202),
  );

  // Payment provider → MUSHIN. The signature covers the raw body, so this scope keeps JSON unparsed.
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/webhooks/paddle", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const header = req.headers["paddle-signature"];
      let event: PaymentEvent;
      try {
        event = payments.verifyWebhook(raw, typeof header === "string" ? header : undefined);
      } catch (err) {
        if (err instanceof WebhookPayloadError) {
          req.log.error({ err }, "signed payment webhook has an unexpected shape");
          throw new AppError("VALIDATION_FAILED", "Unexpected webhook payload");
        }
        req.log.warn({ err }, "rejected a payment webhook");
        throw new AppError("UNAUTHENTICATED", "Invalid webhook signature");
      }
      await service.recordWebhook(event, raw, req.id);
      return reply.status(200).send({ received: true });
    });
  });
}
```

`apps/api/src/modules/billing/mock-routes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@mushin/core";
import { parseInput } from "../../http/validate";
import type { CheckoutRow } from "./repository";
import type { BillingService } from "./service";

const params = z.object({ id: z.uuid() });
const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITY[c] ?? c);

function describeItem(c: CheckoutRow): string {
  if (c.kind === "topup") return `Credit top-up (${c.topupPackId ?? "pack"})`;
  return `${c.planId ?? "plan"} plan, billed ${c.billingInterval === "year" ? "yearly" : "monthly"}`;
}

function checkoutPage(c: CheckoutRow): string {
  const amount = `$${(c.amountMinor / 100).toFixed(2)} ${c.currency}`;
  const open = c.status === "open";
  const action = (outcome: "pay" | "fail") => `/mock-paddle/checkout/${encodeURIComponent(c.id)}/${outcome}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test checkout · MUSHIN</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 10px 30px rgba(15, 23, 42, .08); }
  .badge { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  h1 { font-size: 20px; margin: 16px 0 4px; } p { color: #475569; font-size: 14px; line-height: 1.5; }
  .amount { font-size: 32px; font-weight: 600; margin: 20px 0; }
  button { width: 100%; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 10px; }
  .pay { background: #0f172a; color: #fff; border: 0; } .fail { background: #fff; color: #b91c1c; border: 1px solid #fecaca; }
</style></head>
<body><main>
  <span class="badge">Test mode: no real payment</span>
  <h1>${escapeHtml(describeItem(c))}</h1>
  <p>This page stands in for Paddle's hosted checkout until sandbox keys are configured.</p>
  <div class="amount">${escapeHtml(amount)}</div>
  ${
    open
      ? `<form method="post" action="${escapeHtml(action("pay"))}"><button class="pay" type="submit">Pay ${escapeHtml(amount)}</button></form>
  <form method="post" action="${escapeHtml(action("fail"))}"><button class="fail" type="submit">Simulate failed payment</button></form>`
      : `<p>This checkout is already ${escapeHtml(c.status)}.</p>`
  }
</main></body></html>`;
}

/** Only registered when the mock payment provider is active (never in production; config refuses it). */
export function registerMockPaddleRoutes(app: FastifyInstance, service: BillingService, appUrl: string): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.get("/mock-paddle/checkout/:id", async (req, reply) => {
      const { id } = parseInput(params, req.params);
      const checkout = await service.mockCheckout(id);
      if (!checkout) throw new AppError("NOT_FOUND", "Checkout not found");
      return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(checkoutPage(checkout));
    });
    for (const outcome of ["pay", "fail"] as const) {
      scope.post(`/mock-paddle/checkout/:id/${outcome}`, async (req, reply) => {
        const { id } = parseInput(params, req.params);
        await service.completeMockCheckout(id, outcome === "pay" ? "paid" : "failed");
        return reply.redirect(`${appUrl}/?checkout=${outcome === "pay" ? "success" : "failed"}#/dashboard`, 303);
      });
    }
  });
}
```

Replace `apps/api/src/modules/billing/index.ts`:
```ts
import { isMockPayments, type Payments } from "@mushin/integrations";
import type { AppModule } from "../../http/types";
import { registerMockPaddleRoutes } from "./mock-routes";
import { registerBillingRoutes } from "./routes";
import type { BillingService } from "./service";

export { createCreditEngine } from "./engine";
export type { Actor, Balance, CreditEngine, GrantRequest, SpendRequest } from "./engine";
export { createBillingService } from "./service";
export type { BillingDeps, BillingService, Customer } from "./service";
export { createRedisAccessCache, MemoryAccessCache, noAccessCache } from "./access-cache";
export type { Access, AccessCache, RedisLike } from "./access-cache";
export type { BillingJob } from "./repository";

export function createBillingModule(o: { service: BillingService; payments: Payments; appUrl: string }): AppModule {
  return {
    name: "billing",
    register(app, guards) {
      registerBillingRoutes(app, guards, o.service, o.payments);
      if (isMockPayments(o.payments)) registerMockPaddleRoutes(app, o.service, o.appUrl);
    },
  };
}
```

- [ ] **Step 5: Wire the server** — `apps/api/src/server.ts`

Replace the `createCreditEngine` import with:
```ts
import { Redis } from "@upstash/redis";
import { createDbProviderCallSink } from "@mushin/db";
import { createPayments } from "@mushin/integrations";
import { createBillingModule, createBillingService, createRedisAccessCache, noAccessCache } from "./modules/billing";
```
(merge `createDbProviderCallSink` into the existing `@mushin/db` import). Replace the identity line with:
```ts
const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const accessCache = config.rateLimit.upstash
  ? createRedisAccessCache(new Redis({ url: config.rateLimit.upstash.url, token: config.rateLimit.upstash.token }), logger)
  : noAccessCache;
const billing = createBillingService({ db, payments, cache: accessCache, logger });
const identity = createIdentityModule({ db, startTrial: billing.startTrial });
```
and change `modules` to:
```ts
  modules: [platform.module, identity.module, staff.module, createBillingModule({ service: billing, payments, appUrl: config.appUrl })],
```

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass (rate-limit test now includes the webhook case).
Run: `npm run test:int` → billing API 3 tests pass, or record that they did not run.
Smoke test the real server: `node --env-file-if-exists=.env --import tsx apps/api/src/server.ts`, then
`curl -s -o /dev/null -w "%{http_code}" localhost:4000/v1/billing/plans` → `401`;
`curl -s -X POST localhost:4000/webhooks/paddle -H "content-type: application/json" -d "{}"` → `401` envelope. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(billing): add billing API, signed webhook intake and the mock hosted checkout"
```

---

### Task 11: Worker billing handlers and schedules

**Files:**
- Create: `apps/worker/src/billing-handlers.ts`, `apps/worker/src/schedules.ts`
- Modify: `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`, `apps/worker/src/queues.test.ts`, `apps/worker/package.json`

**Interfaces:**
- Consumes: `BillingService` (`processStoredWebhook`, `runJob`), `BillingJob`, `createBillingService`, `createRedisAccessCache`, `noAccessCache` from `../../api/src/modules/billing/index`; `createPayments`; `WorkerConfig` (`payments`, `upstash`).
- Produces: `billingHandlers(billing: Pick<BillingService, "processStoredWebhook" | "runJob">): HandlerRegistry`; `notifyHandlers(): HandlerRegistry`; `NOTIFY_EVENTS`; `SCHEDULES: Schedule[]` with `type Schedule = { queue: QueueName; key: string; cron: string; data: JobData }`.

- [ ] **Step 1: Write the failing tests** — in `apps/worker/src/queues.test.ts`, add the two imports below to the import block at the top of the file and append the `describe` block:

```ts
import { billingHandlers, NOTIFY_EVENTS, notifyHandlers } from "./billing-handlers";
import { SCHEDULES } from "./schedules";

describe("billing handlers", () => {
  const job = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: "e",
    eventType,
    aggregateType: "x",
    aggregateId: "1",
    workspaceId: null,
    requestId: null,
    payload,
  });

  it("applies stored webhooks and runs named jobs", async () => {
    const calls: string[] = [];
    const handlers = billingHandlers({
      processStoredWebhook: async (id) => void calls.push(`webhook:${id}`),
      runJob: async (name) => {
        calls.push(`job:${name}`);
        return { processed: 0 };
      },
    });
    const dispatch = createDispatcher({ ...handlers, ...notifyHandlers() }, createLogger({ level: "silent" }));
    await dispatch([{ id: "j1", data: job("billing.webhook_received", { webhookEventId: "w1" }) }]);
    await dispatch([{ id: "j2", data: job("billing.job", { job: "expire_lots" }) }]);
    await dispatch([{ id: "j3", data: job("notify.credits_low", {}) }]);
    expect(calls).toEqual(["webhook:w1", "job:expire_lots"]);
    await expect(dispatch([{ id: "j4", data: job("billing.job", { job: "drop_tables" }) }])).rejects.toThrow(/unknown billing job/);
  });

  it("schedules every billing job once, on routable queues", () => {
    const keys = SCHEDULES.map((s) => `${s.queue}:${s.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SCHEDULES) expect(queueFor(s.data.eventType)).toBe(s.queue);
    expect(SCHEDULES.filter((s) => s.queue === "billing").map((s) => s.key).sort()).toEqual(
      ["end_trials", "expire_lots", "mock_renewals", "monthly_grants", "reconcile", "release_abandoned", "scheduled_changes", "trial_notices"],
    );
    expect(NOTIFY_EVENTS.every((t) => queueFor(t) === "notify")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run --project unit apps/worker` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`apps/worker/src/billing-handlers.ts`:
```ts
import type { BillingJob, BillingService } from "../../api/src/modules/billing/index";
import type { Handler, HandlerRegistry } from "./dispatcher";

const JOBS: readonly BillingJob[] = [
  "release_abandoned",
  "expire_lots",
  "end_trials",
  "trial_notices",
  "monthly_grants",
  "scheduled_changes",
  "reconcile",
  "mock_renewals",
];
const isBillingJob = (v: unknown): v is BillingJob => typeof v === "string" && (JOBS as readonly string[]).includes(v);

export function billingHandlers(billing: Pick<BillingService, "processStoredWebhook" | "runJob">): HandlerRegistry {
  return {
    "billing.webhook_received": async (data) => {
      const id = data.payload["webhookEventId"];
      if (typeof id !== "string") throw new Error("billing.webhook_received without webhookEventId");
      await billing.processStoredWebhook(id);
    },
    "billing.job": async (data, { logger }) => {
      const job = data.payload["job"];
      if (!isBillingJob(job)) throw new Error(`unknown billing job ${String(job)}`);
      const result = await billing.runJob(job);
      logger.info({ job, ...result }, "billing job finished");
    },
  };
}

export const NOTIFY_EVENTS = [
  "notify.credits_low",
  "notify.credits_very_low",
  "notify.trial_ending",
  "notify.trial_expired",
  "notify.subscription_canceled",
  "notify.payment_failed",
] as const;

/** Delivery (in-app notifications, emails) arrives in sub-project 7; until then the events are logged and acknowledged. */
const logOnly: Handler = async (data, { logger }) => {
  logger.info({ eventType: data.eventType, workspaceId: data.workspaceId }, "notification event received (delivery arrives in sub-project 7)");
};

export function notifyHandlers(): HandlerRegistry {
  return Object.fromEntries(NOTIFY_EVENTS.map((eventType) => [eventType, logOnly]));
}
```

`apps/worker/src/schedules.ts`:
```ts
import type { JobData } from "./dispatcher";
import type { QueueName } from "./queues";

export type Schedule = { queue: QueueName; key: string; cron: string; data: JobData };

const data = (key: string, eventType: string, payload: Record<string, unknown>): JobData => ({
  eventId: `cron-${key}`,
  eventType,
  aggregateType: "system",
  aggregateId: key,
  workspaceId: null,
  requestId: null,
  payload,
});
const billing = (key: string, cron: string): Schedule => ({ queue: "billing", key, cron, data: data(key, "billing.job", { job: key }) });

/** Umbrella spec §7.3. Daily billing jobs run in this order: grants, downgrades, then mock renewals. */
export const SCHEDULES: Schedule[] = [
  { queue: "system", key: "purge_expired", cron: "15 3 * * *", data: data("purge_expired", "system.purge_expired", {}) },
  billing("release_abandoned", "* * * * *"),
  billing("expire_lots", "5 * * * *"),
  billing("end_trials", "10 * * * *"),
  billing("trial_notices", "20 * * * *"),
  billing("monthly_grants", "30 2 * * *"),
  billing("scheduled_changes", "40 2 * * *"),
  billing("mock_renewals", "50 2 * * *"),
  billing("reconcile", "30 4 * * *"),
];
```

In `apps/worker/src/worker.ts`, add `import { SCHEDULES } from "./schedules";` and replace the single `await o.boss.schedule("system", "15 3 * * *", { … });` call with:
```ts
  // Older builds created a key-less schedule on "system"; keyed schedules replace it.
  await o.boss.unschedule("system");
  for (const s of SCHEDULES) await o.boss.schedule(s.queue, s.cron, s.data, { key: s.key });
```

`apps/worker/src/main.ts` (replace the handler wiring):
```ts
import { Redis } from "@upstash/redis";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createPayments } from "@mushin/integrations";
import { createBillingService, createRedisAccessCache, noAccessCache } from "../../api/src/modules/billing/index";
import { billingHandlers, notifyHandlers } from "./billing-handlers";
import { startBoss } from "./boss";
import { defaultHandlers } from "./handlers";
import { startWorker } from "./worker";

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.logLevel, name: "worker" });
if (!config.databaseCaPem) logger.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.directUrl, { max: 5, applicationName: "mushin-worker", caPem: config.databaseCaPem });
const boss = await startBoss(config.directUrl, logger, config.databaseCaPem);
const payments = createPayments(config.payments, { sink: createDbProviderCallSink(db), logger });
const cache = config.upstash ? createRedisAccessCache(new Redis({ url: config.upstash.url, token: config.upstash.token }), logger) : noAccessCache;
const billing = createBillingService({ db, payments, cache, logger });
const worker = await startWorker({
  db,
  boss,
  logger,
  handlers: { ...defaultHandlers(db), ...billingHandlers(billing), ...notifyHandlers() },
});
logger.info("worker started");
```
(keep the existing `shutdown` block below unchanged). Add `"@mushin/integrations": "*"` and `"@upstash/redis": "^1.39.0"` to `apps/worker/package.json` dependencies and run `npm install`.

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass (worker unit tests: 5).
Run: `npm run test:int` → worker integration tests still pass, or record that they did not run.

- [ ] **Step 5: Commit**

```bash
git add apps/worker package-lock.json
git commit -m "feat(worker): apply payment webhooks and schedule billing jobs"
```

---

### Task 12: Frontend billing wiring

**Files:**
- Create: `frontend/src/app/api/billing.ts`, `frontend/src/app/components/dashboard/BillingStatusBanner.tsx`
- Modify: `frontend/src/app/lib/credits.ts`, `frontend/src/app/components/dashboard/Billing.tsx` (full replacement), `Topbar.tsx`, `Overview.tsx`, `Dashboard.tsx`

**Interfaces:**
- Consumes: billing contracts; `GET /v1/billing/{summary,plans,ledger,invoices}`, `POST /v1/billing/{checkout,subscription/change,subscription/cancel}`.
- Produces: hooks `useBillingSummary()`, `useBillingPlans()`, `useLedger(enabled)`, `useInvoices(enabled)`, `useStartCheckout()`, `useChangePlan()`, `useCancelSubscription()`; `useCredits()` now returns the API's available balance.

- [ ] **Step 1: API hooks** — `frontend/src/app/api/billing.ts`

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  billingPlansSchema,
  billingSummarySchema,
  checkoutResponseSchema,
  invoicesResponseSchema,
  ledgerPageSchema,
  planChangeResponseSchema,
  type CheckoutRequest,
  type PlanChangeRequest,
} from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";

const keys = {
  all: ["billing"] as const,
  summary: ["billing", "summary"] as const,
  plans: ["billing", "plans"] as const,
  ledger: ["billing", "ledger"] as const,
  invoices: ["billing", "invoices"] as const,
};

export function useBillingSummary() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => apiRequest("/v1/billing/summary", billingSummarySchema),
    enabled: status === "signedIn",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useBillingPlans() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.plans,
    queryFn: () => apiRequest("/v1/billing/plans", billingPlansSchema),
    enabled: status === "signedIn",
    staleTime: 5 * 60_000,
  });
}

export function useLedger(enabled: boolean) {
  return useQuery({ queryKey: keys.ledger, queryFn: () => apiRequest("/v1/billing/ledger?limit=20", ledgerPageSchema), enabled });
}

export function useInvoices(enabled: boolean) {
  return useQuery({ queryKey: keys.invoices, queryFn: () => apiRequest("/v1/billing/invoices", invoicesResponseSchema), enabled });
}

/** Opens the payment provider's hosted checkout (mock or Paddle) in this tab. */
export function useStartCheckout() {
  return useMutation({
    mutationFn: (req: CheckoutRequest) =>
      apiRequest("/v1/billing/checkout", checkoutResponseSchema, { method: "POST", body: req, idempotencyKey: crypto.randomUUID() }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PlanChangeRequest) =>
      apiRequest("/v1/billing/subscription/change", planChangeResponseSchema, { method: "POST", body: req, idempotencyKey: crypto.randomUUID() }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest("/v1/billing/subscription/cancel", planChangeResponseSchema, { method: "POST", idempotencyKey: crypto.randomUUID() }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useRefreshBilling() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}
```

- [ ] **Step 2: Credits come from the API** — replace `frontend/src/app/lib/credits.ts`

```ts
import { useBillingSummary } from "../api/billing";

/** Shown before confirming; the server enforces the real costs (and refuses a stale one). */
export const CREDIT_COST = {
  searchExisting: 0,
  findNew: 12,
  revealContact: 5,
  refreshData: 10,
} as const;

/** Available credits from the billing API (0 while loading). */
export function useCredits(): number {
  return useBillingSummary().data?.balance.available ?? 0;
}

/**
 * Demo credit actions on other screens become real in sub-projects 3-4. Until then they no longer
 * change the displayed balance, so the meter always shows real data.
 */
export function spendCredits(cost: number): boolean {
  return Number.isInteger(cost) && cost >= 0;
}
```

- [ ] **Step 3: Credit meter colours in the top bar** — `frontend/src/app/components/dashboard/Topbar.tsx`

Add the import `import { useBillingSummary } from "../../api/billing";` and, above the component:
```tsx
const METER_STYLES = {
  normal: { box: "border-slate-200 bg-white hover:bg-slate-50", icon: "text-emerald-600", value: "text-slate-900", title: "Credits" },
  amber: { box: "border-amber-300 bg-amber-50 hover:bg-amber-100", icon: "text-amber-600", value: "text-amber-800", title: "Credits are running low" },
  red: { box: "border-red-300 bg-red-50 hover:bg-red-100", icon: "text-red-600", value: "text-red-700", title: "Credits are very low" },
} as const;
```
Inside `Topbar`, after `const [open, setOpen] = useState(false);` add `const meter = useBillingSummary().data?.balance.meter ?? "normal";`, and replace the credits `<div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 sm:flex">…</div>` with:
```tsx
        <button
          onClick={() => go("billing")}
          title={METER_STYLES[meter].title}
          aria-label={`${METER_STYLES[meter].title}: ${credits} available`}
          className={`hidden items-center gap-2 rounded-md border px-3 py-1.5 transition-colors sm:flex ${METER_STYLES[meter].box}`}
        >
          <Coins className={`h-3.5 w-3.5 ${METER_STYLES[meter].icon}`} strokeWidth={2} />
          <span className="text-xs text-slate-500">Credits</span>
          <span className={`text-sm tabular-nums ${METER_STYLES[meter].value}`} style={{ fontWeight: 600 }}>
            <AnimatedNumber value={credits} />
          </span>
        </button>
```

- [ ] **Step 4: Trial and lost-access banner** — `frontend/src/app/components/dashboard/BillingStatusBanner.tsx`

```tsx
import { AlertTriangle, Sparkles } from "lucide-react";
import type { LostAccessItem } from "@mushin/contracts";
import { useBillingSummary } from "../../api/billing";

const LOST_LABEL: Record<LostAccessItem, string> = {
  find_new: "finding new creators",
  reveal_contact: "revealing contact details",
  refresh_data: "refreshing creator data",
  monthly_credits: "monthly credits",
  outreach: "outreach emails",
  audience_details: "audience details",
  export: "data export",
};

/** SRS REQ-08.04 / §4.8.2: a clear upgrade prompt, and exactly what was lost when no plan is active. */
export function BillingStatusBanner({ onChoosePlan }: { onChoosePlan: () => void }) {
  const { data } = useBillingSummary();
  if (!data) return null;

  if (data.status === "trialing" && data.trialDaysLeft !== null) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" strokeWidth={2} />
          Free trial: {data.trialDaysLeft} {data.trialDaysLeft === 1 ? "day" : "days"} left · {data.balance.available} credits
        </span>
        <button onClick={onChoosePlan} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700" style={{ fontWeight: 600 }}>
          Choose a plan
        </button>
      </div>
    );
  }

  if (data.lostAccess.length > 0) {
    const ended = data.status === "canceled" ? "Your subscription has ended." : "Your free trial has ended.";
    return (
      <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="inline-flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" strokeWidth={2} />
          <span>
            <span style={{ fontWeight: 600 }}>{ended}</span> You no longer have access to {data.lostAccess.map((k) => LOST_LABEL[k]).join(", ")}.
            Searching existing creators and your lists still work.
          </span>
        </span>
        <button onClick={onChoosePlan} className="flex-shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>
          Choose a plan
        </button>
      </div>
    );
  }
  return null;
}
```

- [ ] **Step 5: Real Billing screen** — replace `frontend/src/app/components/dashboard/Billing.tsx`

```tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Check, CheckCircle2, CreditCard, Lock, Mail, Plus, Radio, RefreshCw, Search, Smartphone, XCircle } from "lucide-react";
import type { BillingInterval, CreditAction, PlanId } from "@mushin/contracts";
import { AnimatedNumber } from "./AnimatedNumber";
import { COPY } from "../../lib/copy";
import {
  useBillingPlans,
  useBillingSummary,
  useCancelSubscription,
  useChangePlan,
  useInvoices,
  useLedger,
  useRefreshBilling,
  useStartCheckout,
} from "../../api/billing";

/**
 * Credits & billing. Prices are shown in PKR and charged in USD by the payment provider (spec D1).
 * Every purchase opens the provider's hosted checkout (REQ-08.01). The spend-caps section is hidden (spec D6).
 */

const ACTION_META: Record<CreditAction, { label: string; icon: typeof Search; tone: string }> = {
  search_existing: { label: COPY.searchExisting, icon: Search, tone: "bg-slate-100 text-slate-600" },
  find_new: { label: COPY.findNew, icon: Radio, tone: "bg-indigo-50 text-indigo-700" },
  reveal_contact: { label: COPY.revealContact, icon: Mail, tone: "bg-emerald-50 text-emerald-700" },
  refresh_data: { label: COPY.refreshData, icon: RefreshCw, tone: "bg-amber-50 text-amber-700" },
};

const KIND_LABEL = {
  grant: "Credits added",
  spend: "Credits spent",
  refund: "Refund",
  expire: "Credits expired",
  adjust: "Adjustment",
  reserve: "Credits reserved",
  release: "Reservation released",
} as const;

const formatMoney = (m: { amountMinor: number; currency: string }) =>
  m.currency === "PKR" ? `Rs. ${(m.amountMinor / 100).toLocaleString("en-PK")}` : `$${(m.amountMinor / 100).toFixed(2)}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const paymentMethods = [
  { id: "pm-1", kind: "easypaisa", label: "EasyPaisa wallet", detail: "0300 •••• 4521", badge: "EP", tone: "bg-emerald-600", primary: true },
  { id: "pm-2", kind: "jazzcash", label: "JazzCash wallet", detail: "0321 •••• 8890", badge: "JC", tone: "bg-red-600", primary: false },
  { id: "pm-3", kind: "card", label: "Visa debit", detail: "•••• •••• •••• 6042", badge: "", tone: "bg-slate-800", primary: false },
] as const;

export function Billing({ checkoutResult }: { checkoutResult?: "success" | "failed" | null }) {
  const summary = useBillingSummary();
  const plans = useBillingPlans();
  const canManage = summary.data?.canPurchase ?? false;
  const ledger = useLedger(canManage);
  const invoices = useInvoices(canManage);
  const checkout = useStartCheckout();
  const changePlan = useChangePlan();
  const cancel = useCancelSubscription();
  const refresh = useRefreshBilling();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [showPlans, setShowPlans] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // After the hosted checkout returns, the webhook lands within seconds: refresh a few times.
  useEffect(() => {
    if (checkoutResult !== "success") return;
    const timers = [2000, 6000, 12000].map((ms) => window.setTimeout(() => void refresh(), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [checkoutResult, refresh]);

  const s = summary.data;
  const error = checkout.error ?? changePlan.error ?? cancel.error;
  const busy = checkout.isPending || changePlan.isPending || cancel.isPending;
  const hasPlan = Boolean(s?.plan);
  const trialing = s?.status === "trialing";

  const choosePlan = (planId: PlanId) => {
    setNotice(null);
    if (hasPlan) {
      changePlan.mutate(
        { planId, interval: billingInterval },
        {
          onSuccess: (r) =>
            setNotice(r.effective === "now" ? "Upgrade requested. Your new credits appear in a few seconds." : "Downgrade scheduled for the end of this billing period."),
        },
      );
    } else {
      checkout.mutate({ kind: "subscription", planId, interval: billingInterval });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Credits &amp; billing
        </h1>
        <p className="mt-1 text-sm text-slate-500">Your balance, plan, credit history and invoices.</p>
      </div>

      {checkoutResult && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${checkoutResult === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {checkoutResult === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {checkoutResult === "success" ? "Payment received. Your plan and credits update within a few seconds." : "The payment did not go through. No credits were charged."}
        </div>
      )}
      {(notice || error) && (
        <div role={error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-indigo-100 bg-indigo-50 text-indigo-900"}`}>
          {error ? error.message : notice}
        </div>
      )}

      {/* Balance row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceTile label="Available credits" value={s?.balance.available ?? 0} accent />
        <BalanceTile
          label="Reserved (held for running searches)"
          value={s?.balance.reserved ?? 0}
          sub={(s?.balance.reserved ?? 0) === 0 ? "Nothing running: no credits held" : "Released automatically if a job fails or stops"}
        />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider text-slate-400">Current plan</div>
          <div className="mt-1 text-white" style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {s?.plan ? `${s.plan.name} · ${s.interval === "year" ? "Yearly" : "Monthly"}` : trialing ? "Free trial" : "No active plan"}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {s?.plan && s.currentPeriodEnd
              ? s.cancelAtPeriodEnd
                ? `Ends on ${formatDate(s.currentPeriodEnd)}`
                : `Renews on ${formatDate(s.currentPeriodEnd)}`
              : trialing && s?.trialDaysLeft !== null && s?.trialDaysLeft !== undefined
                ? `${s.trialDaysLeft} days of trial left`
                : "Choose a plan to get monthly credits"}
          </div>
          {s?.scheduledChange && (
            <div className="mt-2 text-xs text-amber-300">
              Changes to {s.scheduledChange.planId} at the end of this period
            </div>
          )}
          {canManage && (
            <div className="mt-6 grid gap-2">
              <button
                onClick={() => setShowPlans((v) => !v)}
                className="w-full rounded-md bg-white px-3 py-2 text-sm text-slate-900 transition-all hover:-translate-y-px hover:shadow-md"
              >
                {hasPlan ? "Change plan" : "Choose a plan"}
              </button>
              {hasPlan && !s?.cancelAtPeriodEnd && (
                <button
                  disabled={busy}
                  onClick={() => cancel.mutate(undefined, { onSuccess: () => setNotice("Your subscription will end at the close of this billing period.") })}
                  className="w-full rounded-md border border-white/20 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Plans and top-ups */}
      {canManage && showPlans && plans.data && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Plans</div>
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
              {(["month", "year"] as const).map((i) => (
                <button key={i} onClick={() => setBillingInterval(i)} className={`rounded px-2.5 py-1 ${billingInterval === i ? "bg-slate-900 text-white" : "text-slate-600"}`}>
                  {i === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.data.plans.map((p) => {
              const current = s?.plan?.id === p.id && s.interval === billingInterval;
              const price = billingInterval === "month" ? p.display.monthly : p.display.yearlyPerMonth;
              return (
                <div key={p.id} className={`rounded-lg border p-4 ${current ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200"}`}>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="mt-1 text-slate-900" style={{ fontSize: 22, fontWeight: 600 }}>
                    {formatMoney(price)}
                    <span className="text-xs text-slate-500"> / month{billingInterval === "year" ? ", billed yearly" : ""}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {p.monthlyCredits.toLocaleString()} credits / month · charged {formatMoney(billingInterval === "month" ? p.charge.monthly : p.charge.yearly)}
                  </div>
                  <button
                    disabled={busy || current}
                    onClick={() => choosePlan(p.id)}
                    className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ fontWeight: 600 }}
                  >
                    {current ? "Current plan" : hasPlan ? `Switch to ${p.name}` : `Choose ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-6 text-sm text-slate-900" style={{ fontWeight: 600 }}>Credit top-ups</div>
          <div className="mt-1 text-xs text-slate-500">
            {trialing ? "Top-ups unlock once you choose a plan." : "Valid for 12 months. Spent after your monthly credits run out."}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.data.topupPacks.map((k) => (
              <button
                key={k.id}
                disabled={busy || trialing}
                onClick={() => checkout.mutate({ kind: "topup", packId: k.id })}
                className="rounded-lg border border-slate-200 p-4 text-left hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{k.credits.toLocaleString()} credits</div>
                <div className="text-xs text-slate-500">
                  {formatMoney(k.display)} · charged {formatMoney(k.charge)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reservation model explainer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-xs text-indigo-900">
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500" strokeWidth={2} />
        <div style={{ lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>How live discovery is billed.</span> When you start a live search we reserve its credits up front.
          If the search fails, the reserved credits are released back to your balance automatically.
        </div>
      </div>

      {/* Credit history (the ledger) */}
      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Credit history</div>
            <div className="text-xs text-slate-500">Every credit added, reserved, spent, released and expired</div>
          </div>
          <div className="divide-y divide-slate-100">
            {(ledger.data?.entries ?? []).map((e) => {
              const meta = e.action ? ACTION_META[e.action] : null;
              const Icon = meta?.icon ?? Plus;
              // Reserve rows store the held amount as a positive number; show it as a deduction.
              const signed = e.kind === "reserve" ? -e.amount : e.amount;
              return (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta?.tone ?? "bg-slate-100 text-slate-600"}`}>
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{meta ? `${KIND_LABEL[e.kind]} · ${meta.label}` : KIND_LABEL[e.kind]}</span>
                      <span className="text-[11px] text-slate-400">{formatDate(e.createdAt)}</span>
                    </div>
                    {e.note && <div className="truncate text-xs text-slate-500">{e.note}</div>}
                  </div>
                  <span className={`flex-shrink-0 tabular-nums text-sm ${signed < 0 ? "text-slate-900" : "text-emerald-700"}`} style={{ fontWeight: 600 }}>
                    {signed > 0 ? `+${signed}` : signed}
                  </span>
                </div>
              );
            })}
            {ledger.data && ledger.data.entries.length === 0 && <div className="px-5 py-6 text-sm text-slate-500">No credit activity yet.</div>}
          </div>
        </div>
      )}

      {/* Invoices */}
      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Invoices</div>
          <div className="mt-4 space-y-3">
            {(invoices.data?.invoices ?? []).map((i) => (
              <div key={i.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                <div>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{formatDate(i.createdAt)}</div>
                  <div className="text-xs text-slate-500">{i.kind === "topup" ? "Credit top-up" : "Subscription"}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{i.status}</span>
                  <span className="tabular-nums text-sm text-slate-900" style={{ fontWeight: 500 }}>{formatMoney(i.amount)}</span>
                  {i.invoiceUrl ? (
                    <a href={i.invoiceUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700" aria-label="Open invoice">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {invoices.data && invoices.data.invoices.length === 0 && <div className="text-sm text-slate-500">No payments yet.</div>}
          </div>
        </div>
      )}

      {/* Payment methods: unchanged sample data until sub-project 7 removes EasyPaisa/JazzCash. */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Payment methods</div>
          <div className="text-xs text-slate-500">How you top up credits and pay invoices.</div>
        </div>
        <div className="mt-4 space-y-2.5">
          {paymentMethods.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white ${m.tone}`}>
                {m.kind === "card" ? <CreditCard className="h-4 w-4" strokeWidth={1.75} /> : <span className="text-[11px]" style={{ fontWeight: 700 }}>{m.badge}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{m.label}</span>
                  {m.primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
                      <Check className="h-2.5 w-2.5" strokeWidth={2.5} /> Primary
                    </span>
                  )}
                </div>
                <div className="tabular-nums text-xs text-slate-500">{m.detail}</div>
              </div>
              {m.kind !== "card" && <Smartphone className="h-4 w-4 flex-shrink-0 text-slate-300" strokeWidth={1.75} />}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400" style={{ lineHeight: 1.5 }}>
          Sample data for demonstration.
        </p>
      </div>
    </div>
  );
}

function BalanceTile({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 tabular-nums ${accent ? "text-slate-900" : "text-slate-700"}`} style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
        <AnimatedNumber value={value} />
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>{sub}</div>}
    </motion.div>
  );
}
```

- [ ] **Step 6: Overview and Dashboard**

`frontend/src/app/components/dashboard/Overview.tsx`: remove `import { CURRENT_PLAN } from "../../lib/credits";`, add `import { useBillingPlans, useBillingSummary } from "../../api/billing";`. In `CreditBalanceCard`, replace `const max = CURRENT_PLAN.credits;` with:
```tsx
  const summary = useBillingSummary().data;
  const max = Math.max(1, summary?.balance.base ?? 1);
  const renewal = summary?.currentPeriodEnd
    ? `${summary.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${new Date(summary.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : summary?.status === "trialing"
      ? `Trial: ${summary.trialDaysLeft ?? 0} days left`
      : "No active plan";
```
and replace `<span>Renews on Aug 3</span>` with `<span>{renewal}</span>`, and `of {max.toLocaleString()} monthly credits` with `of {max.toLocaleString()} {summary?.status === "trialing" ? "trial" : "monthly"} credits`.
In `SubscriptionCard`, add at the top of the function:
```tsx
  const summary = useBillingSummary().data;
  const plans = useBillingPlans().data;
  const plan = plans?.plans.find((p) => p.id === summary?.plan?.id);
  const price = plan ? (summary?.interval === "year" ? plan.display.yearlyPerMonth : plan.display.monthly) : null;
```
then replace ``subtitle={`${CURRENT_PLAN.name} · Monthly`}`` with ``subtitle={summary?.plan ? `${summary.plan.name} · ${summary.interval === "year" ? "Yearly" : "Monthly"}` : summary?.status === "trialing" ? "Free trial" : "No active plan"}``, the badge text `Active` with `{summary?.status === "active" ? "Active" : summary?.status === "trialing" ? "Trial" : "Inactive"}`, `Rs. {CURRENT_PLAN.monthly.toLocaleString()}` with `{price ? `Rs. ${(price.amountMinor / 100).toLocaleString("en-PK")}` : "—"}`, and `Renews Jul 04 · JazzCash •••• 8241` with `{summary?.currentPeriodEnd ? `Renews ${new Date(summary.currentPeriodEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "Choose a plan in Credits & billing"}`.

`frontend/src/app/components/dashboard/Dashboard.tsx`: add `import { useEffect } from "react";` (merge with the existing `useState` import) and `import { BillingStatusBanner } from "./BillingStatusBanner";`. Inside `Dashboard`, after `const credits = useCredits();` add:
```tsx
  // Returning from the hosted checkout: ?checkout=success|failed (query string before the hash route).
  const [checkoutResult, setCheckoutResult] = useState<"success" | "failed" | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("checkout");
    if (value !== "success" && value !== "failed") return;
    setCheckoutResult(value);
    setView("billing");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }, []);
```
Render the banner as the first child of `<main …>`: `<BillingStatusBanner onChoosePlan={() => setView("billing")} />`, and change `{view === "billing" && <Billing credits={credits} />}` to `{view === "billing" && <Billing checkoutResult={checkoutResult} />}`.

- [ ] **Step 7: Build and check**

Run: `npm --prefix frontend run build` → succeeds.
Run: `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` → pass.
Browser check (needs the API with a working database): sign in, open Credits & billing, choose Growth, pay on the test-mode page, return to the dashboard and see the plan, balance and invoice update; let the balance fall into amber/red and see the top-bar meter change. If the database is not configured yet, record that this check is pending.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): real credit meter, billing screen, trial banner and hosted checkout flow"
```

---

### Task 13: Final verification, docs and spec notes

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-07-billing-credits-design.md`

- [ ] **Step 1: README billing section** — append to `README.md`:

````markdown
## Billing (sub-project 2)

- Without Paddle keys the API uses a **mock payment provider**: purchases open a test-mode checkout page at
  `PUBLIC_API_URL/mock-paddle/checkout/<id>` with **Pay** and **Simulate failed payment**. `npm run env:secrets` creates
  `MOCK_PADDLE_WEBHOOK_SECRET`. Run both the API and the worker so webhooks are applied.
- Switching to Paddle sandbox:
  1. Create a sandbox account (sandbox-vendors.paddle.com), products and prices for the three plans (monthly and yearly) and the three top-up packs.
  2. Put the sandbox price ids into `platform.plans.paddle_price_ids` and `platform.topup_packs.paddle_price_id` (replacing the `pri_mock_*` ids).
  3. Set a default payment link, and a notification destination pointing to `<public API URL>/webhooks/paddle`.
  4. Set `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT=sandbox` and restart the API and the worker.
- Prices, credit costs, trial length and meter thresholds live in `platform.plans`, `platform.topup_packs`,
  `platform.credit_action_costs` and `platform.billing_settings` and can be changed without a deploy.
````

- [ ] **Step 2: Record implementation notes in the spec** — append to `docs/superpowers/specs/2026-10-07-billing-credits-design.md`:

```markdown
## 14. Implementation notes (from the plan)

- Worker-side writes use `db.withWorkspace(workspaceId)` (role `mushin_worker` with workspace RLS context). To find due work across workspaces the worker has `SELECT`-only RLS policies on `wp.subscriptions`, `wp.credit_lots`, `wp.credit_reservations` and `wp.checkouts`; every write still requires workspace context.
- `mushin_app` also has `UPDATE` on `wp.subscriptions` (scheduled downgrades are recorded by the API request) and on `wp.checkouts` (status after provider errors).
- Meter alerts are written when a reservation lowers the available balance; a commit does not change `available` because the held amount was already subtracted.
- Webhook intake runs as `mushin_worker` (`withSystem`), which owns `platform.webhook_events`.
- Notification events use the `notify.` prefix so the existing outbox router sends them to the `notify` queue.
- The mock provider's invoices have no URL; Paddle invoice links arrive with real Paddle.
- The public landing pricing page (`frontend/src/app/components/landing/Pricing.tsx`) keeps its static marketing prices: it is shown before sign-in and `GET /v1/billing/plans` requires a customer token. The seeded values match it; signed-in screens read prices from the API.
```

- [ ] **Step 3: Full verification**

Run: `npm run verify` → lint, typecheck, boundaries, unit and integration tests pass. Without `TEST_DATABASE_URL`, run `npm run lint && npm run typecheck && npm run boundaries && npm run test:unit` and report the integration suites as not yet run.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-07-billing-credits-design.md
git commit -m "docs: document billing setup and record implementation notes"
```

---

## Deferred (by design)

- Grace period for failed payments and the full usage dashboard (SRS REQ-08.05, S2).
- Staff credit adjustments and refunds UI, and the admin cost view enforcing the 3× rule (sub-project 8).
- Notification delivery for the `notify.*` events (sub-project 7).
- Removing the EasyPaisa/JazzCash sample payment methods (sub-project 7).
- Real credit-spending actions in search and discovery (sub-projects 3–4) — they call `billing.reserve/commit/release/spendInstant/extend` or the tx-level `billing.engine`.
