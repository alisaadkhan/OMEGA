import { z } from "zod";
import { creatorCardSchema } from "./search";

const iso = z.iso.datetime();
const name = z.string().trim().min(1, "Give the list a name").max(80);
const description = z.string().trim().max(500);

/** A workspace list (canonical frontend spec page 09). `count` counts creators customers can currently see. */
export const listSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  favorite: z.boolean(),
  count: z.number().int().nonnegative(),
  /** Up to three visible members for the list card. */
  preview: z.array(z.object({ id: z.uuid(), displayName: z.string(), avatarUrl: z.string().nullable() })),
  /** Only when asked with `?creatorId=`: whether that creator is on this list. */
  containsCreator: z.boolean().optional(),
  createdAt: iso,
  updatedAt: iso,
});
export type ListSummary = z.output<typeof listSummarySchema>;

export const listIndexSchema = z.object({ lists: z.array(listSummarySchema) });
export const listIndexQuerySchema = z.object({ creatorId: z.uuid().optional() });

/** Members are Brain 1 cards (no contact values); a creator hidden since being saved is left out. */
export const listMemberSchema = z.object({ creator: creatorCardSchema, note: z.string(), addedAt: iso });
export type ListMember = z.output<typeof listMemberSchema>;
export const listDetailSchema = listSummarySchema.extend({ members: z.array(listMemberSchema) });
export type ListDetail = z.output<typeof listDetailSchema>;

export const createListSchema = z.object({ name, description: description.default("") });
export type CreateList = z.input<typeof createListSchema>;
export const updateListSchema = z
  .object({ name: name.optional(), description: description.optional(), favorite: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");
export type UpdateList = z.input<typeof updateListSchema>;

export const addListMembersSchema = z.object({ creatorIds: z.array(z.uuid()).min(1).max(100) });
export const addListMembersResponseSchema = z.object({ added: z.number().int().nonnegative(), alreadyOnList: z.number().int().nonnegative() });
export const removeListMembersSchema = z.object({ creatorIds: z.array(z.uuid()).min(1).max(100) });
export const updateListMemberSchema = z.object({ note: z.string().trim().max(1000) });
