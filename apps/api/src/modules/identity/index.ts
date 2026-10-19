import type { Db } from "@mushin/db";
import type { DeleteIdentity, VerifyEmail } from "../../auth/auth-admin";
import type { ResolveTenant } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { createPrivacyService } from "./privacy";
import { registerIdentityRoutes } from "./routes";
import { createTeamService } from "./team";
import { registerTeamRoutes } from "./team-routes";
import { createIdentityService, type StartTrial } from "./service";

export type { StartTrial };

/**
 * `appUrl` builds invitation links; `onWorkspaceErased` clears per-workspace caches (the billing access cache) after a
 * deletion; `deleteIdentity` removes a deleted account's Supabase Auth user (audit SEC-13).
 */
export function createIdentityModule(o: {
  db: Db;
  /** Starts the trial at first sign-in (TRIAL_ACTIVATION=automatic); null when trials need staff approval. */
  autoTrial: StartTrial | null;
  appUrl?: string;
  verifyEmail?: VerifyEmail | null;
  deleteIdentity?: DeleteIdentity | null;
  onIdentityDeleteFailed?: (userId: string) => void;
  onWorkspaceErased?: (workspaceId: string) => Promise<void>;
}): { resolveTenant: ResolveTenant; module: AppModule } {
  const service = createIdentityService(o.db, o.autoTrial);
  const team = createTeamService({ db: o.db, appUrl: o.appUrl ?? "http://localhost:5173", verifyEmail: o.verifyEmail ?? null });
  const privacy = createPrivacyService({
    db: o.db,
    deleteIdentity: o.deleteIdentity ?? null,
    ...(o.onIdentityDeleteFailed ? { onIdentityDeleteFailed: o.onIdentityDeleteFailed } : {}),
    ...(o.onWorkspaceErased ? { onWorkspaceErased: o.onWorkspaceErased } : {}),
  });
  return {
    resolveTenant: service.resolveTenant,
    module: {
      name: "identity",
      register: (app, guards) => {
        registerIdentityRoutes(app, guards, service, o.db);
        registerTeamRoutes(app, guards, team, privacy);
      },
    },
  };
}
