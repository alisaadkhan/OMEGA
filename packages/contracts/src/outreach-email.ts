import { z } from "zod";

/**
 * Outreach email through MUSHIN (owner decision 2026-10-16). Status is evidence-backed: `accepted` means the provider
 * took the message; `delivered`, `bounced` and `complained` come only from signed provider webhooks. In test mode the
 * mock provider accepts and nothing is delivered.
 */
export const outreachEmailStatusSchema = z.enum(["requested", "accepted", "delivered", "bounced", "complained", "failed"]);

export const sendOutreachEmailSchema = z.object({
  contactId: z.uuid(),
  subject: z.string().trim().min(1, "Write a subject").max(200),
  body: z.string().trim().min(1, "Write a message").max(10_000),
  /** The person confirmed this exact email to this recipient (no automated or bulk sending). */
  confirm: z.literal(true, { message: "Confirm that you want to send this email" }),
});
export type SendOutreachEmail = z.input<typeof sendOutreachEmailSchema>;

export const outreachEmailSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  recipient: z.string(),
  subject: z.string(),
  status: outreachEmailStatusSchema,
  mode: z.enum(["test", "resend"]),
  failureReason: z.string().nullable(),
  sentBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
  statusAt: z.iso.datetime(),
});
export type OutreachEmail = z.output<typeof outreachEmailSchema>;
export const outreachEmailListSchema = z.object({ emails: z.array(outreachEmailSchema) });

/** This billing period's allowance. `limit` null = unlimited; 0 = not included in the plan. */
export const outreachUsageSchema = z.object({
  mode: z.enum(["off", "test", "live"]),
  limit: z.number().int().nonnegative().nullable(),
  used: z.number().int().nonnegative(),
  periodStart: z.iso.datetime(),
});
export type OutreachUsage = z.output<typeof outreachUsageSchema>;

export const unsubscribeRequestSchema = z.object({ token: z.string().min(10).max(200) });
