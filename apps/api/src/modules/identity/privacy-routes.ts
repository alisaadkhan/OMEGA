import type { FastifyInstance } from "fastify";
import { deleteAccountSchema, deletionResultSchema, workspaceExportSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { PrivacyService } from "./privacy";

/**
 * Privacy self-service: export and account deletion. There are no teams (owner, 17 Nov; live had no shared accounts):
 * invitations, member roles, ownership transfer and team deletion were removed with their routes.
 */
export function registerPrivacyRoutes(app: FastifyInstance, guards: Guards, privacy: PrivacyService) {
  const auth = { preHandler: guards.customer };
  // The export is a download; it is never cached (API responses are private, no-store).
  app.get("/v1/workspace/export", auth, async (req, reply) => {
    const data = workspaceExportSchema.parse(await privacy.exportWorkspace(tenantOf(req)));
    void reply.header("content-disposition", `attachment; filename="mushin-export-${data.exportedAt.slice(0, 10)}.json"`);
    return sendOk(reply, workspaceExportSchema, data);
  });
  app.post("/v1/me/delete", auth, async (req, reply) => {
    if (!req.customer) throw new AppError("UNAUTHENTICATED", "Authentication required");
    return sendOk(reply, deletionResultSchema, await privacy.deleteAccount(tenantOf(req), req.customer, parseInput(deleteAccountSchema, req.body).confirmEmail));
  });
}
