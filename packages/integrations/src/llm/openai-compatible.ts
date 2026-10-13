import { AppError, type LlmProviderConfig, type Logger, type ProviderCallSink } from "@mushin/core";
import type { z } from "zod";
import { instrumented } from "../instrumented";
import type { Llm, LlmRequest } from "./types";

type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatResult = { content: string; tokensIn: number; tokensOut: number };
type ChatResponse = { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

/** Keeps only the provider's error code and type: the body can echo the prompt or the model's output (user input). */
class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`LLM provider answered ${status}${errorLabel(body)}`);
    this.name = "HttpStatusError";
  }
}

function errorLabel(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; type?: unknown } }).error;
    const parts = [e?.code, e?.type].filter((v): v is string => typeof v === "string" && /^[\w.-]{1,64}$/.test(v));
    return parts.length ? ` (${parts.join(", ")})` : "";
  } catch {
    return "";
  }
}

const COOLDOWN_MS = 60_000;
/** A 429 anywhere in the error's cause chain. */
function rateLimited(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof HttpStatusError && e.status === 429) return true;
  return false;
}

class LlmOutputError extends Error {
  constructor(reason: string) {
    super(`LLM reply was not usable: ${reason}`);
    this.name = "LlmOutputError";
  }
}

function parseReply<T>(content: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: "the reply was not JSON" };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ").slice(0, 300) };
}

/**
 * Chat completions over the OpenAI-compatible API that Groq and Ollama Cloud both serve.
 * Providers are tried in order on provider failure (Groq first, SRS §3.3). An unusable reply gets one corrective
 * retry on the same provider and then fails: a different model would not fix a bad request.
 */
export class OpenAiCompatibleLlm implements Llm {
  constructor(
    private readonly o: {
      providers: LlmProviderConfig[];
      sink: ProviderCallSink;
      logger: Logger;
      fetch?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    },
  ) {}

  /** Provider name → time until which it is skipped after answering 429 (measured: every Groq call 429'd for hours). */
  private readonly coolingUntil = new Map<string, number>();

  async complete<T>(req: LlmRequest<T>): Promise<{ value: T; model: string }> {
    if (this.o.providers.length === 0) throw new AppError("PROVIDER_UNAVAILABLE", "AI features are not configured.");
    let last: unknown;
    const nowMs = (this.o.now ?? Date.now)();
    // A cooling provider is skipped while another is available; the last remaining provider is always tried.
    const usable = this.o.providers.filter((p) => (this.coolingUntil.get(p.name) ?? 0) <= nowMs);
    for (const p of usable.length > 0 ? usable : this.o.providers) {
      try {
        return { value: await this.withProvider(p, req), model: `${p.name}:${p.model}` };
      } catch (err) {
        if (err instanceof LlmOutputError) {
          throw new AppError("PROVIDER_UNAVAILABLE", "The AI could not produce a usable answer. Please try again.", undefined, { cause: err });
        }
        last = err;
        if (rateLimited(err)) this.coolingUntil.set(p.name, (this.o.now ?? Date.now)() + COOLDOWN_MS);
        this.o.logger.warn({ err, provider: p.name, feature: req.feature }, "LLM provider failed; trying the next one");
      }
    }
    throw new AppError("PROVIDER_UNAVAILABLE", "AI is unavailable right now. Please try again shortly.", undefined, { cause: last });
  }

  private async withProvider<T>(p: LlmProviderConfig, req: LlmRequest<T>): Promise<T> {
    const messages: Message[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.input },
    ];
    const first = await this.chat(p, req, messages);
    const parsed = parseReply(first, req.schema);
    if (parsed.ok) return parsed.value;
    const second = await this.chat(p, req, [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: `That reply was not valid (${parsed.error}). Reply again with only the JSON object.` },
    ]);
    const again = parseReply(second, req.schema);
    if (again.ok) return again.value;
    throw new LlmOutputError(again.error);
  }

  private async chat<T>(p: LlmProviderConfig, req: LlmRequest<T>, messages: Message[]): Promise<string> {
    const doFetch = this.o.fetch ?? fetch;
    const result = await instrumented<ChatResult>(
      {
        provider: p.name,
        operation: req.feature,
        timeoutMs: req.timeoutMs ?? 30_000,
        retries: 1,
        sink: this.o.sink,
        logger: this.o.logger,
        ctx: req.ctx,
        ...(this.o.sleep ? { sleep: this.o.sleep } : {}),
        usage: (r) => ({
          model: p.model,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costUsd: (r.tokensIn * p.priceInPerMTok + r.tokensOut * p.priceOutPerMTok) / 1_000_000,
        }),
        // A 4xx other than 429 means our request is wrong; repeating it would not help.
        isRetryable: (err) => !(err instanceof HttpStatusError && err.status < 500 && err.status !== 429),
      },
      async (signal) => {
        const res = await doFetch(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: { authorization: `Bearer ${p.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: p.model,
            messages,
            response_format: { type: "json_object" },
            // Reasoning models spend tokens before answering; a small limit truncates the JSON.
            max_tokens: Math.max(req.maxTokens ?? 1024, 1024),
            temperature: 0.2,
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new HttpStatusError(res.status, text);
        const j = JSON.parse(text) as ChatResponse;
        return { content: j.choices?.[0]?.message?.content ?? "", tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
      },
    );
    return result.content;
  }
}
