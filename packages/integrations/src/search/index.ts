import type { Logger, SearchConfig } from "@mushin/core";
import { MeilisearchIndex } from "./meilisearch";
import type { SearchIndex } from "./types";
import { UnavailableSearchIndex } from "./unavailable";

export * from "./types";
export { MeilisearchIndex } from "./meilisearch";
export { UnavailableSearchIndex } from "./unavailable";
export { testSearchIndex } from "./testing";

export function createSearchIndex(config: SearchConfig, logger: Logger): SearchIndex {
  if (!config) {
    logger.warn("MEILISEARCH_HOST is not set: search is unavailable (start the local Meilisearch, see README)");
    return new UnavailableSearchIndex();
  }
  return new MeilisearchIndex({ host: config.host, apiKey: config.apiKey, indexName: `${config.indexPrefix}creators` });
}
