/**
 * Manual smoke test of the hosted LLM providers (Gemini main, Ollama fallback). It makes ONE real, paid request per
 * provider with a tiny prompt that contains no creator data, and checks that each reply is JSON that matches a schema
 * (Gemini's structured-output behaviour through its OpenAI-compatible endpoint is confirmed only by this run).
 *
 *   node --env-file=.env --import tsx scripts/llm-smoke.ts --confirm
 * Needs GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PRICE_IN_PER_MTOK, GEMINI_PRICE_OUT_PER_MTOK and GEMINI_BILLING=paid (and
 * OLLAMA_API_KEY to test the fallback). Only provider names, models, status and token counts are printed, never a key.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { createLogger, loadLlmConfig, type LlmProviderConfig } from "@mushin/core";
import { MemoryProviderCallSink, OpenAiCompatibleLlm } from "@mushin/integrations";

const { values } = parseArgs({ options: { confirm: { type: "boolean", default: false } } });
if (!values.confirm) {
  console.error("This makes real, paid requests to each configured LLM provider. Re-run with --confirm to proceed.");
  process.exit(2);
}
const providers = loadLlmConfig(process.env);
if (providers.length === 0) {
  console.error("No LLM provider is configured (GEMINI_API_KEY with its model, prices and GEMINI_BILLING=paid; or OLLAMA_API_KEY).");
  process.exit(1);
}
const schema = z.object({ ok: z.literal(true), colour: z.enum(["red", "green", "blue"]) });
let failed = 0;
for (const p of providers) {
  const sink = new MemoryProviderCallSink();
  const llm = new OpenAiCompatibleLlm({ providers: [p] as LlmProviderConfig[], sink, logger: createLogger({ level: "silent" }) });
  try {
    const { value, model } = await llm.complete({
      feature: "search_interpret",
      system: 'Reply with one JSON object: {"ok": true, "colour": "<red, green or blue>"}.',
      input: "Pick the colour of a clear daytime sky.",
      schema,
      maxTokens: 1024,
      timeoutMs: 30_000,
    });
    const call = sink.calls.at(-1);
    console.log(JSON.stringify({ provider: p.name, model, valid: true, value, tokensIn: call?.tokensIn, tokensOut: call?.tokensOut, costUsd: call?.costUsd }));
  } catch (err) {
    failed++;
    console.log(JSON.stringify({ provider: p.name, model: p.model, valid: false, error: err instanceof Error ? err.message : String(err), attempts: sink.calls.map((c) => c.status) }));
  }
}
process.exit(failed ? 1 : 0);
