import { z } from "zod";

/** Data export (Scale plan): a CSV of lists or campaigns, kept 24 hours. Contact values are never included. */
export const exportKindSchema = z.enum(["lists", "campaigns"]);
/** Without scopeId: every list or campaign (team owner and admins). With it: that one list or campaign (also its creator). */
export const createExportSchema = z.object({ kind: exportKindSchema, scopeId: z.uuid().optional() });
export const dataExportSchema = z.object({
  id: z.uuid(),
  kind: exportKindSchema,
  rowCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  downloads: z.number().int().nonnegative(),
  scope: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  available: z.boolean(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  requestedBy: z.object({ id: z.uuid(), name: z.string() }),
});
export type DataExport = z.output<typeof dataExportSchema>;
export const dataExportListSchema = z.object({ exports: z.array(dataExportSchema) });
