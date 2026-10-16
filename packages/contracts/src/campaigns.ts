import { z } from "zod";
import { creatorCardSchema } from "./search";

const iso = z.iso.datetime();
const day = z.iso.date();

/** Archived campaigns keep their history and do not count towards a plan's campaign limit. */
export const campaignStatusSchema = z.enum(["draft", "active", "paused", "completed", "archived"]);
const newCampaignStatusSchema = campaignStatusSchema.exclude(["archived"]);
export const campaignPlatformSchema = z.enum(["instagram", "tiktok", "youtube", "mixed"]);
export const pipelineStageSchema = z.enum(["identified", "contacted", "negotiating", "confirmed"]);
export const campaignOutcomeSchema = z.enum(["open", "declined"]);
export const contentStatusSchema = z.enum(["none", "content_pending", "posted", "completed"]);
export const prioritySchema = z.enum(["low", "med", "high"]);
export const feeKindSchema = z.enum(["estimated", "quoted", "agreed"]);
export const outreachChannelSchema = z.enum(["email", "phone", "whatsapp", "instagram", "tiktok", "youtube", "other"]);
export const outreachOutcomeSchema = z.enum(["attempted", "replied", "no_response", "declined", "agreed"]);
export type PipelineStage = z.output<typeof pipelineStageSchema>;

/** Money in PKR minor units (paisa) so totals never drift; the UI shows rupees. */
const money = z.number().int().nonnegative().max(1_000_000_000_000);

const campaignFields = {
  name: z.string().trim().min(1, "Give the campaign a name").max(120),
  status: campaignStatusSchema,
  platform: campaignPlatformSchema.nullable(),
  client: z.string().trim().max(120),
  objective: z.string().trim().max(1000),
  notes: z.string().trim().max(4000),
  budgetMinor: money.nullable(),
  startDate: day.nullable(),
  endDate: day.nullable(),
};
const datesInOrder = (v: { startDate?: string | null; endDate?: string | null }) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
const datesMessage = { message: "The end date must be on or after the start date", path: ["endDate"] };

export const createCampaignSchema = z
  .object({ ...campaignFields, status: newCampaignStatusSchema.default("draft"), platform: campaignPlatformSchema.nullable().default(null), client: campaignFields.client.default(""), objective: campaignFields.objective.default(""), notes: campaignFields.notes.default(""), budgetMinor: money.nullable().default(null), startDate: day.nullable().default(null), endDate: day.nullable().default(null) })
  .refine(datesInOrder, datesMessage);
export type CreateCampaign = z.input<typeof createCampaignSchema>;
export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change")
  .refine(datesInOrder, datesMessage);
export type UpdateCampaign = z.input<typeof updateCampaignSchema>;

/** Counts come from persisted creator rows only; `agreedFeesMinor` sums fees marked agreed (no invented spend/ROI). */
export const campaignSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: campaignStatusSchema,
  platform: campaignPlatformSchema.nullable(),
  client: z.string(),
  objective: z.string(),
  notes: z.string(),
  budgetMinor: z.number().int().nullable(),
  currency: z.literal("PKR"),
  startDate: day.nullable(),
  endDate: day.nullable(),
  archivedAt: iso.nullable(),
  creatorCount: z.number().int().nonnegative(),
  stageCounts: z.record(pipelineStageSchema, z.number().int().nonnegative()),
  declinedCount: z.number().int().nonnegative(),
  agreedFeesMinor: z.number().int().nonnegative(),
  /** Only when asked with `?creatorId=`: whether that creator is in this campaign. */
  containsCreator: z.boolean().optional(),
  createdAt: iso,
  updatedAt: iso,
});
export type CampaignSummary = z.output<typeof campaignSummarySchema>;
export const campaignIndexSchema = z.object({ campaigns: z.array(campaignSummarySchema) });
export const campaignIndexQuerySchema = z.object({ creatorId: z.uuid().optional() });

export const outreachEventSchema = z.object({
  id: z.uuid(),
  channel: outreachChannelSchema,
  outcome: outreachOutcomeSchema,
  note: z.string(),
  occurredAt: iso,
  loggedBy: z.object({ id: z.uuid(), name: z.string() }),
});
export type OutreachEvent = z.output<typeof outreachEventSchema>;

export const campaignCreatorSchema = z.object({
  creator: creatorCardSchema,
  stage: pipelineStageSchema,
  outcome: campaignOutcomeSchema,
  contentStatus: contentStatusSchema,
  priority: prioritySchema,
  feeMinor: z.number().int().nullable(),
  feeKind: feeKindSchema,
  dueDate: day.nullable(),
  note: z.string(),
  version: z.number().int().positive(),
  addedAt: iso,
  updatedAt: iso,
  lastOutreach: outreachEventSchema.nullable(),
});
export type CampaignCreator = z.output<typeof campaignCreatorSchema>;
export const campaignDetailSchema = campaignSummarySchema.extend({ creators: z.array(campaignCreatorSchema) });
export type CampaignDetail = z.output<typeof campaignDetailSchema>;

export const addCampaignCreatorsSchema = z.object({ creatorIds: z.array(z.uuid()).min(1).max(100) });
export const addCampaignCreatorsResponseSchema = z.object({ added: z.number().int().nonnegative(), alreadyInCampaign: z.number().int().nonnegative() });

/** `expectedVersion` is the version the user edited; a newer one on the server answers 409 (someone else changed it). */
export const updateCampaignCreatorSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    stage: pipelineStageSchema.optional(),
    outcome: campaignOutcomeSchema.optional(),
    contentStatus: contentStatusSchema.optional(),
    priority: prioritySchema.optional(),
    feeMinor: money.nullable().optional(),
    feeKind: feeKindSchema.optional(),
    dueDate: day.nullable().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== "expectedVersion" && x !== undefined), "Nothing to change");
export type UpdateCampaignCreator = z.input<typeof updateCampaignCreatorSchema>;

export const logOutreachSchema = z.object({
  channel: outreachChannelSchema,
  outcome: outreachOutcomeSchema,
  note: z.string().trim().max(2000).default(""),
  /** When it happened (defaults to now); not in the future. */
  occurredAt: iso.optional(),
});
export type LogOutreach = z.input<typeof logOutreachSchema>;
export const outreachLogSchema = z.object({ events: z.array(outreachEventSchema) });
