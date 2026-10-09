import type { AppModule } from "../../http/types";
import type { RateLimiter } from "../../rate-limit/types";
import { registerDiscoveryRoutes } from "./routes";
import type { DiscoveryService } from "./service";

export { createDiscoveryService } from "./service";
export type { DiscoveryDeps, DiscoveryService } from "./service";
export { createDiscoveryRunner } from "./runner";
export type { DiscoveryRunner } from "./runner";

export function createDiscoveryModule(o: { service: DiscoveryService; limiter: RateLimiter }): AppModule {
  return { name: "discovery", register: (app, guards) => registerDiscoveryRoutes(app, guards, o.service, o.limiter) };
}
