import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addListMembersResponseSchema,
  addListMembersSchema,
  createListSchema,
  listDetailSchema,
  listIndexQuerySchema,
  listIndexSchema,
  listSummarySchema,
  removeListMembersSchema,
  updateListMemberSchema,
  updateListSchema,
} from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { ListsService } from "./service";

const idParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), creatorId: z.uuid() });

export function registerListRoutes(app: FastifyInstance, guards: Guards, service: ListsService): void {
  const auth = { preHandler: guards.customer };

  app.get("/v1/lists", auth, async (req, reply) => {
    const q = parseInput(listIndexQuerySchema, req.query);
    return sendOk(reply, listIndexSchema, await service.index(tenantOf(req), q.creatorId));
  });
  app.post("/v1/lists", auth, async (req, reply) => {
    const body = parseInput(createListSchema, req.body);
    return sendOk(reply, listSummarySchema, await service.create(tenantOf(req), body), 201);
  });
  app.get("/v1/lists/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, listDetailSchema, await service.detail(tenantOf(req), id));
  });
  app.patch("/v1/lists/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, listSummarySchema, await service.update(tenantOf(req), id, parseInput(updateListSchema, req.body)));
  });
  app.delete("/v1/lists/:id", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    await service.remove(tenantOf(req), id);
    return reply.status(204).send();
  });
  app.post("/v1/lists/:id/members", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(addListMembersSchema, req.body);
    return sendOk(reply, addListMembersResponseSchema, await service.addMembers(tenantOf(req), id, body.creatorIds));
  });
  // POST rather than DELETE with a body: bulk removal of the selected creators.
  app.post("/v1/lists/:id/members/remove", auth, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(removeListMembersSchema, req.body);
    return sendOk(reply, z.object({ removed: z.number().int() }), await service.removeMembers(tenantOf(req), id, body.creatorIds));
  });
  app.patch("/v1/lists/:id/members/:creatorId", auth, async (req, reply) => {
    const { id, creatorId } = parseInput(memberParams, req.params);
    await service.setNote(tenantOf(req), id, creatorId, parseInput(updateListMemberSchema, req.body).note);
    return reply.status(204).send();
  });
}
