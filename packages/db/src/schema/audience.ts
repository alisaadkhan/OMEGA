import { integer, jsonb, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gcp } from "./creators";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const platformEnum = ["instagram", "tiktok", "youtube"] as const;
const outcomeEnum = ["estimated", "insufficient"] as const;

/** Aggregate audience estimate of a creator's sampled commenters (migration 0022). Never holds per-person data. */
export const audienceEstimates = gcp.table("audience_estimates", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  platform: text("platform", { enum: platformEnum }).notNull(),
  methodVersion: text("method_version").notNull(),
  outcome: text("outcome", { enum: outcomeEnum }).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  collectedAt: ts("collected_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  quotaUnits: integer("quota_units").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const audienceJobs = wp.table("audience_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  creatorId: uuid("creator_id").notNull(),
  platform: text("platform", { enum: platformEnum }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  outcome: text("outcome", { enum: outcomeEnum }),
  estimateId: uuid("estimate_id"),
  attempts: integer("attempts").notNull().default(0),
  reservationId: uuid("reservation_id"),
  cost: integer("cost").notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
