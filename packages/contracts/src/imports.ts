import { z } from "zod";

/**
 * Creator list imports (owner instruction 2026-10-26). A workspace uploads its own CSV; rows are matched to catalogue
 * profiles by link. Declared niche, country and email stay this workspace's own data and never change the catalogue.
 */
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 2_000;

export const createImportSchema = z.object({
  /** The CSV text: a header row with `profile_url` (also `url`), optional `platform`, `niche`, `country`, `email`. */
  csv: z.string().min(1, "The file is empty").max(IMPORT_MAX_BYTES, "The file is larger than 1 MB"),
  source: z.string().trim().min(1, "Say where this list comes from").max(200),
  /** When the organisation last checked the list (optional). */
  reviewedOn: z.iso.date().nullable().default(null),
  fileName: z.string().trim().max(200).nullable().default(null),
});
export type CreateImport = z.input<typeof createImportSchema>;

export const importRowSchema = z.object({
  rowNo: z.number().int(),
  inputUrl: z.string(),
  status: z.enum(["matched", "not_in_catalogue", "invalid", "duplicate"]),
  problem: z.string().nullable(),
  creatorId: z.uuid().nullable(),
  platform: z.enum(["instagram", "tiktok", "youtube"]).nullable(),
  declaredNiche: z.string().nullable(),
  declaredCountry: z.string().nullable(),
  /** An email was stored for this workspace only (unverified). */
  emailStored: z.boolean(),
});
export const importSummarySchema = z.object({
  id: z.uuid(),
  source: z.string(),
  reviewedOn: z.string().nullable(),
  fileName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  counts: z.object({ total: z.number().int(), matched: z.number().int(), notInCatalogue: z.number().int(), invalid: z.number().int(), duplicate: z.number().int() }),
});
export const importDetailSchema = importSummarySchema.extend({ rows: z.array(importRowSchema) });
export const importListSchema = z.object({ imports: z.array(importSummarySchema) });
export type ImportDetail = z.output<typeof importDetailSchema>;
export type ImportSummary = z.output<typeof importSummarySchema>;
