import type { LlmProviderConfig, Logger, ProviderCallSink } from "@mushin/core";
import { OpenAiCompatibleLlm } from "./openai-compatible";
import type { Llm } from "./types";

export * from "./types";
export { OpenAiCompatibleLlm } from "./openai-compatible";
export { MockLlm } from "./mock";

export function createLlm(providers: LlmProviderConfig[], o: { sink: ProviderCallSink; logger: Logger }): Llm {
  if (providers.length === 0) o.logger.warn("GROQ_API_KEY and OLLAMA_API_KEY are not set: AI features answer 'unavailable'");
  else o.logger.info({ providers: providers.map((p) => `${p.name}:${p.model}`) }, "LLM providers");
  return new OpenAiCompatibleLlm({ providers, sink: o.sink, logger: o.logger });
}
