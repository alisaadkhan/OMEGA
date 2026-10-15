import type { FastifyRequest } from "fastify";
import { AppError, type TenantContext } from "@mushin/core";
import { bearerToken } from "../http/bearer";
import type { PreHandler } from "../http/types";
import { rateLimitError, type RateLimiter } from "../rate-limit/types";
import type { CustomerIdentity, CustomerTokenVerifier } from "./customer-token";

declare module "fastify" {
  interface FastifyRequest {
    customer: CustomerIdentity | null;
    tenant: TenantContext | null;
  }
}

/** `workspaceId`: the workspace the client asked for (X-Workspace-Id); honoured only if the user is a member. */
export type ResolveTenant = (identity: CustomerIdentity, requestId: string, workspaceId?: string) => Promise<TenantContext>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCustomerGuard(o: {
  verify: CustomerTokenVerifier;
  resolveTenant: ResolveTenant;
  limiter: RateLimiter;
}): PreHandler {
  return async (req) => {
    const token = bearerToken(req);
    if (!token) throw new AppError("UNAUTHENTICATED", "Authentication required");
    const identity = await o.verify(token);
    const r = await o.limiter.limit("user", identity.userId);
    if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
    req.customer = identity;
    const asked = req.headers["x-workspace-id"];
    const workspaceId = typeof asked === "string" && UUID.test(asked) ? asked.toLowerCase() : undefined;
    req.tenant = await o.resolveTenant(identity, req.id, workspaceId);
  };
}

export function tenantOf(req: FastifyRequest): TenantContext {
  if (!req.tenant) throw new AppError("UNAUTHENTICATED", "Authentication required");
  return req.tenant;
}
