import { text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const supportMessages = wp.table("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  authorKind: text("author_kind", { enum: ["customer", "staff"] }).notNull(),
  authorUserId: uuid("author_user_id"),
  authorStaffId: uuid("author_staff_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
