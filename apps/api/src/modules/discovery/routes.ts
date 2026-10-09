import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discoveryJobListSchema, discoveryJobSchema, startDiscoveryJobResponseSchema, startDiscoveryJobSchema } from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { rateLimitError, type RateLimiter } from "../../rate-limit/types";
import type { DiscoveryService } from "./service";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ active: z.enum(["true"]).optional() });

export function registerDiscoveryRoutes(app: FastifyInstance, guards: Guards, service: DiscoveryService, limiter: RateLimiter): void {
  const read = { preHandler: guards.customer };

  app.post("/v1/discovery/jobs", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) => {
    const ctx = tenantOf(req);
    const body = parseInput(startDiscoveryJobSchema, req.body);
    const r = await limiter.limit("jobs", ctx.userId);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
    const out = await service.start(ctx, body);
    return sendOk(reply, startDiscoveryJobResponseSchema, out.body, out.httpStatus);
  });

  app.get("/v1/discovery/jobs/:id", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, discoveryJobSchema, await service.get(tenantOf(req), id));
  });

  app.get("/v1/discovery/jobs", read, async (req, reply) => {
    parseInput(listQuery, req.query);
    return sendOk(reply, discoveryJobListSchema, await service.listActive(tenantOf(req)));
  });
}
