import { bigint, date, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });

export const campaigns = wp.table("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "completed", "archived"] }).notNull().default("draft"),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube", "mixed"] }),
  client: text("client").notNull().default(""),
  objective: text("objective").notNull().default(""),
  notes: text("notes").notNull().default(""),
  budgetMinor: bigint("budget_minor", { mode: "number" }),
  currency: text("currency").notNull().default("PKR"),
  startDate: day("start_date"),
  endDate: day("end_date"),
  createdBy: uuid("created_by").notNull(),
  /** Set exactly while status is archived (0038). */
  archivedAt: ts("archived_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const campaignCreators = wp.table(
  "campaign_creators",
  {
    campaignId: uuid("campaign_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    creatorId: uuid("creator_id").notNull(),
    stage: text("stage", { enum: ["identified", "contacted", "negotiating", "confirmed"] }).notNull().default("identified"),
    outcome: text("outcome", { enum: ["open", "declined"] }).notNull().default("open"),
    contentStatus: text("content_status", { enum: ["none", "content_pending", "posted", "completed"] }).notNull().default("none"),
    priority: text("priority", { enum: ["low", "med", "high"] }).notNull().default("med"),
    feeMinor: bigint("fee_minor", { mode: "number" }),
    feeKind: text("fee_kind", { enum: ["estimated", "quoted", "agreed"] }).notNull().default("estimated"),
    dueDate: day("due_date"),
    note: text("note").notNull().default(""),
    version: integer("version").notNull().default(1),
    addedBy: uuid("added_by").notNull(),
    addedAt: ts("added_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.creatorId] })],
);

export const outreachEvents = wp.table("outreach_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  creatorId: uuid("creator_id").notNull(),
  channel: text("channel", { enum: ["email", "phone", "whatsapp", "instagram", "tiktok", "youtube", "other"] }).notNull(),
  outcome: text("outcome", { enum: ["attempted", "replied", "no_response", "declined", "agreed"] }).notNull(),
  note: text("note").notNull().default(""),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  loggedBy: uuid("logged_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Outreach emails sent through MUSHIN (0039): the quota record per billing period; see the migration header. */
export const outreachEmails = wp.table("outreach_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  creatorId: uuid("creator_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  recipientHash: text("recipient_hash").notNull(),
  recipientMasked: text("recipient_masked").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  mode: text("mode", { enum: ["test", "resend"] }).notNull(),
  status: text("status", { enum: ["requested", "accepted", "delivered", "bounced", "complained", "failed"] }).notNull().default("requested"),
  providerMessageId: text("provider_message_id"),
  failureReason: text("failure_reason"),
  periodStart: ts("period_start").notNull(),
  statusAt: ts("status_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
