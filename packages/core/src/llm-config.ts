import type { LlmValues } from "./config-schema";

export type LlmProviderConfig = {
  name: "gemini" | "groq" | "openrouter" | "yepapi";
  baseUrl: string;
  apiKey: string;
  model: string;
  priceInPerMTok: number;
  priceOutPerMTok: number;
  /** Which of the provider's keys (1, 2) when it has several: each key's models cool down on their own. */
  slot?: number;
  /** Requests per minute MUSHIN sends at most (Gemini free tier: 10, owner master directive §4.4); undefined = no limit. */
  requestsPerMinute?: number;
  /** The provider's minimum charge per successful call in USD (YepAPI: 0.01); spend is never booked below it. */
  minCostPerCallUsd?: number;
};

/**
 * The model chain (owner decision 2026-11-15): Groq gpt-oss-120b → gpt-oss-20b, then OpenRouter's models, each its own
 * entry so a rate limit or a daily cap on one moves to the next at once (cooldowns are per model). Ollama Cloud (it
 * answered 402, no credits) and Groq's llama-3.3-70b (removed by Groq) are no longer in the chain. Gemini is used only
 * on a paid key (the free tier answered 429 to every call, 2026-11-02 to 11-04) and comes last. LLM_PROVIDER moves that
 * provider's models to the front.
 */
const GROQ_PRICES: Record<string, [number, number]> = { "openai/gpt-oss-120b": [0.15, 0.6], "openai/gpt-oss-20b": [0.075, 0.3] };
const OPENROUTER_PRICES: Record<string, [number, number]> = {
  "openai/gpt-oss-120b": [0.15, 0.6],
  "openai/gpt-oss-20b": [0.03, 0.13],
  "meta-llama/llama-3.3-70b-instruct": [0.71, 0.71],
  "google/gemini-2.5-flash": [0.3, 2.5],
};
/** YepAPI's listed per-token rates (docs.yepapi.com/llms.txt, read 2026-11-17); a model not listed here is left out. */
const YEPAPI_PRICES: Record<string, [number, number]> = { "openai/gpt-oss-120b": [0.22, 0.89], "meta-llama/llama-4-scout": [0.15, 0.44], "google/gemini-2.5-flash": [0.44, 3.69] };

export function llmFrom(v: LlmValues): LlmProviderConfig[] {
  const out: LlmProviderConfig[] = [];
  // Key 1's 120b and 20b, then key 2's, key 3's… (a rate limit on one key moves to the next at once), then OpenRouter.
  const groqKeys = [...new Set([v.GROQ_API_KEY_1 ?? v.GROQ_API_KEY, v.GROQ_API_KEY_2, v.GROQ_API_KEY_3, v.GROQ_API_KEY_4, v.GROQ_API_KEY_5].filter((k): k is string => !!k))];
  if (groqKeys.length) {
    const preferred = v.LLM_PROVIDER === "groq";
    const baseUrl = (v.GROQ_BASE_URL ?? (preferred ? v.LLM_BASE_URL : undefined) ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    const primary = v.GROQ_MODEL ?? (preferred ? v.LLM_MODEL : undefined) ?? "openai/gpt-oss-120b";
    groqKeys.forEach((apiKey, i) => {
      for (const model of [...new Set([primary, "openai/gpt-oss-20b"])]) {
        const [pin, pout] = model === primary && (v.GROQ_PRICE_IN_PER_MTOK !== undefined || v.GROQ_PRICE_OUT_PER_MTOK !== undefined)
          ? [v.GROQ_PRICE_IN_PER_MTOK ?? GROQ_PRICES[model]?.[0] ?? 0.15, v.GROQ_PRICE_OUT_PER_MTOK ?? GROQ_PRICES[model]?.[1] ?? 0.6]
          : (GROQ_PRICES[model] ?? [0.15, 0.6]);
        out.push({ name: "groq", baseUrl, apiKey, model, priceInPerMTok: pin, priceOutPerMTok: pout, ...(groqKeys.length > 1 ? { slot: i + 1 } : {}) });
      }
    });
  }
  if (v.YEPAPI_API_KEY) {
    const baseUrl = v.YEPAPI_BASE_URL.replace(/\/+$/, "");
    for (const model of [...new Set(v.YEPAPI_MODELS.split(",").map((m) => m.trim()).filter(Boolean))]) {
      const listed = YEPAPI_PRICES[model];
      if (!listed) continue;
      out.push({ name: "yepapi", baseUrl, apiKey: v.YEPAPI_API_KEY, model, priceInPerMTok: listed[0], priceOutPerMTok: listed[1], minCostPerCallUsd: 0.01 });
    }
  }
  if (v.OPENROUTER_API_KEY) {
    const baseUrl = v.OPENROUTER_BASE_URL.replace(/\/+$/, "");
    const preferred = v.LLM_PROVIDER === "openrouter";
    const models = [...new Set([...(preferred && v.LLM_MODEL ? [v.LLM_MODEL] : []), ...v.OPENROUTER_MODELS.split(",").map((m) => m.trim()).filter(Boolean)])];
    for (const model of models) {
      const listed = OPENROUTER_PRICES[model];
      const [pin, pout] = [v.OPENROUTER_PRICE_IN_PER_MTOK ?? listed?.[0], v.OPENROUTER_PRICE_OUT_PER_MTOK ?? listed?.[1]];
      // Spend must never be booked as free: a model without a known price is left out rather than guessed.
      if (pin === undefined || pout === undefined) continue;
      out.push({ name: "openrouter", baseUrl, apiKey: v.OPENROUTER_API_KEY, model, priceInPerMTok: pin, priceOutPerMTok: pout });
    }
  }
  // checkShared guarantees the model and prices whenever the key is set; only a paid key is used.
  if (v.GEMINI_API_KEY && v.GEMINI_BILLING === "paid" && v.GEMINI_MODEL && v.GEMINI_PRICE_IN_PER_MTOK !== undefined && v.GEMINI_PRICE_OUT_PER_MTOK !== undefined) {
    out.push({
      name: "gemini",
      baseUrl: v.GEMINI_BASE_URL.replace(/\/+$/, ""),
      apiKey: v.GEMINI_API_KEY,
      model: v.GEMINI_MODEL,
      priceInPerMTok: v.GEMINI_PRICE_IN_PER_MTOK,
      priceOutPerMTok: v.GEMINI_PRICE_OUT_PER_MTOK,
      requestsPerMinute: v.GEMINI_RPM,
    });
  }
  // LLM_PROVIDER moves that provider's models to the front; the rest keep their order as fallbacks.
  return [...out.filter((p) => p.name === v.LLM_PROVIDER), ...out.filter((p) => p.name !== v.LLM_PROVIDER)];
}
