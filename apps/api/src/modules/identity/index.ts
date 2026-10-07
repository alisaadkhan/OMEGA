import type { Db } from "@mushin/db";
import type { ResolveTenant } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { registerIdentityRoutes } from "./routes";
import { createIdentityService } from "./service";

export function createIdentityModule(o: { db: Db }): { resolveTenant: ResolveTenant; module: AppModule } {
  const service = createIdentityService(o.db);
  return {
    resolveTenant: service.resolveTenant,
    module: { name: "identity", register: (app, guards) => registerIdentityRoutes(app, guards, service) },
  };
}
