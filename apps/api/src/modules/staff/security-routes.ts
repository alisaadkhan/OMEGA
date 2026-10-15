import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  staffSecuritySchema,
  staffSessionResponseSchema,
  webauthnOptionsResponseSchema,
  webauthnRegisterRequestSchema,
  webauthnStepUpRequestSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { parseInput, sendOk } from "../../http/validate";
import { HARDWARE_KEY_ACTIONS, STAFF_PERMISSIONS, type StaffAction } from "./permissions";
import { metaOf, type createRequireStaff } from "./routes";
import { ACCESS_TTL_SECONDS, type StaffPrincipal, type StaffTokens } from "./tokens";
import type { StaffService } from "./service";
import type { WebAuthn } from "./webauthn";

const needsKey = (role: StaffPrincipal["role"]) =>
  (Object.keys(STAFF_PERMISSIONS) as StaffAction[]).some((a) => HARDWARE_KEY_ACTIONS.has(a) && (STAFF_PERMISSIONS[a] as readonly string[]).includes(role));

/** Hardware-key enrolment and step-up. The step-up returns an access token that also carries the "hwk" factor. */
export function registerSecurityRoutes(app: FastifyInstance, o: { webauthn: WebAuthn; tokens: StaffTokens; service: StaffService; requireStaff: ReturnType<typeof createRequireStaff> }) {
  const me = (p: StaffPrincipal | null): StaffPrincipal => {
    if (!p) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return p;
  };

  app.get("/admin/v1/security", { preHandler: o.requireStaff("staff.security.read") }, async (req, reply) => {
    const p = me(req.staff);
    return sendOk(reply, staffSecuritySchema, { factors: p.factors, keys: await o.webauthn.keys(p.staffId), hardwareKeyRequired: needsKey(p.role) });
  });

  app.post("/admin/v1/security/keys/options", { preHandler: o.requireStaff("staff.webauthn.manage") }, async (req, reply) =>
    sendOk(reply, webauthnOptionsResponseSchema, { options: (await o.webauthn.registrationOptions(me(req.staff))) as unknown as Record<string, unknown> }),
  );

  app.post("/admin/v1/security/keys", { preHandler: o.requireStaff("staff.webauthn.manage") }, async (req, reply) => {
    const body = parseInput(webauthnRegisterRequestSchema, req.body);
    const out = await o.webauthn.register(me(req.staff), body.response as unknown as RegistrationResponseJSON, body.nickname, metaOf(req));
    return sendOk(reply, z.object({ id: z.uuid() }), out, 201);
  });

  app.delete("/admin/v1/security/keys/:id", { preHandler: o.requireStaff("staff.webauthn.manage") }, async (req, reply) => {
    const { id } = parseInput(z.object({ id: z.uuid() }), req.params);
    await o.webauthn.revoke(me(req.staff), id, metaOf(req));
    return reply.status(204).send();
  });

  app.post("/admin/v1/security/step-up/options", { preHandler: o.requireStaff("staff.security.read") }, async (req, reply) =>
    sendOk(reply, webauthnOptionsResponseSchema, { options: (await o.webauthn.authenticationOptions(me(req.staff).staffId)) as unknown as Record<string, unknown> }),
  );

  app.post("/admin/v1/security/step-up", { preHandler: o.requireStaff("staff.security.read") }, async (req, reply) => {
    const p = me(req.staff);
    const body = parseInput(webauthnStepUpRequestSchema, req.body);
    await o.webauthn.authenticate(p.staffId, body.response as unknown as AuthenticationResponseJSON, metaOf(req));
    // The proven factors of this session plus the key; it lasts one access-token lifetime and is not refreshed.
    const factors = [...new Set([...p.factors, "hwk" as const])];
    return sendOk(reply, staffSessionResponseSchema, {
      accessToken: await o.tokens.signAccess({ staffId: p.staffId, role: p.role, factors }),
      expiresInSeconds: ACCESS_TTL_SECONDS,
      staff: await o.service.getProfile(p.staffId),
    });
  });
}
