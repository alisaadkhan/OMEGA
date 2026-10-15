import { jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const wp = pgSchema("wp");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = wp.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  status: text("status", { enum: ["active", "suspended", "deleted"] }).notNull().default("active"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaces = wp.table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  /** "deleted": content erased and unreachable (migration 0035); billing records are kept. */
  status: text("status", { enum: ["active", "deleted"] }).notNull().default("active"),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = wp.table(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** Email invitations to a workspace (migration 0035); only a hash of the link token is stored. */
export const workspaceInvitations = wp.table("workspace_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  status: text("status", { enum: ["pending", "accepted", "revoked"] }).notNull().default("pending"),
  acceptedBy: uuid("accepted_by"),
  acceptedAt: ts("accepted_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
