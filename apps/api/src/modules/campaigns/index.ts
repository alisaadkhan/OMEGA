import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import { registerInboxRoute } from "./inbox";
import { registerCampaignRoutes } from "./routes";
import type { CampaignsService } from "./service";

export { createCampaignsService } from "./service";
export type { CampaignsDeps, CampaignsService } from "./service";

/** `db` adds the Inbox (GET /v1/outreach/inbox). */
export function createCampaignsModule(o: { service: CampaignsService; db?: Db }): AppModule {
  return {
    name: "campaigns",
    register: (app, guards) => {
      registerCampaignRoutes(app, guards, o.service);
      if (o.db) registerInboxRoute(app, guards, o.db);
    },
  };
}
