import type { AppModule } from "../../http/types";
import { registerCampaignRoutes } from "./routes";
import type { CampaignsService } from "./service";

export { createCampaignsService } from "./service";
export type { CampaignsDeps, CampaignsService } from "./service";

export function createCampaignsModule(o: { service: CampaignsService }): AppModule {
  return { name: "campaigns", register: (app, guards) => registerCampaignRoutes(app, guards, o.service) };
}
