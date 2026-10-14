import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLiveEstimateSchema, discoveryJobListSchema, discoveryJobSchema, liveEstimateSchema, discoveryResultsResponseSchema, startDiscoveryJobResponseSchema, startDiscoveryJobSchema } from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { limitPaidStart, type RateLimiter } from "../../rate-limit/types";
import type { DiscoveryService } from "./service";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ active: z.enum(["true"]).optional() });

export function registerDiscoveryRoutes(app: FastifyInstance, guards: Guards, service: DiscoveryService, limiter: RateLimiter): void {
  const read = { preHandler: guards.customer };

  app.post("/v1/discovery/estimates", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) => {
    const ctx = tenantOf(req);
    const body = parseInput(createLiveEstimateSchema, req.body);
    await limitPaidStart(limiter, ctx);
    const estimate = await service.createEstimate(ctx, body);
    return sendOk(reply, liveEstimateSchema, estimate, 201);
  });

  app.post("/v1/discovery/jobs", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) => {
    const ctx = tenantOf(req);
    const body = parseInput(startDiscoveryJobSchema, req.body);
    await limitPaidStart(limiter, ctx);
    const out = await service.start(ctx, body);
    return sendOk(reply, startDiscoveryJobResponseSchema, out.body, out.httpStatus);
  });

  app.get("/v1/discovery/jobs/:id", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, discoveryJobSchema, await service.get(tenantOf(req), id));
  });

  app.post("/v1/discovery/jobs/:id/cancel", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, discoveryJobSchema, await service.cancel(tenantOf(req), id));
  });

  const resultsQuery = z.object({ after: z.coerce.number().int().min(0).max(1_000_000).default(0) });

  app.get("/v1/discovery/jobs/:id/results", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const { after } = parseInput(resultsQuery, req.query);
    return sendOk(reply, discoveryResultsResponseSchema, await service.results(tenantOf(req), id, after));
  });

  app.get("/v1/discovery/jobs", read, async (req, reply) => {
    parseInput(listQuery, req.query);
    return sendOk(reply, discoveryJobListSchema, await service.listActive(tenantOf(req)));
  });
}
