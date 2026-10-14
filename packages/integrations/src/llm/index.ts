import type { LlmProviderConfig, Logger, ProviderCallSink } from "@mushin/core";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import type { Llm } from "./types";
import { withLlmBudget } from "./budget";

export * from "./types";
export { OpenAiCompatibleLlm } from "./openai-compatible";
export { MockLlm } from "./mock";

export { withLlmBudget } from "./budget";

/**
 * The monthly budget is required: leaving it out cannot silently disable the cap. Only supervised live tests, which bound
 * their own calls, pass `budget: null` explicitly.
 */
export function createLlm(
  providers: LlmProviderConfig[],
  o: { sink: ProviderCallSink; logger: Logger; budget: { budgetUsd: number; spentSince: (since: Date) => Promise<number> } | null },
): Llm {
  if (providers.length === 0) o.logger.warn("GROQ_API_KEY and OLLAMA_API_KEY are not set: AI features answer 'unavailable'");
  else o.logger.info({ providers: providers.map((p) => `${p.name}:${p.model}`) }, "LLM providers");
  const llm = new OpenAiCompatibleLlm({ providers, sink: o.sink, logger: o.logger });
  return o.budget ? withLlmBudget(llm, { ...o.budget, logger: o.logger }) : llm;
}
