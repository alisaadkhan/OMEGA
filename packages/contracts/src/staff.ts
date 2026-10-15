import { z } from "zod";

export const staffRoleSchema = z.enum(["support", "admin", "super_admin"]);

export const staffLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(200),
});
export const staffLoginResponseSchema = z.object({ challengeToken: z.string() });

export const staffTotpRequestSchema = z.object({
  challengeToken: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/, "must be a 6-digit code"),
});

export const staffProfileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: staffRoleSchema,
});

export const staffSessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  staff: staffProfileSchema,
});

export const staffMeResponseSchema = z.object({ staff: staffProfileSchema });

// ── Hardware keys (WebAuthn) and step-up ──
export const staffKeySchema = z.object({ id: z.uuid(), nickname: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable() });
export const staffSecuritySchema = z.object({
  /** Factors proven in this session: "otp" (TOTP) and, after a step-up, "hwk" (hardware key). */
  factors: z.array(z.enum(["otp", "hwk"])),
  keys: z.array(staffKeySchema),
  /** Whether this role's actions need a hardware key (Admin and Super Admin). */
  hardwareKeyRequired: z.boolean(),
});
/** WebAuthn options/responses are the standard JSON shapes; @simplewebauthn validates them in depth. */
export const webauthnOptionsResponseSchema = z.object({ options: z.record(z.string(), z.unknown()) });
export const webauthnRegisterRequestSchema = z.object({ response: z.record(z.string(), z.unknown()), nickname: z.string().trim().min(1).max(60) });
export const webauthnStepUpRequestSchema = z.object({ response: z.record(z.string(), z.unknown()) });
