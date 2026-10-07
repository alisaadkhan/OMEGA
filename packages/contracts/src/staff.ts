import { z } from "zod";

export const staffRoleSchema = z.enum(["admin", "support"]);

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
