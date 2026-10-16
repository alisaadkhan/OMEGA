import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { acceptLegalSchema, LEGAL_VERSION, meResponseSchema, updateMeSchema, updateWorkspaceSchema, workspaceMembersSchema } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { createIdentityService } from "./service";

export function registerIdentityRoutes(app: FastifyInstance, guards: Guards, service: ReturnType<typeof createIdentityService>, db: Db) {
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const me = async (ctx: TenantContext) => {
    const m = await service.getMe(ctx);
    if (!m) throw new AppError("NOT_FOUND", "Account not found");
    return {
      user: { id: m.userId, email: m.email, displayName: m.displayName, avatarUrl: m.avatarUrl },
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

  // Settings › Profile: your own name (wp.users is self-only under RLS).
  app.patch("/v1/me", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const { displayName } = parseInput(updateMeSchema, req.body);
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.users set display_name = ${displayName} where id = ${ctx.userId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });

  // Settings › Workspace: renaming is for owners and admins.
  app.patch("/v1/workspace", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can rename the workspace.");
    const { name } = parseInput(updateWorkspaceSchema, req.body);
    await db.withTenant(tenant(ctx), (tx) => tx.execute(sql`update wp.workspaces set name = ${name} where id = ${ctx.workspaceId}`));
    return sendOk(reply, meResponseSchema, await me(ctx));
  });

  app.get("/v1/workspace/members", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const rows = await db.withTenant(tenant(ctx), (tx) =>
      tx.execute<{ id: string; display_name: string; email: string; role: "owner" | "admin" | "member"; joined_at: string }>(sql`select * from platform.workspace_people() order by joined_at`),
    );
    return sendOk(reply, workspaceMembersSchema, { members: rows.map((r) => ({ id: r.id, name: r.display_name, email: r.email, role: r.role, joinedAt: new Date(r.joined_at).toISOString() })) });
  });
}
