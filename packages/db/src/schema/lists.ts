import { boolean, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const lists = wp.table("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  favorite: boolean("favorite").notNull().default(false),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const listMembers = wp.table(
  "list_members",
  {
    listId: uuid("list_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    creatorId: uuid("creator_id").notNull(),
    note: text("note").notNull().default(""),
    addedBy: uuid("added_by").notNull(),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.creatorId] })],
);

/** Data exports (0040, Scale plan): a bounded CSV kept 24 hours; the row is the audit record. */
export const dataExports = wp.table("data_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  kind: text("kind", { enum: ["lists", "campaigns"] }).notNull(),
  rowCount: integer("row_count").notNull(),
  content: text("content"),
  byteSize: integer("byte_size").notNull(),
  downloads: integer("downloads").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  purgedAt: ts("purged_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
