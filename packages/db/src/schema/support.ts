import { smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const supportTickets = wp.table("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  subject: text("subject").notNull(),
  category: text("category", { enum: ["search", "discovery", "billing", "account", "data_removal", "other"] }).notNull(),
  status: text("status", { enum: ["open", "waiting_on_customer", "resolved", "closed"] }).notNull().default("open"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  assignedStaffId: uuid("assigned_staff_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const supportMessages = wp.table("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  authorKind: text("author_kind", { enum: ["customer", "staff", "internal"] }).notNull(),
  authorUserId: uuid("author_user_id"),
  authorStaffId: uuid("author_staff_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Consented, read-only, time-boxed support access to a workspace (migration 0033). */
export const supportAccessRequests = wp.table("support_access_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  purpose: text("purpose").notNull(),
  status: text("status", { enum: ["requested", "granted", "declined", "ended", "expired"] }).notNull().default("requested"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  expiresAt: ts("expires_at"),
  endedAt: ts("ended_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Trial feedback (0050): one row per submission, visible to its workspace; staff read it through a function. */
export const trialFeedback = wp.table("trial_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id").notNull(),
  searchQuality: smallint("search_quality"),
  contactAccuracy: smallint("contact_accuracy"),
  easeOfUse: smallint("ease_of_use"),
  savedTime: text("saved_time", { enum: ["yes", "no", "not_sure"] }),
  wouldPay: text("would_pay", { enum: ["yes", "maybe", "no"] }),
  preferredPlan: text("preferred_plan"),
  missingFeatures: text("missing_features"),
  comments: text("comments"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
