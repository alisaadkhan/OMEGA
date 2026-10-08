import { isMockPayments, type Payments } from "@mushin/integrations";
import type { AppModule } from "../../http/types";
import { registerMockPaddleRoutes } from "./mock-routes";
import { registerBillingRoutes } from "./routes";
import type { BillingService } from "./service";

export { createCreditEngine } from "./engine";
export type { Actor, Balance, CreditEngine, GrantRequest, SpendRequest } from "./engine";
export { createBillingService } from "./service";
export type { BillingDeps, BillingService, Customer } from "./service";
export { createRedisAccessCache, MemoryAccessCache, noAccessCache } from "./access-cache";
export type { Access, AccessCache, RedisLike } from "./access-cache";
export type { BillingJob } from "./repository";

export function createBillingModule(o: { service: BillingService; payments: Payments; appUrl: string }): AppModule {
  return {
    name: "billing",
    register(app, guards) {
      registerBillingRoutes(app, guards, o.service, o.payments);
      if (isMockPayments(o.payments)) registerMockPaddleRoutes(app, o.service, o.appUrl);
    },
  };
}
