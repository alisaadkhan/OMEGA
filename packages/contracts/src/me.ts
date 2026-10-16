import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

/**
 * The published Terms, Privacy Policy, Refund policy and Creator data notice (audit UX-01). Drafts pending legal review
 * (owner decision D-13): change this whenever their text changes, and everyone is asked to accept again.
 */
export const LEGAL_VERSION = "2026-10-17-draft";
export const acceptLegalSchema = z.object({ version: z.literal(LEGAL_VERSION, { message: "Please accept the current Terms and Privacy Policy." }) });

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  workspace: z.object({
    id: z.uuid(),
    name: z.string(),
    role: workspaceRoleSchema,
  }),
  /** Which version of the Terms and Privacy Policy this person accepted, and the version now published. */
  legal: z.object({ acceptedVersion: z.string().nullable(), acceptedAt: z.iso.datetime().nullable(), currentVersion: z.string() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeSchema = z.object({ displayName: z.string().trim().min(1, "Enter your name").max(80) });
/** Owners and admins only. */
export const updateWorkspaceSchema = z.object({ name: z.string().trim().min(1, "Enter a workspace name").max(80) });
export const workspaceMembersSchema = z.object({
  members: z.array(z.object({ id: z.uuid(), name: z.string(), email: z.string(), role: workspaceRoleSchema, joinedAt: z.iso.datetime() })),
});
