import { boolean, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
