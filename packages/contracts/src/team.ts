import { z } from "zod";

const iso = z.iso.datetime({ offset: true });

// ── Invitations ──
export const invitationRoleSchema = z.enum(["admin", "member"]);
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: invitationRoleSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  invitedBy: z.string(),
  expiresAt: iso,
  createdAt: iso,
});
export type Invitation = z.output<typeof invitationSchema>;
export const invitationListSchema = z.object({ invitations: z.array(invitationSchema) });
export const createInvitationSchema = z.object({ email: z.email("Enter a valid email address").max(254).transform((e) => e.trim().toLowerCase()), role: invitationRoleSchema.default("member") });
/** The link is shown once to the person who invited; MUSHIN does not email it (no email provider is authorised yet). */
export const createdInvitationSchema = invitationSchema.extend({ acceptUrl: z.string() });
export const invitationPreviewSchema = z.object({ workspaceName: z.string(), role: invitationRoleSchema, email: z.string(), invitedBy: z.string(), status: z.enum(["pending", "accepted", "revoked", "expired"]), expiresAt: iso });
export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) });
export const acceptedInvitationSchema = z.object({ workspaceId: z.uuid(), role: z.enum(["owner", "admin", "member"]) });

// ── Members and workspaces ──
export const memberRoleUpdateSchema = z.object({ role: invitationRoleSchema });
export const transferOwnershipSchema = z.object({ userId: z.uuid() });
export const myWorkspacesSchema = z.object({ workspaces: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.enum(["owner", "admin", "member"]) })) });

// ── Privacy self-service ──
export const deleteWorkspaceSchema = z.object({ confirmName: z.string().trim().min(1).max(120) });
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
  notes: z.array(z.string()),
});
