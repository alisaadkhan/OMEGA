import { boolean, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  /** The Terms/Privacy version accepted and when (0044, audit UX-01). */
  legalVersion: text("legal_version"),
  legalAcceptedAt: ts("legal_accepted_at"),
  /** Set when this person's first own workspace received the free trial; a later workspace gets none (0036). */
  trialGrantedAt: ts("trial_granted_at"),
  /** The monthly testing allowance was claimed for this person (0061); one per person. */
  testingAllowanceAt: ts("testing_allowance_at"),
  /** When the Auth server confirmed this person's email, and for which address (0089, email verification gate). */
  emailConfirmedAt: ts("email_confirmed_at"),
  emailConfirmedFor: text("email_confirmed_for"),
  /** Two-step sign-in is on (0091): mirrored from the Auth server's verified factors, never set from the client. */
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  /** The account whose staff suspension this person is under (0095); restoring that account lifts it. */
  suspendedByWorkspace: uuid("suspended_by_workspace"),
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
  /** This workspace receives the monthly testing allowance (0061). */
  testingAllowanceSince: ts("testing_allowance_since"),
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

/** Accounts staff have suspended (0098): a person is restored only once no account they belong to is suspended. */
export const workspaceSuspensions = wp.table("workspace_suspensions", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  suspendedAt: ts("suspended_at").notNull().defaultNow(),
});
