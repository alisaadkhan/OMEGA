import { AppError } from "@mushin/core";
import type { SearchIndex } from "./types";

/** Used when Meilisearch is not configured (development without it): search fails cleanly, nothing else breaks. */
export class UnavailableSearchIndex implements SearchIndex {
  private fail(): never {
    throw new AppError("PROVIDER_UNAVAILABLE", "Search is temporarily unavailable. Please try again shortly.");
  }
  async ensureSettings(): Promise<void> {}
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
  async search(): Promise<never> {
    this.fail();
  }
  async listIds(): Promise<Map<string, number>> {
    return new Map();
  }
  async ping(): Promise<"ok"> {
    this.fail();
  }
  async drop(): Promise<void> {}
}
