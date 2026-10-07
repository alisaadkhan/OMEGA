import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const staffSchema = pgSchema("staff");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const staffUsers = staffSchema.table("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
  role: text("role", { enum: ["admin", "support"] }).notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  lastTotpStep: bigint("last_totp_step", { mode: "number" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const staffSessions = staffSchema.table("staff_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
  familyId: uuid("family_id").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = staffSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").references(() => staffUsers.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  workspaceId: uuid("workspace_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
