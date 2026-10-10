import type { AppModule } from "../../http/types";
import type { RateLimiter } from "../../rate-limit/types";
import { registerCreatorRoutes } from "./routes";
import type { CreatorsService } from "./service";

export { createCreatorsService } from "./service";
export type { CreatorsDeps, CreatorsService } from "./service";
export { createCreatorIndexer } from "./indexer";
export type { CreatorIndexer } from "./indexer";
export { createSummaryWriter } from "./summaries";
export type { SummaryWriter } from "./summaries";
export { insertCreator, isVisibleCreator } from "./repository";
export type { NewCreator } from "./repository";

export function createCreatorsModule(o: { service: CreatorsService; limiter: RateLimiter }): AppModule {
  return { name: "creators", register: (app, guards) => registerCreatorRoutes(app, guards, o.service, o.limiter) };
}
export { createEnrichmentPipeline } from "./enrichment/pipeline";
export type { EnrichHooks, EnrichJob, EnrichmentPipeline, EnrichResult, SavedResult } from "./enrichment/pipeline";
export { findProfileByUrl, getEnrichmentSettings, profileTarget } from "./enrichment/repository";
export { normalizeProfileUrl, refreshActionFor } from "./rules";
export type { CreatorPlatform } from "./rules";
export { cleanText } from "./enrichment/standardize";
export { fenced, hasContactOrLink, redactContacts } from "./rules";
export { rankCards } from "./ranking";
export { suppress, suppressedUrls, urlHash } from "./suppressions";
export type { ProcessHooks } from "./enrichment/pipeline";
