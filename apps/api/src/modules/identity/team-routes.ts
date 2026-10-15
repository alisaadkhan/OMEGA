import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  acceptedInvitationSchema,
  acceptInvitationSchema,
  createdInvitationSchema,
  createInvitationSchema,
  deleteAccountSchema,
  deleteWorkspaceSchema,
  deletionResultSchema,
  invitationListSchema,
  invitationPreviewSchema,
  memberRoleUpdateSchema,
  myWorkspacesSchema,
  transferOwnershipSchema,
  workspaceExportSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { PrivacyService } from "./privacy";
import type { TeamService } from "./team";

const idParams = z.object({ id: z.uuid() });
const userParams = z.object({ userId: z.uuid() });

/** Team (invitations, roles, removal, ownership) and privacy self-service (export, deletion) routes. */
export function registerTeamRoutes(app: FastifyInstance, guards: Guards, team: TeamService, privacy: PrivacyService) {
  const auth = { preHandler: guards.customer };
  const identityOf = (req: Parameters<typeof tenantOf>[0]) => {
    if (!req.customer) throw new AppError("UNAUTHENTICATED", "Authentication required");
    return req.customer;
  };

  app.get("/v1/me/workspaces", auth, async (req, reply) => sendOk(reply, myWorkspacesSchema, { workspaces: await team.myWorkspaces(tenantOf(req)) }));

  app.get("/v1/workspace/invitations", auth, async (req, reply) => sendOk(reply, invitationListSchema, { invitations: await team.invitations(tenantOf(req)) }));
  app.post("/v1/workspace/invitations", auth, async (req, reply) => {
    const body = parseInput(createInvitationSchema, req.body);
    return sendOk(reply, createdInvitationSchema, await team.invite(tenantOf(req), body.email, body.role), 201);
  });
  app.delete("/v1/workspace/invitations/:id", auth, async (req, reply) => {
    await team.revoke(tenantOf(req), parseInput(idParams, req.params).id);
    return reply.status(204).send();
  });
  app.post("/v1/invitations/preview", auth, async (req, reply) => sendOk(reply, invitationPreviewSchema, invitationPreviewSchema.parse(await team.preview(parseInput(acceptInvitationSchema, req.body).token))));
  app.post("/v1/invitations/accept", auth, async (req, reply) => sendOk(reply, acceptedInvitationSchema, await team.accept(identityOf(req), parseInput(acceptInvitationSchema, req.body).token)));

  app.patch("/v1/workspace/members/:userId", auth, async (req, reply) => {
    await team.setRole(tenantOf(req), parseInput(userParams, req.params).userId, parseInput(memberRoleUpdateSchema, req.body).role);
    return reply.status(204).send();
  });
  app.delete("/v1/workspace/members/:userId", auth, async (req, reply) => {
    await team.remove(tenantOf(req), parseInput(userParams, req.params).userId);
    return reply.status(204).send();
  });
  app.post("/v1/workspace/transfer-ownership", auth, async (req, reply) => {
    await team.transfer(tenantOf(req), parseInput(transferOwnershipSchema, req.body).userId);
    return reply.status(204).send();
  });

  // Privacy self-service. The export is a download; it is never cached (API responses are private, no-store).
  app.get("/v1/workspace/export", auth, async (req, reply) => {
    const data = workspaceExportSchema.parse(await privacy.exportWorkspace(tenantOf(req)));
    void reply.header("content-disposition", `attachment; filename="mushin-workspace-export-${data.exportedAt.slice(0, 10)}.json"`);
    return sendOk(reply, workspaceExportSchema, data);
  });
  app.post("/v1/workspace/delete", auth, async (req, reply) => sendOk(reply, deletionResultSchema, await privacy.deleteWorkspace(tenantOf(req), parseInput(deleteWorkspaceSchema, req.body).confirmName)));
  app.post("/v1/me/delete", auth, async (req, reply) => sendOk(reply, deletionResultSchema, await privacy.deleteAccount(tenantOf(req), identityOf(req), parseInput(deleteAccountSchema, req.body).confirmEmail)));
}
