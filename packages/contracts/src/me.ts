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
