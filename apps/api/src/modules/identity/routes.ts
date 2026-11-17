import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { acceptLegalSchema, AVATAR_MAX_BYTES, LEGAL_VERSION, meResponseSchema, updateAvatarSchema, updateMeSchema } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { TwoStepStatus } from "../../auth/auth-admin";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { createIdentityService } from "./service";

export function registerIdentityRoutes(app: FastifyInstance, guards: Guards, service: ReturnType<typeof createIdentityService>, db: Db, twoStepStatus: TwoStepStatus | null = null) {
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const me = async (ctx: TenantContext) => {
    const m = await service.getMe(ctx);
    if (!m) throw new AppError("NOT_FOUND", "Account not found");
    return {
      user: { id: m.userId, email: m.email, displayName: m.displayName, avatarUrl: m.avatarUrl, emailNotifications: m.preferences["emailNotifications"] !== false, twoStepEnabled: m.mfaEnabled },
      workspace: { id: m.workspaceId, name: m.workspaceName, role: m.role },
      legal: { acceptedVersion: m.legalVersion, acceptedAt: m.legalAcceptedAt ? m.legalAcceptedAt.toISOString() : null, currentVersion: LEGAL_VERSION },
    };
  };

  // Audit UX-01: the person accepts the published Terms and Privacy Policy; only the current version can be accepted.
  app.post("/v1/me/legal-acceptance", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const { version } = parseInput(acceptLegalSchema, req.body);
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.users set legal_version = ${version}, legal_accepted_at = now() where id = ${ctx.userId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });

  app.get("/v1/me", { preHandler: guards.customer }, async (req, reply) => sendOk(reply, meResponseSchema, await me(tenantOf(req))));

  // Settings › Profile and Notifications: your own name and email preference (wp.users is self-only under RLS).
  app.patch("/v1/me", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const { displayName, emailNotifications } = parseInput(updateMeSchema, req.body);
    await db.withTenant(tenant(ctx), async (tx) => {
      if (displayName !== undefined) await tx.execute(sql`update wp.users set display_name = ${displayName} where id = ${ctx.userId}`);
      if (emailNotifications !== undefined) {
        await tx.execute(sql`update wp.users set preferences = preferences || jsonb_build_object('emailNotifications', ${emailNotifications}::boolean) where id = ${ctx.userId}`);
      }
    });
    return sendOk(reply, meResponseSchema, await me(ctx));
  });

  // Settings › Profile photo: the bytes must really be the image type claimed, and small (the app resizes before upload).
  app.put("/v1/me/avatar", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const { image } = parseInput(updateAvatarSchema, req.body);
    const comma = image.indexOf(",");
    const claimed = image.slice("data:image/".length, image.indexOf(";"));
    const bytes = Buffer.from(image.slice(comma + 1), "base64");
    if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) throw new AppError("VALIDATION_FAILED", "The photo is too large. Choose a smaller image.", { field: "image" });
    if (imageTypeOf(bytes) !== claimed) throw new AppError("VALIDATION_FAILED", "That file is not a PNG, JPEG or WebP image.", { field: "image" });
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.users set avatar_url = ${image} where id = ${ctx.userId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });
  app.delete("/v1/me/avatar", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.users set avatar_url = null where id = ${ctx.userId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });

  // Settings › Two-step sign-in: after the app enrols or removes an authenticator with the Auth server, the stored state
  // is copied from the Auth server's own factor list (never from the request). Works before the second step, so a
  // person who removed their authenticator is not locked out; it can only ever reflect the truth.
  app.post("/v1/me/two-step/sync", { preHandler: guards.customer, config: { twoStepExempt: true } }, async (req, reply) => {
    const ctx = tenantOf(req);
    if (!twoStepStatus) throw new AppError("PROVIDER_UNAVAILABLE", "Two-step sign-in can't be checked right now. Please try again later.", { reason: "two_step_unavailable" });
    let on: boolean;
    try {
      on = await twoStepStatus(ctx.userId);
    } catch (err) {
      throw new AppError("PROVIDER_UNAVAILABLE", "We could not reach the sign-in service. Please try again in a moment.", { reason: "two_step_unavailable" }, { cause: err });
    }
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.users set mfa_enabled = ${on} where id = ${ctx.userId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });
}

/** The image type from its first bytes (PNG, JPEG, WebP), or null. The data URL's own label proves nothing. */
export function imageTypeOf(b: Buffer): "png" | "jpeg" | "webp" | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}
