import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  staffLoginRequestSchema,
  staffLoginResponseSchema,
  staffMeResponseSchema,
  staffSessionResponseSchema,
  staffTotpRequestSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { bearerToken } from "../../http/bearer";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { can, HARDWARE_KEY_ACTIONS, type StaffAction } from "./permissions";
import { SESSION_DAYS, type RequestMeta, type StaffService } from "./service";
import type { StaffPrincipal, StaffTokens } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    staff: StaffPrincipal | null;
  }
}

export const REFRESH_COOKIE = "mushin_staff_rt";
export const COOKIE_PATH = "/admin/v1/auth";

export function metaOf(req: FastifyRequest): RequestMeta {
  const ua = req.headers["user-agent"];
  return { ip: req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null, requestId: req.id };
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function createRequireStaff(tokens: StaffTokens) {
  return (action: StaffAction): PreHandler =>
    async (req) => {
      const token = bearerToken(req);
      if (!token) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
      const principal = await tokens.verifyAccess(token);
      if (!can(principal.role, action)) throw new AppError("FORBIDDEN", "You do not have permission to do this");
      if (HARDWARE_KEY_ACTIONS.has(action) && !principal.factors.includes("hwk")) {
        throw new AppError("FORBIDDEN", "This admin action needs a hardware security key sign-in, which is not available yet.", { reason: "hardware_key_required" });
      }
      req.staff = principal;
    };
}

export function registerStaffRoutes(app: FastifyInstance, service: StaffService, requireStaff: ReturnType<typeof createRequireStaff>) {
  app.decorateRequest("staff", null);

  app.post("/admin/v1/auth/login", async (req, reply) => {
    const body = parseInput(staffLoginRequestSchema, req.body);
    return sendOk(reply, staffLoginResponseSchema, await service.login(body, metaOf(req)));
  });

  app.post("/admin/v1/auth/totp", async (req, reply) => {
    const body = parseInput(staffTotpRequestSchema, req.body);
    const session = await service.completeTotp(body, metaOf(req));
    setRefreshCookie(reply, session.refreshToken);
    return sendOk(reply, staffSessionResponseSchema, {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      staff: session.staff,
    });
  });

  app.post("/admin/v1/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError("UNAUTHENTICATED", "Your admin session has ended. Please sign in again.");
    const session = await service.refresh(token, metaOf(req));
    setRefreshCookie(reply, session.refreshToken);
    return sendOk(reply, staffSessionResponseSchema, {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      staff: session.staff,
    });
  });

  app.post("/admin/v1/auth/logout", async (req, reply) => {
    await service.logout(req.cookies[REFRESH_COOKIE], metaOf(req));
    void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: true, sameSite: "strict" });
    return reply.status(204).send();
  });

  app.get("/admin/v1/me", { preHandler: requireStaff("staff.me.read") }, async (req, reply) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return sendOk(reply, staffMeResponseSchema, { staff: await service.getProfile(req.staff.staffId) });
  });
}
