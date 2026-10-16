import { bigint, boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const staffSchema = pgSchema("staff");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const staffUsers = staffSchema.table("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
  role: text("role", { enum: ["support", "admin", "super_admin"] }).notNull(),
  status: text("status", { enum: ["active", "disabled", "suspended"] }).notNull().default("active"),
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

/** WebAuthn hardware keys of Admin and Super Admin staff (migration 0033). */
export const webauthnCredentials = staffSchema.table("webauthn_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
  credentialId: text("credential_id").notNull(),
  publicKey: text("public_key").notNull(),
  signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
  transports: text("transports").array().notNull().default([]),
  aaguid: text("aaguid"),
  nickname: text("nickname").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const webauthnChallenges = staffSchema.table("webauthn_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
  kind: text("kind", { enum: ["registration", "authentication"] }).notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const approvalActions = ["credits.grant", "staff.role.change", "staff.suspend", "provider.cap.change", "workspace.suspend"] as const;
/** Two-person approvals for high-impact staff actions (migration 0033). */
export const approvals = staffSchema.table("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionType: text("action_type", { enum: approvalActions }).notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  reason: text("reason").notNull(),
  requiresSuperAdmin: boolean("requires_super_admin").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decisionNote: text("decision_note"),
  status: text("status", { enum: ["pending", "approved", "rejected", "expired", "executed", "failed"] }).notNull().default("pending"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  idempotencyKey: text("idempotency_key").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
  executedAt: ts("executed_at"),
});

/** Server-verified hardware-key step-ups (0041, audit SEC-02): the only proof a staff session used its key. */
export const stepUps = staffSchema.table("step_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  credentialId: uuid("credential_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});

/** One-time codes for a staff member's first security key (audit SEC-07, migration 0047). Only the hash is stored. */
export const enrolmentCodes = staffSchema.table("enrolment_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staffUsers.id),
  codeHash: text("code_hash").notNull(),
  issuedBy: text("issued_by").notNull(),
  reason: text("reason").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
