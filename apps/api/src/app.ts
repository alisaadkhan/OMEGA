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
  /** Proxies whose X-Forwarded-For is believed (audit SEC-05); empty or absent = none, the socket address is used. */
  trustedProxies?: string[];
  guards: Guards;
  modules: AppModule[];
  readiness: ReadinessCheck[];
  onRequestHooks?: OnRequestHook[];
  /**
   * Public path the API is mounted under by the host (Vercel rewrites /api/* to this service and keeps the path):
   * requests arrive as /api/v1/… and are routed as /v1/…. Empty when the API is served at its root (local, behind the
   * Vite proxy that strips /api itself).
   */
  pathPrefix?: string;
};

/** Strips the mount prefix from an incoming URL; anything else is routed unchanged. */
export function stripPathPrefix(url: string, prefix: string): string {
  if (!prefix) return url;
  if (url === prefix) return "/";
  if (url.startsWith(`${prefix}?`)) return `/${url.slice(prefix.length)}`;
  return url.startsWith(`${prefix}/`) ? url.slice(prefix.length) : url;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Widen to Fastify's logger type so the instance matches plain `FastifyInstance` everywhere else.
  const logger: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: deps.trustedProxies && deps.trustedProxies.length > 0 ? deps.trustedProxies : false,
    genReqId: requestIdFrom,
    requestIdHeader: false,
    bodyLimit: 1_048_576,
    rewriteUrl: (req) => stripPathPrefix(req.url ?? "/", deps.pathPrefix ?? ""),
  });
  app.decorateRequest("customer", null);
  app.decorateRequest("tenant", null);

  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
    // Every API response is personal or operational: never kept by browsers or shared caches (PERF-001).
    // A route may still set its own policy; this is only the default.
    void reply.header("cache-control", "private, no-store");
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
