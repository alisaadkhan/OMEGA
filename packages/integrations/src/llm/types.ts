import type { z } from "zod";
import type { CallContext } from "../instrumented";

export type LlmFeature = "search_interpret" | "creator_summary" | "creator_assessment" | "discovery_relevance" | "niche_classification";

export type LlmRequest<T> = {
  /** Recorded as the provider call's `operation`, so costs break down per feature (SRS REQ-03.05, §4.3.2). */
  feature: LlmFeature;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  timeoutMs?: number;
  ctx?: CallContext;
};

export interface Llm {
  complete<T>(req: LlmRequest<T>): Promise<{ value: T; model: string }>;
}
