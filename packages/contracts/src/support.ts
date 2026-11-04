import { z } from "zod";

const iso = z.iso.datetime({ offset: true });
export const ticketCategorySchema = z.enum(["search", "discovery", "billing", "account", "data_removal", "other"]);
export const ticketStatusSchema = z.enum(["open", "in_progress", "waiting_on_customer", "resolved", "closed"]);

export const ticketMessageSchema = z.object({ id: z.uuid(), authorKind: z.enum(["customer", "staff"]), authorName: z.string(), body: z.string(), createdAt: iso });
export const ticketSummarySchema = z.object({
  id: z.uuid(),
  subject: z.string(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  createdAt: iso,
  lastMessageAt: iso,
  messages: z.number().int().nonnegative(),
  lastAuthor: z.enum(["customer", "staff"]).nullable(),
  /** A MUSHIN support reply this person has not opened yet (0080). */
  unread: z.boolean().default(false),
});
export type TicketSummary = z.output<typeof ticketSummarySchema>;
export const ticketDetailSchema = ticketSummarySchema.extend({ thread: z.array(ticketMessageSchema) });
export type TicketDetail = z.output<typeof ticketDetailSchema>;
export const ticketListSchema = z.object({ tickets: z.array(ticketSummarySchema) });

const body = z.string().trim().min(1, "Write a message").max(5000);
export const createTicketSchema = z.object({ subject: z.string().trim().min(1, "Add a subject").max(160), category: ticketCategorySchema, body });
export type CreateTicket = z.input<typeof createTicketSchema>;
export const ticketReplySchema = z.object({ body });
/** Customers may close a ticket or reopen it. */
export const ticketCustomerStatusSchema = z.object({ status: z.enum(["open", "closed"]) });

// ── Staff (admin console) ──────────────────────────────────────────────────────────────────────────────────────
const assignee = { assignedStaffId: z.uuid().nullable(), assignedStaffName: z.string().nullable() };
/** Staff-only triage level (0073); customers never see it. */
export const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const staffTicketPrioritySchema = z.object({ priority: ticketPrioritySchema });
export const staffTicketSummarySchema = ticketSummarySchema.extend({ workspaceId: z.uuid(), workspaceName: z.string(), priority: ticketPrioritySchema.default("normal"), ...assignee });
/** Staff see internal notes in the thread (authorKind "internal"); customers never receive them. */
export const staffTicketMessageSchema = ticketMessageSchema.extend({ authorKind: z.enum(["customer", "staff", "internal"]) });
export const staffTicketDetailSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  subject: z.string(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  priority: ticketPrioritySchema.default("normal"),
  createdAt: iso,
  lastMessageAt: iso,
  ...assignee,
  messages: z.array(staffTicketMessageSchema),
});
export const staffTicketNoteSchema = z.object({ body });
export const staffTicketAssignSchema = z.object({ assigneeId: z.uuid().nullable() });
export const staffTicketListSchema = z.object({ tickets: z.array(staffTicketSummarySchema) });
export const staffTicketUpdateSchema = z
  .object({ body: z.string().trim().max(5000).optional(), status: ticketStatusSchema.optional() })
  .refine((v) => (v.body && v.body.length > 0) || v.status, "Write a reply or choose a status");

// ── Attachments (owner decision 2026-11-03; migration 0076) ────────────────────────────────────────────────────
export const attachmentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const attachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: attachmentTypeSchema,
  sizeBytes: z.number().int().nullable(),
  status: z.enum(["pending", "clean", "rejected"]),
  uploadedBy: z.enum(["customer", "staff"]),
  createdAt: iso,
});
export type TicketAttachment = z.output<typeof attachmentSchema>;
export const attachmentListSchema = z.object({ attachments: z.array(attachmentSchema) });
export const attachmentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024, "Files can be at most 5 MB"),
});
export const attachmentUploadSchema = z.object({ attachment: attachmentSchema, uploadUrl: z.string() });
export const attachmentDownloadSchema = z.object({ url: z.string(), expiresInSeconds: z.number().int() });
