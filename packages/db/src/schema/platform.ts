import { boolean, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

/** Provider families an Admin can pause (migration 0033); the worker refuses a paused family's calls. */
export const providerControls = platformSchema.table("provider_controls", {
  provider: text("provider", { enum: ["apify", "serper", "llm", "youtube"] }).primaryKey(),
  paused: boolean("paused").notNull().default(false),
  reason: text("reason"),
  changedBy: uuid("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Callback and trial requests from the public site (0050); only the API's system role reads or changes them. */
export const trialRequests = platformSchema.table("trial_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactName: text("contact_name").notNull(),
  businessName: text("business_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  callbackWindow: text("callback_window", { enum: ["morning", "afternoon", "evening", "anytime"] }).notNull(),
  useCase: text("use_case"),
  consentText: text("consent_text").notNull(),
  consentAt: ts("consent_at").notNull(),
  status: text("status", { enum: ["new", "contacted", "approved", "rejected"] }).notNull().default("new"),
  contactedBy: uuid("contacted_by"),
  contactedAt: ts("contacted_at"),
  workspaceId: uuid("workspace_id"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
