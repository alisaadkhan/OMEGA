import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  audienceResponseSchema,
  creatorProfileSchema,
  interpretRequestSchema,
  interpretResponseSchema,
  lookupQuerySchema,
  lookupResponseSchema,
  revealRequestSchema,
  revealResponseSchema,
  savedSearchCreateSchema,
  savedSearchListSchema,
  savedSearchSchema,
  searchRequestSchema,
  searchResponseSchema,
} from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { rateLimitError, type RateLimiter } from "../../rate-limit/types";
import type { CreatorsService } from "./service";

const idParams = z.object({ id: z.uuid() });

export function registerCreatorRoutes(app: FastifyInstance, guards: Guards, service: CreatorsService, limiter: RateLimiter): void {
  const read = { preHandler: guards.customer };
  const write = { preHandler: [guards.customer, guards.idempotent] };

  // Search is read-only: POST only because filters do not fit a query string.
  app.post("/v1/search", read, async (req, reply) =>
    sendOk(reply, searchResponseSchema, await service.search(tenantOf(req), parseInput(searchRequestSchema, req.body))),
  );

  app.post("/v1/search/interpret", read, async (req, reply) => {
    const ctx = tenantOf(req);
    const body = parseInput(interpretRequestSchema, req.body);
    const r = await limiter.limit("ai", ctx.userId);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
    return sendOk(reply, interpretResponseSchema, await service.interpret(ctx, body.text));
  });

  app.get("/v1/creators/lookup", read, async (req, reply) => {
    const q = parseInput(lookupQuerySchema, req.query);
    return sendOk(reply, lookupResponseSchema, await service.lookup(tenantOf(req), q.q));
  });

  app.get("/v1/search/saved", read, async (req, reply) => sendOk(reply, savedSearchListSchema, await service.listSaved(tenantOf(req))));
  app.post("/v1/search/saved", read, async (req, reply) => {
    const body = parseInput(savedSearchCreateSchema, req.body);
    return sendOk(reply, savedSearchSchema, await service.createSaved(tenantOf(req), body), 201);
  });
  app.delete("/v1/search/saved/:id", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    await service.deleteSaved(tenantOf(req), id);
    return reply.status(204).send();
  });

  app.get("/v1/creators/:id", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, creatorProfileSchema, await service.profile(tenantOf(req), id));
  });
  app.get("/v1/creators/:id/audience", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, audienceResponseSchema, await service.audience(tenantOf(req), id));
  });
  app.post("/v1/creators/:id/reveal", write, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(revealRequestSchema, req.body);
    return sendOk(reply, revealResponseSchema, await service.reveal(tenantOf(req), id, body.confirmedCost));
  });
}
