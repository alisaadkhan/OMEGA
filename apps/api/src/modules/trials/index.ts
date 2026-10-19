import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  trialApprovalResultSchema,
  trialApproveSchema,
  trialCandidateQuerySchema,
  trialCandidateSchema,
  trialFeedbackCreateSchema,
  trialFeedbackListSchema,
  trialReceivedSchema,
  trialRejectSchema,
  trialRequestCreateSchema,
  trialRequestListSchema,
  trialRequestQuerySchema,
  trialRequestSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule, PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { rateLimitError, type RateLimiter } from "../../rate-limit/types";
import type { StaffAction, StaffPrincipal } from "../staff/index";
import type { TrialService } from "./service";

export { createTrialService, type TrialService } from "./service";

const idParams = z.object({ id: z.uuid() });
const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, requestId: req.id });
const staffOf = (req: FastifyRequest): StaffPrincipal => {
  if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
  return req.staff;
};

/**
 * Founder-assisted trial routes. Public: the callback form (rate-limited per address, small body, no sign-in, never
 * reveals anything stored). Customers: trial feedback for their own workspace. Staff: the request queue (all roles,
 * since Support calls people back), and approving, rejecting, the account lookup and the feedback export (Super Admin,
 * with the hardware-key step-up that every non-Support action needs).
 */
export function createTrialsModule(o: { service: TrialService; limiter: RateLimiter; requireStaff: (action: StaffAction) => PreHandler }): AppModule {
  function register(app: FastifyInstance, guards: { customer: PreHandler }) {
    const r = o.requireStaff;
    app.post("/v1/public/trial-requests", { bodyLimit: 8_192 }, async (req, reply) => {
      const limited = await o.limiter.limit("callback", req.ip);
      if (!limited.allowed) throw rateLimitError(limited.retryAfterSeconds);
      await o.service.submit(parseInput(trialRequestCreateSchema, req.body));
      return sendOk(reply, trialReceivedSchema, { received: true }, 202);
    });

    app.post("/v1/trial-feedback", { preHandler: guards.customer, bodyLimit: 16_384 }, async (req, reply) => {
      await o.service.submitFeedback(tenantOf(req), parseInput(trialFeedbackCreateSchema, req.body));
      return sendOk(reply, trialReceivedSchema, { received: true }, 201);
    });

    app.get("/admin/v1/trial-requests", { preHandler: r("trials.read") }, async (req, reply) =>
      sendOk(reply, trialRequestListSchema, { requests: await o.service.list(parseInput(trialRequestQuerySchema, req.query).status) }),
    );
    app.post("/admin/v1/trial-requests/:id/contacted", { preHandler: r("trials.contact") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, trialRequestSchema, await o.service.markContacted(staffOf(req), id, meta(req)));
    });
    app.get("/admin/v1/trial-candidates", { preHandler: r("trials.decide") }, async (req, reply) => {
      const found = await o.service.candidate(parseInput(trialCandidateQuerySchema, req.query).email);
      if (!found) throw new AppError("NOT_FOUND", "No MUSHIN account uses that email.");
      return sendOk(reply, trialCandidateSchema, found);
    });
    app.post("/admin/v1/trial-requests/:id/approve", { preHandler: r("trials.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, trialApprovalResultSchema, await o.service.approve(staffOf(req), id, parseInput(trialApproveSchema, req.body), meta(req)));
    });
    app.post("/admin/v1/trial-requests/:id/reject", { preHandler: r("trials.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, trialRequestSchema, await o.service.reject(staffOf(req), id, parseInput(trialRejectSchema, req.body).note, meta(req)));
    });
    app.get("/admin/v1/trial-feedback", { preHandler: r("trials.feedback.read") }, async (req, reply) => {
      const { limit } = parseInput(z.object({ limit: z.coerce.number().int().min(1).max(1000).default(500) }), req.query);
      return sendOk(reply, trialFeedbackListSchema, { feedback: await o.service.feedback(limit) });
    });
  }
  return { name: "trials", register };
}
