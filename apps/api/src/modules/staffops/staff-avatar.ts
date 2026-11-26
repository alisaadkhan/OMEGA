import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { PreHandler } from "../../http/types";
import { parseInput } from "../../http/validate";
import type { StaffAction, StaffPrincipal } from "../staff/index";

const MAX_BYTES = 150_000;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const avatarBody = z.object({ avatar: z.string().max(210_000) });
export const staffAvatarSchema = z.object({ avatar: z.string().nullable() });

/** The file's own bytes must match the type it claims (a PNG, JPEG or WebP); the name or label proves nothing. */
export function checkAvatar(dataUrl: string): string {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new AppError("VALIDATION_FAILED", "Use a PNG, JPEG or WebP image.");
  const bytes = Buffer.from(m[2] ?? "", "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new AppError("VALIDATION_FAILED", "The image must be under 150 KB.");
  const kind = m[1];
  const ok =
    (kind === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (kind === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (kind === "webp" && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP");
  if (!ok) throw new AppError("VALIDATION_FAILED", "That file is not the image type it says it is.");
  return dataUrl;
}

/** Each staff member's own profile photo (owner, 25 Nov). */
export function registerStaffAvatarRoutes(app: FastifyInstance, o: { db: Db; r: (a: StaffAction) => PreHandler; staffOf: (req: FastifyRequest) => StaffPrincipal }) {
  app.get("/admin/v1/me/avatar", { preHandler: o.r("staff.profile.manage") }, async (req, reply) => {
    const [row] = await o.db.withSystem((tx) => tx.execute<{ avatar: string | null }>(sql`select avatar from staff.staff_users where id = ${o.staffOf(req).staffId}`));
    return reply.header("cache-control", "private, no-store").send(staffAvatarSchema.parse({ avatar: row?.avatar ?? null }));
  });
  app.put("/admin/v1/me/avatar", { preHandler: o.r("staff.profile.manage"), bodyLimit: 256 * 1024 }, async (req, reply) => {
    const avatar = checkAvatar(parseInput(avatarBody, req.body).avatar);
    await o.db.withSystem((tx) => tx.execute(sql`update staff.staff_users set avatar = ${avatar}, updated_at = now() where id = ${o.staffOf(req).staffId}`));
    return reply.status(204).send();
  });
  app.delete("/admin/v1/me/avatar", { preHandler: o.r("staff.profile.manage") }, async (req, reply) => {
    await o.db.withSystem((tx) => tx.execute(sql`update staff.staff_users set avatar = null, updated_at = now() where id = ${o.staffOf(req).staffId}`));
    return reply.status(204).send();
  });
}
