import cookie from "@fastify/cookie";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import "./auth/customer-guard";
import type { Logger } from "@mushin/core";
import { registerErrorHandling } from "./http/errors";
import { registerHealth } from "./http/health";
import { requestIdFrom } from "./http/request-id";
import { registerSecurity } from "./http/security";
import type { AppModule, Guards, OnRequestHook, ReadinessCheck } from "./http/types";

export type AppDeps = {
  logger: Logger;
  allowedOrigins: string[];
  guards: Guards;
  modules: AppModule[];
  readiness: ReadinessCheck[];
  onRequestHooks?: OnRequestHook[];
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Widen to Fastify's logger type so the instance matches plain `FastifyInstance` everywhere else.
  const logger: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance: logger,
    genReqId: requestIdFrom,
    requestIdHeader: false,
    bodyLimit: 1_048_576,
  });
  app.decorateRequest("customer", null);
  app.decorateRequest("tenant", null);

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });
  registerErrorHandling(app);
  await registerSecurity(app, deps.allowedOrigins);
  await app.register(cookie);
  for (const hook of deps.onRequestHooks ?? []) app.addHook("onRequest", hook);

  registerHealth(app, deps.readiness);
  for (const mod of deps.modules) mod.register(app, deps.guards);

  await app.ready();
  return app;
}
