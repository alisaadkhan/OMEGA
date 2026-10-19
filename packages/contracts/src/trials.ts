import { z } from "zod";
import { planIdSchema } from "./billing";

/**
 * Founder-assisted 14-day trial (mandate v4 Phase 3, migration 0050). The public callback form asks only what a call
 * back needs; the server stores this exact consent wording with each request, never wording sent by the browser.
 */
export const TRIAL_CONSENT_TEXT =
  "I agree that MUSHIN may contact me by the phone number or email I entered, only about this trial request.";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const callbackWindowSchema = z.enum(["morning", "afternoon", "evening", "anytime"]);

export const trialRequestCreateSchema = z
  .object({
    contactName: text(120),
    businessName: text(160),
    email: optionalText(254).pipe(z.email().max(254).optional()),
    phone: optionalText(24).pipe(z.string().regex(/^\+?[0-9][0-9 ()-]{6,19}$/, "Enter a phone number with digits only, e.g. +92 300 1234567").optional()),
    callbackWindow: callbackWindowSchema,
    useCase: optionalText(1000),
    consent: z.literal(true, { error: "Please agree to be contacted about this request." }),
    /** Hidden field: people never fill it, simple bots do. A filled value is accepted silently and dropped. */
    website: z.string().max(200).optional(),
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: "Enter an email address or a phone number.", path: ["email"] });
export type TrialRequestCreate = z.input<typeof trialRequestCreateSchema>;
export const trialReceivedSchema = z.object({ received: z.literal(true) });

export const trialRequestStatusSchema = z.enum(["new", "contacted", "approved", "rejected"]);

export const trialRequestSchema = z.object({
  id: z.uuid(),
  contactName: z.string(),
  businessName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  callbackWindow: callbackWindowSchema,
  useCase: z.string().nullable(),
  consentAt: z.iso.datetime(),
  status: trialRequestStatusSchema,
  contactedAt: z.iso.datetime().nullable(),
  workspaceId: z.uuid().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type TrialRequest = z.infer<typeof trialRequestSchema>;
export const trialRequestListSchema = z.object({ requests: z.array(trialRequestSchema) });
export const trialRequestQuerySchema = z.object({ status: trialRequestStatusSchema.optional() });

export const trialCandidateSchema = z.object({
  userId: z.uuid(),
  trialGrantedAt: z.iso.datetime().nullable(),
  workspaces: z.array(z.object({ id: z.uuid(), name: z.string(), subscriptionCreatedAt: z.iso.datetime().nullable() })),
});
export type TrialCandidate = z.infer<typeof trialCandidateSchema>;
export const trialCandidateQuerySchema = z.object({ email: z.email().max(254) });

export const trialApproveSchema = z.object({ accountEmail: z.email().max(254), workspaceId: z.uuid().optional(), note: optionalText(500) }).strict();
export const trialRejectSchema = z.object({ note: text(500) }).strict();
export const trialApprovalResultSchema = z.object({ request: trialRequestSchema, trialStartedAt: z.iso.datetime(), trialEndsAt: z.iso.datetime(), credits: z.number().int().positive() });

/** Every question is optional and neutral; at least one answer is needed. Ratings are 1 (poor) to 5 (excellent). */
const rating = z.number().int().min(1).max(5).optional();
export const trialFeedbackCreateSchema = z
  .object({
    searchQuality: rating,
    contactAccuracy: rating,
    easeOfUse: rating,
    savedTime: z.enum(["yes", "no", "not_sure"]).optional(),
    wouldPay: z.enum(["yes", "maybe", "no"]).optional(),
    preferredPlan: planIdSchema.optional(),
    missingFeatures: optionalText(2000),
    comments: optionalText(4000),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Answer at least one question." });
export type TrialFeedbackCreate = z.input<typeof trialFeedbackCreateSchema>;

export const trialFeedbackSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  searchQuality: z.number().int().nullable(),
  contactAccuracy: z.number().int().nullable(),
  easeOfUse: z.number().int().nullable(),
  savedTime: z.string().nullable(),
  wouldPay: z.string().nullable(),
  preferredPlan: z.string().nullable(),
  missingFeatures: z.string().nullable(),
  comments: z.string().nullable(),
  createdAt: z.string(),
});
export const trialFeedbackListSchema = z.object({ feedback: z.array(trialFeedbackSchema) });
