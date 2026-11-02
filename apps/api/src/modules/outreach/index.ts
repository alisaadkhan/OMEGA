import { z } from "zod";
import { outreachComposeSchema, outreachDraftSchema, outreachEmailListSchema, outreachEmailSchema, outreachPreviewSchema, outreachUsageSchema, sendOutreachEmailSchema, unsubscribeRequestSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { WebhookSignatureError } from "@mushin/integrations";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { createOutreachEmailService, type OutreachDeps } from "./service";

export { createOutreachEmailService, SENDS_PER_USER_PER_HOUR, type OutreachEmailService } from "./service";

const campaignParams = z.object({ id: z.uuid() });
const sendParams = z.object({ id: z.uuid(), creatorId: z.uuid() });
const header = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Outreach email: usage, per-campaign history, confirmed single sends, unsubscribe and provider webhooks. */
export function createOutreachModule(deps: OutreachDeps): { module: AppModule; service: ReturnType<typeof createOutreachEmailService> } {
  const service = createOutreachEmailService(deps);
  const module: AppModule = {
    name: "outreach",
    register(app, guards) {
      const read = { preHandler: guards.customer };
      const write = { preHandler: [guards.customer, guards.idempotent] };
      app.get("/v1/outreach/usage", read, async (req, reply) => sendOk(reply, outreachUsageSchema, await service.usage(tenantOf(req))));
      app.get("/v1/campaigns/:id/emails", read, async (req, reply) =>
        sendOk(reply, outreachEmailListSchema, { emails: await service.list(tenantOf(req), parseInput(campaignParams, req.params).id) }),
      );
      // A ready-to-edit draft and an exact preview (nothing is stored or sent by either).
      app.get("/v1/campaigns/:id/creators/:creatorId/email-draft", read, async (req, reply) => {
        const p = parseInput(sendParams, req.params);
        return sendOk(reply, outreachDraftSchema, await service.draft(tenantOf(req), p.id, p.creatorId));
      });
      app.post("/v1/campaigns/:id/creators/:creatorId/email-preview", read, async (req, reply) => {
        const p = parseInput(sendParams, req.params);
        return sendOk(reply, outreachPreviewSchema, await service.preview(tenantOf(req), p.id, p.creatorId, parseInput(outreachComposeSchema, req.body)));
      });
      app.post("/v1/campaigns/:id/creators/:creatorId/emails", write, async (req, reply) => {
        const p = parseInput(sendParams, req.params);
        const body = parseInput(sendOutreachEmailSchema, req.body);
        const key = header(req.headers["idempotency-key"]);
        if (!key) throw new AppError("VALIDATION_FAILED", "Idempotency-Key header is required");
        return sendOk(reply, outreachEmailSchema, await service.send(tenantOf(req), p.id, p.creatorId, body, key), 201);
      });
      app.post("/v1/public/email-unsubscribe", async (req, reply) => {
        await service.unsubscribe(parseInput(unsubscribeRequestSchema, req.body).token);
        return reply.status(204).send();
      });
      // Provider → MUSHIN. The signature covers the raw body, so this scope keeps JSON unparsed.
      void app.register(async (scope) => {
        scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
        scope.post("/webhooks/resend", async (req, reply) => {
          try {
            const result = await service.handleWebhook(
              { id: header(req.headers["svix-id"]), timestamp: header(req.headers["svix-timestamp"]), signature: header(req.headers["svix-signature"]) },
              typeof req.body === "string" ? req.body : "",
            );
            return reply.status(200).send({ result });
          } catch (err) {
            if (err instanceof WebhookSignatureError) {
              req.log.warn({ err }, "rejected an email webhook");
              throw new AppError("UNAUTHENTICATED", "Invalid webhook signature");
            }
            throw err;
          }
        });
      });
    },
  };
  return { module, service };
}
