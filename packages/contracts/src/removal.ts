import { z } from "zod";
import { creatorPlatformSchema } from "./search";

const iso = z.iso.datetime();

/** Public "Remove my data" form (SRS §6.3). `website` is a bot trap: people never see or fill it. */
export const removalRequestSchema = z.object({
  urls: z.array(z.string().trim().min(3).max(500)).min(1).max(3),
  email: z.email().max(254),
  reason: z.string().trim().max(500).optional(),
  confirm: z.literal(true),
  website: z.string().max(200).optional(),
});
export type RemovalRequest = z.output<typeof removalRequestSchema>;
export const removalReceivedSchema = z.object({ status: z.literal("received") });

export const staffRemovalRequestSchema = z.object({
  id: z.uuid(),
  urls: z.array(z.string()),
  creator: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string(), platform: creatorPlatformSchema }).nullable(),
  emailMasked: z.string().nullable(),
  reason: z.string().nullable(),
  status: z.enum(["received", "processed", "rejected"]),
  staffNote: z.string().nullable(),
  createdAt: iso,
  processedAt: iso.nullable(),
});
export type StaffRemovalRequest = z.output<typeof staffRemovalRequestSchema>;
export const staffRemovalListSchema = z.object({ requests: z.array(staffRemovalRequestSchema) });
export const staffRejectSchema = z.object({ note: z.string().trim().min(3).max(300) });
