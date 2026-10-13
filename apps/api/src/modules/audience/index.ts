import type { AppModule } from "../../http/types";
import type { RateLimiter } from "../../rate-limit/types";
import { registerAudienceRoutes } from "./routes";
import type { AudienceService } from "./service";

export { createAudienceService } from "./service";
export type { AudienceDeps, AudienceService } from "./service";
export { createAudienceRunner } from "./runner";
export type { AudienceRunner } from "./runner";
export { buildEstimate, countryDimension, METHOD, selectCommenters } from "./method";

export function createAudienceModule(o: { service: AudienceService; limiter: RateLimiter }): AppModule {
  return { name: "audience", register: (app, guards) => registerAudienceRoutes(app, guards, o.service, o.limiter) };
}
