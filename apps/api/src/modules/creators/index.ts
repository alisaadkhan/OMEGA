import type { AppModule } from "../../http/types";
import type { PreHandler } from "../../http/types";
import type { RateLimiter } from "../../rate-limit/types";
import type { StaffAction } from "../staff/index";
import type { RemovalService } from "./erasure/service";
import { registerCreatorRoutes } from "./routes";
import type { CreatorsService } from "./service";

export { createCreatorsService } from "./service";
export type { CreatorsDeps, CreatorsService } from "./service";
export { createPostgresCatalogSearch } from "./postgres-search";
export { createCreatorIndexer } from "./indexer";
export type { CreatorIndexer } from "./indexer";
export { createSummaryWriter } from "./summaries";
export type { SummaryWriter } from "./summaries";
export { ineligibleCreatorIds, insertCreator, isVisibleCreator } from "./repository";
export { creatorEligibility, DEFAULT_ELIGIBILITY, ELIGIBILITY_VERSION, ineligibleError, MIN_FOLLOWERS, profileEligibility, type EligibilityProfile } from "./eligibility";
export type { NewCreator, NewProfile } from "./repository";

export function createCreatorsModule(o: { service: CreatorsService; limiter: RateLimiter; removals?: RemovalService; requireStaff?: (action: StaffAction) => PreHandler }): AppModule {
  const extra = o.removals && o.requireStaff ? { removals: o.removals, requireStaff: o.requireStaff } : undefined;
  return { name: "creators", register: (app, guards) => registerCreatorRoutes(app, guards, o.service, o.limiter, extra) };
}
export { createEnrichmentPipeline } from "./enrichment/pipeline";
export type { EnrichHooks, EnrichJob, EnrichmentPipeline, EnrichResult, SavedResult } from "./enrichment/pipeline";
export { findProfileByUrl, getEnrichmentSettings, profileTarget } from "./enrichment/repository";
export { normalizeProfileUrl, refreshActionFor } from "./rules";
export type { CreatorPlatform } from "./rules";
export { cleanText } from "./enrichment/standardize";
export { standardize } from "./enrichment/standardize";
export type { StandardPost, StandardProfile } from "./enrichment/standardize";
export { fenced, hasContactOrLink, redactContacts } from "./rules";
export { rankCards } from "./ranking";
export { expireYoutubeApiData } from "./retention";
export { DEFAULT_SOURCE_POLICY, type SourcePolicy } from "./source-policy";
export { fitLabel } from "./rules";
export { getSearchSettings } from "./repository";
export { suppress, suppressedUrls, urlHash } from "./suppressions";
export type { ProcessHooks } from "./enrichment/pipeline";
export { createRemovalService } from "./erasure/service";
export { createContactChecker, requestContactCheck, type ContactChecker } from "./contact-checks";
export { checkEmail, isUsableEmail, systemMailResolver, type MailResolver } from "./email-check";
export type { RemovalActor, RemovalService } from "./erasure/service";
export { createEraser } from "./erasure/eraser";
export type { Eraser } from "./erasure/eraser";
export { CITY_CONCEPTS, NICHE_CONCEPTS, LIVE_PLACE_URDU, LIVE_TOPIC_TERMS, cityForms, expandQuery, normalizeQuery, type AliasConcept, type QueryGroup } from "./aliases";
export { understandQuery, type Understood } from "./understand";
export { profileMetrics } from "./enrichment/signals";
