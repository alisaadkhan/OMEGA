import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addCampaignCreatorsResponseSchema,
  addCampaignCreatorsSchema,
  campaignDetailSchema,
  campaignIndexQuerySchema,
  campaignIndexSchema,
  campaignSummarySchema,
  createCampaignSchema,
  logOutreachSchema,
  outreachEventSchema,
  outreachLogSchema,
  updateCampaignCreatorSchema,
  updateCampaignSchema,
} from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { CampaignsService } from "./service";

const idParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), creatorId: z.uuid() });

export function registerCampaignRoutes(app: FastifyInstance, guards: Guards, service: CampaignsService): void {
  const auth = { preHandler: guards.customer };

  app.get("/v1/campaigns", auth, async (req, reply) => {
    const q = parseInput(campaignIndexQuerySchema, req.query);
    return sendOk(reply, campaignIndexSchema, await service.index(tenantOf(req), q.creatorId));
  });
  app.post("/v1/campaigns", auth, async (req, reply) =>
    sendOk(reply, campaignSummarySchema, await service.create(tenantOf(req), parseInput(createCampaignSchema, req.body)), 201),
  );
  app.get("/v1/campaigns/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, campaignDetailSchema, await service.detail(tenantOf(req), id));
  });
  app.patch("/v1/campaigns/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, campaignSummarySchema, await service.update(tenantOf(req), id, parseInput(updateCampaignSchema, req.body)));
  });
  app.delete("/v1/campaigns/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    await service.remove(tenantOf(req), id);
    return reply.status(204).send();
  });
  app.post("/v1/campaigns/:id/creators", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(addCampaignCreatorsSchema, req.body);
    return sendOk(reply, addCampaignCreatorsResponseSchema, await service.addCreators(tenantOf(req), id, body.creatorIds));
  });
  app.patch("/v1/campaigns/:id/creators/:creatorId", auth, async (req, reply) => {
    const { id, creatorId } = parseInput(memberParams, req.params);
    const out = await service.updateCreator(tenantOf(req), id, creatorId, parseInput(updateCampaignCreatorSchema, req.body));
    return sendOk(reply, z.object({ version: z.number().int() }), out);
  });
  app.delete("/v1/campaigns/:id/creators/:creatorId", auth, async (req, reply) => {
    const { id, creatorId } = parseInput(memberParams, req.params);
    await service.removeCreator(tenantOf(req), id, creatorId);
    return reply.status(204).send();
  });
  app.get("/v1/campaigns/:id/creators/:creatorId/outreach", auth, async (req, reply) => {
    const { id, creatorId } = parseInput(memberParams, req.params);
    return sendOk(reply, outreachLogSchema, await service.outreach(tenantOf(req), id, creatorId));
  });
  app.post("/v1/campaigns/:id/creators/:creatorId/outreach", auth, async (req, reply) => {
    const { id, creatorId } = parseInput(memberParams, req.params);
    return sendOk(reply, outreachEventSchema, await service.logOutreach(tenantOf(req), id, creatorId, parseInput(logOutreachSchema, req.body)), 201);
  });
}
