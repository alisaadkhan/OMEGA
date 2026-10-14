import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

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
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeSchema = z.object({ displayName: z.string().trim().min(1, "Enter your name").max(80) });
/** Owners and admins only. */
export const updateWorkspaceSchema = z.object({ name: z.string().trim().min(1, "Enter a workspace name").max(80) });
export const workspaceMembersSchema = z.object({
  members: z.array(z.object({ id: z.uuid(), name: z.string(), email: z.string(), role: workspaceRoleSchema, joinedAt: z.iso.datetime() })),
});
