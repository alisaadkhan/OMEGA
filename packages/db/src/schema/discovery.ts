import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const discoveryJobs = wp.table("discovery_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  kind: text("kind", { enum: ["add_by_url", "refresh", "live"] }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  inputUrl: text("input_url"),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube"] }).notNull(),
  handle: text("handle").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  creatorId: uuid("creator_id"),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  step: text("step", { enum: ["searching", "filtering", "fetching", "archiving", "cleaning", "assessing", "saving"] }),
  attempts: integer("attempts").notNull().default(0),
  reservationId: uuid("reservation_id"),
  cost: integer("cost").notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  outcome: text("outcome", { enum: ["created", "refreshed", "reused"] }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
