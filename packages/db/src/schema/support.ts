import { integer, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const supportTickets = wp.table("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  subject: text("subject").notNull(),
  category: text("category", { enum: ["billing", "creator_data", "discovery", "account", "feature_request", "data_removal", "other", "search"] }).notNull(),
  status: text("status", { enum: ["open", "in_progress", "waiting_on_customer", "resolved", "closed"] }).notNull().default("open"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  assignedStaffId: uuid("assigned_staff_id"),
  /** Lifecycle timestamps (0064), maintained by triggers; never written by the app. */
  firstResponseAt: ts("first_response_at"),
  resolvedAt: ts("resolved_at"),
  reopenedCount: integer("reopened_count").notNull().default(0),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  lastReopenedAt: ts("last_reopened_at"),
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

/**
 * A customer's review of one creator (0090, owner directive 2026-11-15 §3): "valid" confirms the profile, "invalid"
 * flags a problem for the staff Catalogue review. One open flag per person and creator.
 */
export const creatorProfileReviews = wp.table("creator_profile_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  submittedBy: uuid("submitted_by").notNull(),
  creatorId: uuid("creator_id").notNull(),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube"] }),
  sourceMode: text("source_mode", { enum: ["db_search", "live_discovery"] }).notNull(),
  verdict: text("verdict", { enum: ["valid", "invalid"] }).notNull(),
  reason: text("reason", { enum: ["not_individual_creator", "wrong_location", "wrong_niche", "broken_profile", "other"] }),
  note: text("note"),
  status: text("status", { enum: ["pending", "resolved", "dismissed"] }).notNull().default("pending"),
  resolvedByStaffId: uuid("resolved_by_staff_id"),
  resolvedAt: ts("resolved_at"),
  resolution: text("resolution"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
