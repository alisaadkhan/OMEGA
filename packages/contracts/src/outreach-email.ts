import { z } from "zod";

/**
 * Outreach email through MUSHIN (owner decision 2026-10-16). Status is evidence-backed: `accepted` means the provider
 * took the message; `delivered`, `bounced` and `complained` come only from signed provider webhooks. In test mode the
 * mock provider accepts and nothing is delivered.
 */
export const outreachEmailStatusSchema = z.enum(["requested", "accepted", "delivered", "bounced", "complained", "failed"]);

/**
 * The recipient is either a creator contact this workspace revealed (`contactId`) or an address the person typed in
 * (`manualEmail`): that one is kept for this workspace only, as user-provided and unverified, and never replaces the
 * creator's own contact. Exactly one of the two.
 */
const composeFields = {
  contactId: z.uuid().optional(),
  manualEmail: z.email("Enter a valid email address").max(254).optional(),
  subject: z.string().trim().min(1, "Write a subject").max(200),
  body: z.string().trim().min(1, "Write a message").max(10_000),
};
const oneRecipient = (v: { contactId?: string | undefined; manualEmail?: string | undefined }) => Boolean(v.contactId) !== Boolean(v.manualEmail);
const oneRecipientMessage = { message: "Choose one recipient: a revealed contact or an address you enter", path: ["contactId"] };
/** What the preview renders: exactly what a send would deliver. */
export const outreachComposeSchema = z.object(composeFields).refine(oneRecipient, oneRecipientMessage);
export type OutreachCompose = z.input<typeof outreachComposeSchema>;
export const sendOutreachEmailSchema = z
  .object({
    ...composeFields,
    /** The person confirmed this exact email to this recipient (no automated or bulk sending). */
    confirm: z.literal(true, { message: "Confirm that you want to send this email" }),
  })
  .refine(oneRecipient, oneRecipientMessage);
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

/** A recipient the composer can offer: a revealed creator contact or a workspace-provided address. */
export const outreachRecipientSchema = z.object({
  id: z.uuid(),
  source: z.enum(["creator_contact", "workspace_contact"]),
  value: z.string(),
  /** What is known about the address; "user_provided" addresses were never checked by Roster. */
  status: z.enum(["unverified", "domain_ok", "verified", "user_provided"]),
});
/**
 * A ready-to-edit email for one creator in one campaign, built from the campaign's real brand and name (nothing is
 * sent). `recipients` lists usable addresses (revealed, not invalid, not suppressed); `revealNeeded` says the creator
 * has an address this workspace has not revealed. `profileLinks` and `manualMessage` serve outreach without email.
 */
export const outreachDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  sender: z.object({ fromName: z.string(), fromAddress: z.string(), replyTo: z.string().nullable(), postalAddress: z.string().nullable() }),
  recipients: z.array(outreachRecipientSchema),
  revealNeeded: z.boolean(),
  profileLinks: z.array(z.object({ platform: z.enum(["instagram", "tiktok", "youtube"]), url: z.string() })),
  manualMessage: z.string(),
});
export type OutreachDraft = z.output<typeof outreachDraftSchema>;
/** The complete email as it would be sent; `warnings` name anything the person should know before confirming. */
export const outreachPreviewSchema = z.object({
  from: z.string(),
  replyTo: z.string().nullable(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  warnings: z.array(z.string()),
  /** Whether a send of exactly this email would be accepted (the server decides; the UI never infers it from text). */
  sendable: z.boolean(),
  /** Why not, when not sendable. */
  blockedReason: z.string().nullable(),
});
export type OutreachPreview = z.output<typeof outreachPreviewSchema>;
