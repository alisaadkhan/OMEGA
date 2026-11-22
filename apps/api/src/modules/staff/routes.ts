import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  staffLoginRequestSchema,
  staffLoginResponseSchema,
  staffTwoFactorCodeSchema,
  staffTwoFactorSetupSchema,
  staffTwoFactorStatusSchema,
  staffMeResponseSchema,
  staffSessionResponseSchema,
  staffTotpRequestSchema,
} from "@mushin/contracts";
import { z } from "zod";
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

/**
 * The refresh cookie's path as the browser sees it: when the host mounts the API under a prefix (/api on Vercel), the
 * part of the original URL that was stripped before routing is put back, so the cookie is sent to /api/admin/v1/auth.
 */
export function cookiePathFor(req: FastifyRequest): string {
  const original = req.originalUrl ?? req.url;
  const mount = original.length > req.url.length && original.endsWith(req.url) ? original.slice(0, original.length - req.url.length) : "";
  return `${mount}${COOKIE_PATH}`;
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: cookiePathFor(reply.request),
    maxAge: SESSION_DAYS * 86_400,
  });
}

/**
 * Staff authorization chain (staff spec §3): valid token → active staff account with the token's role (checked on every
 * request, so a suspension or role change applies at once) → role permits the action → hardware-key step-up when the
 * action needs it. Customer workspace roles never reach here.
 */
export function createRequireStaff(
  tokens: StaffTokens,
  isActive: (staffId: string, role: StaffPrincipal["role"]) => Promise<boolean>,
  hasStepUp: (staffId: string, stepUpId: string) => Promise<boolean>,
) {
  return (action: StaffAction): PreHandler =>
    async (req) => {
      const token = bearerToken(req);
      if (!token) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
      const principal = await tokens.verifyAccess(token);
      if (!(await isActive(principal.staffId, principal.role))) throw new AppError("UNAUTHENTICATED", "Your staff access has changed. Please sign in again.");
      // The hardware-key factor comes only from a live step-up row on the server (audit SEC-02), never from the token.
      if (principal.stepUpId && (await hasStepUp(principal.staffId, principal.stepUpId))) principal.factors = [...principal.factors, "hwk"];
      if (!can(principal.role, action)) throw new AppError("FORBIDDEN", "You do not have permission to do this");
      if (HARDWARE_KEY_ACTIONS.has(action) && !principal.factors.includes("hwk")) {
        throw new AppError("FORBIDDEN", "This action needs your security key. Confirm with it, then try again.", { reason: "hardware_key_required" });
      }
      req.staff = principal;
    };
}

export function registerStaffRoutes(app: FastifyInstance, service: StaffService, requireStaff: ReturnType<typeof createRequireStaff>) {
  app.decorateRequest("staff", null);

  app.post("/admin/v1/auth/login", async (req, reply) => {
    const body = parseInput(staffLoginRequestSchema, req.body);
    const r = await service.login(body, metaOf(req));
    if (r.kind === "challenge") return sendOk(reply, staffLoginResponseSchema, { challengeToken: r.challengeToken });
    // Two-factor off for this person (0094): the password alone starts the session.
    setRefreshCookie(reply, r.session.refreshToken);
    return sendOk(reply, staffLoginResponseSchema, { accessToken: r.session.accessToken, expiresInSeconds: r.session.expiresInSeconds, staff: r.session.staff });
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
    void reply.clearCookie(REFRESH_COOKIE, { path: cookiePathFor(reply.request), httpOnly: true, secure: true, sameSite: "strict" });
    return reply.status(204).send();
  });

  // Two-factor sign-in in Settings (owner, 22 Nov): each person sees, sets up, turns on or off their own.
  const self = (req: FastifyRequest) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff.staffId;
  };
  app.get("/admin/v1/security/two-factor", { preHandler: requireStaff("staff.two_factor.manage") }, async (req, reply) =>
    sendOk(reply, staffTwoFactorStatusSchema, await service.twoFactorStatus(self(req))),
  );
  app.post("/admin/v1/security/two-factor/setup", { preHandler: requireStaff("staff.two_factor.manage") }, async (req, reply) =>
    sendOk(reply, staffTwoFactorSetupSchema, await service.startTwoFactorSetup(self(req), metaOf(req))),
  );
  app.post("/admin/v1/security/two-factor/enable", { preHandler: requireStaff("staff.two_factor.manage") }, async (req, reply) => {
    const { code } = parseInput(staffTwoFactorCodeSchema, req.body);
    await service.enableTwoFactor(self(req), code, metaOf(req));
    return sendOk(reply, staffTwoFactorStatusSchema, await service.twoFactorStatus(self(req)));
  });
  app.post("/admin/v1/security/two-factor/disable", { preHandler: requireStaff("staff.two_factor.manage") }, async (req, reply) => {
    const { code } = parseInput(z.object({ code: z.string().max(6).default("") }), req.body);
    await service.disableTwoFactor(self(req), code, metaOf(req));
    return sendOk(reply, staffTwoFactorStatusSchema, await service.twoFactorStatus(self(req)));
  });

  app.get("/admin/v1/me", { preHandler: requireStaff("staff.me.read") }, async (req, reply) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return sendOk(reply, staffMeResponseSchema, { staff: await service.getProfile(req.staff.staffId) });
  });
}
