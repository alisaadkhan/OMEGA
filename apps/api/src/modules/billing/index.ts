import { isMockPayments, type Payments } from "@mushin/integrations";
import type { AppModule } from "../../http/types";
import { registerMockPaddleRoutes } from "./mock-routes";
import { registerBillingRoutes } from "./routes";
import type { BillingService } from "./service";

export { createCreditEngine } from "./engine";
export type { Actor, Balance, CreditEngine, GrantRequest, HoldRequest, SpendRequest } from "./engine";
export { createBillingService } from "./service";
export type { BillingDeps, BillingService, Customer } from "./service";
export { MemoryAccessCache, noAccessCache } from "./access-cache";
export type { Access, AccessCache } from "./access-cache";
export type { BillingJob } from "./repository";

/** `paymentsOpen` false: no checkout, no plan changes and no mock checkout pages (public deployment without Paddle). */
export function createBillingModule(o: { service: BillingService; payments: Payments; appUrl: string; paymentsOpen?: boolean }): AppModule {
  return {
    name: "billing",
    register(app, guards) {
      const open = o.paymentsOpen ?? true;
      registerBillingRoutes(app, guards, o.service, o.payments, open);
      if (open && isMockPayments(o.payments)) registerMockPaddleRoutes(app, o.service, o.appUrl);
    },
  };
}
