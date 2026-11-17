import { z } from "zod";

const iso = z.iso.datetime({ offset: true });

// No teams (owner, 17 Nov): invitation, member and team-deletion contracts were removed.

// ── Privacy self-service ──
export const deleteAccountSchema = z.object({ confirmEmail: z.string().trim().toLowerCase().max(254) });
export const deletionResultSchema = z.object({
  deleted: z.literal(true),
  /** What was kept and why, stated to the customer. */
  retained: z.array(z.string()),
  /** For accounts: the sign-in identity lives with the identity provider; whether it was removed there. */
  identityProviderAccount: z.enum(["deleted", "not_deleted_requires_provider"]).optional(),
});
export const workspaceExportSchema = z.object({
  format: z.literal("mushin.workspace-export.v1"),
  exportedAt: iso,
  workspace: z.object({ id: z.uuid(), name: z.string(), createdAt: iso }),
  /** Rows per table as stored for this workspace; revealed contact values and staff-only notes are not included. */
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** Tables cut at the per-table row limit (audit DATA-03); empty when the export is complete. */
  truncated: z.array(z.string()),
  notes: z.array(z.string()),
});
