import type { FastifyInstance } from "fastify";
import { meResponseSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { sendOk } from "../../http/validate";
import type { createIdentityService } from "./service";

export function registerIdentityRoutes(app: FastifyInstance, guards: Guards, service: ReturnType<typeof createIdentityService>) {
  app.get("/v1/me", { preHandler: guards.customer }, async (req, reply) => {
    const me = await service.getMe(tenantOf(req));
    if (!me) throw new AppError("NOT_FOUND", "Account not found");
    return sendOk(reply, meResponseSchema, {
      user: { id: me.userId, email: me.email, displayName: me.displayName, avatarUrl: me.avatarUrl },
      workspace: { id: me.workspaceId, name: me.workspaceName, role: me.role },
    });
  });
}
