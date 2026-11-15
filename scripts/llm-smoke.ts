/**
 * Manual smoke test of every model in the AI chain (Groq keys 1–5 with gpt-oss-120b and 20b, then OpenRouter, then Gemini
 * on a paid key; packages/core/src/config.ts). It makes ONE real request per chain entry with a tiny prompt that contains
 * no creator data, and checks that each reply is JSON that matches a schema.
 *
 *   node --env-file=.env --import tsx scripts/llm-smoke.ts --confirm
 * Needs at least one of GROQ_API_KEY_1…5, OPENROUTER_API_KEY, or a paid Gemini key with its model and prices. Only provider
 * names, key numbers, models, status and token counts are printed, never a key.
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
  console.error("No LLM provider is configured (GROQ_API_KEY_1…5, OPENROUTER_API_KEY, or GEMINI_API_KEY with its model, prices and GEMINI_BILLING=paid).");
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
    console.log(JSON.stringify({ provider: p.name, key: p.slot ?? 1, model, valid: true, value, tokensIn: call?.tokensIn, tokensOut: call?.tokensOut, costUsd: call?.costUsd }));
  } catch (err) {
    failed++;
    console.log(JSON.stringify({ provider: p.name, model: p.model, valid: false, error: err instanceof Error ? err.message : String(err), attempts: sink.calls.map((c) => c.status) }));
  }
}
process.exit(failed ? 1 : 0);
