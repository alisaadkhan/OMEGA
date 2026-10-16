import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import type { StaffAction } from "./permissions";
import { createRequireStaff, registerStaffRoutes } from "./routes";
import { registerSecurityRoutes } from "./security-routes";
import { createStaffService } from "./service";
import type { StaffRole, StaffTokens } from "./tokens";
import { createWebAuthn, type WebAuthnConfig } from "./webauthn";

export { createStaffTokens } from "./tokens";
export type { StaffAction, StaffRole };
export { APPROVAL_RULES, can, type ApprovalAction } from "./permissions";

/** `webauthn`: relying party id, name and the exact origins the admin console is served from (from APP_URL). */
export function createStaffModule(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; webauthn: WebAuthnConfig; now?: () => Date }) {
  const service = createStaffService(o);
  const webauthn = createWebAuthn({ db: o.db, config: o.webauthn, ...(o.now ? { now: o.now } : {}) });
  const requireStaff = createRequireStaff(o.tokens, service.isActive, service.hasStepUp);
  const module: AppModule = {
    name: "staff",
    register: (app) => {
      registerStaffRoutes(app, service, requireStaff);
      registerSecurityRoutes(app, { webauthn, tokens: o.tokens, service, requireStaff });
    },
  };
  return { module, requireStaff, createStaffAccount: service.createStaffAccount, bootstrapSuperAdmin: service.bootstrapSuperAdmin.bind(service), issueEnrolmentCode: service.issueEnrolmentCode };
}
export { audit as recordStaffAudit } from "./repository";
export type { StaffPrincipal } from "./tokens";
