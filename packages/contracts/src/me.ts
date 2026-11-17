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
    /** Account emails (trial, credits, payments, finished live searches); on unless the person turned them off. */
    emailNotifications: z.boolean().default(true),
    /** Two-step sign-in (authenticator app) is on; every session then needs the code (0091). */
    twoStepEnabled: z.boolean().default(false),
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

export const updateMeSchema = z
  .object({ displayName: z.string().trim().min(1, "Enter your name").max(80).optional(), emailNotifications: z.boolean().optional() })
  .refine((v) => v.displayName !== undefined || v.emailNotifications !== undefined, "Nothing to change");
/**
 * Profile photo (owner, 17 Nov): a small image the app has already cropped and resized, as a data URL. The API checks the
 * type from the bytes themselves and the size; it is stored on the person's own record only.
 */
export const AVATAR_MAX_BYTES = 150_000;
export const updateAvatarSchema = z.object({
  image: z.string().max(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 64).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Choose a PNG, JPEG or WebP image."),
});
