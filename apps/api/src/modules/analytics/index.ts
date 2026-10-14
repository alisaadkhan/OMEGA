import { analyticsQuerySchema, analyticsSummarySchema } from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { AnalyticsService } from "./service";

export { createAnalyticsService } from "./service";
export type { AnalyticsService } from "./service";

export function createAnalyticsModule(o: { service: AnalyticsService }): AppModule {
  return {
    name: "analytics",
    register: (app, guards) => {
      app.get("/v1/analytics/summary", { preHandler: guards.customer }, async (req, reply) =>
        sendOk(reply, analyticsSummarySchema, await o.service.summary(tenantOf(req), parseInput(analyticsQuerySchema, req.query))),
      );
    },
  };
}
