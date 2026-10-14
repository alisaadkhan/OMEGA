import type { Db } from "@mushin/db";
import type { ResolveTenant } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { registerIdentityRoutes } from "./routes";
import { createIdentityService, type StartTrial } from "./service";

export type { StartTrial };

export function createIdentityModule(o: { db: Db; startTrial: StartTrial }): { resolveTenant: ResolveTenant; module: AppModule } {
  const service = createIdentityService(o.db, o.startTrial);
  return {
    resolveTenant: service.resolveTenant,
    module: { name: "identity", register: (app, guards) => registerIdentityRoutes(app, guards, service, o.db) },
  };
}
