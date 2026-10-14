import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audienceRequestSchema, audienceStateSchema } from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { limitPaidStart, type RateLimiter } from "../../rate-limit/types";
import type { AudienceService } from "./service";

const idParams = z.object({ id: z.uuid() });

export function registerAudienceRoutes(app: FastifyInstance, guards: Guards, service: AudienceService, limiter: RateLimiter): void {
  const read = { preHandler: guards.customer };
  const write = { preHandler: [guards.customer, guards.idempotent] };

  // Reading the state (quote, latest job, any unexpired result) never computes or charges anything.
  app.get("/v1/creators/:id/audience", read, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    return sendOk(reply, audienceStateSchema, await service.state(tenantOf(req), id));
  });

  // Explicit, confirmed request: reserves the quoted credits and queues the estimate (202), or returns what exists (200).
  app.post("/v1/creators/:id/audience/estimate", write, async (req, reply) => {
    const ctx = tenantOf(req);
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(audienceRequestSchema, req.body);
    await limitPaidStart(limiter, ctx);
    const out = await service.request(ctx, id, body.confirmedCost);
    return sendOk(reply, audienceStateSchema, out.body, out.httpStatus);
  });
}
