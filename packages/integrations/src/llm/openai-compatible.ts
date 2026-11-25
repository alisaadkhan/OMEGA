import { AppError, type LlmProviderConfig, type Logger, type ProviderCallSink } from "@mushin/core";
import type { z } from "zod";
import { instrumented } from "../instrumented";
import type { Llm, LlmRequest } from "./types";

type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatResult = { content: string; tokensIn: number; tokensOut: number };
type ChatResponse = { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

/** Keeps only the provider's error code and type: the body can echo the prompt or the model's output (user input). */
class HttpStatusError extends Error {
  /** The provider's error code (e.g. model_not_found), when it gave one. */
  readonly code: string | null;
  constructor(
    readonly status: number,
    body: string,
    /** Seconds until the provider accepts requests again (Retry-After or Groq's x-ratelimit-reset-* headers). */
    readonly retryAfterS: number | null = null,
  ) {
    super(`LLM provider answered ${status}${errorLabel(body)}`);
    this.name = "HttpStatusError";
    this.code = errorCode(body);
  }
}

function errorCode(body: string): string | null {
  try {
    const c = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof c === "string" && /^[\w.-]{1,64}$/.test(c) ? c : null;
  } catch {
    return null;
  }
}

/** Groq's reset headers: "7.66s", "2m59.56s", "120ms". */
export function resetSeconds(v: string | null): number | null {
  if (!v) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(v.trim());
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 1000;
}

/** A model that no longer exists for this key: skipped for the rest of the process. */
const isGoneModel = (err: unknown): boolean => {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e instanceof HttpStatusError && (e.status === 404 || e.code === "model_not_found" || e.code === "model_decommissioned")) return true;
  }
  return false;
};

function errorLabel(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; type?: unknown } }).error;
    const parts = [e?.code, e?.type].filter((v): v is string => typeof v === "string" && /^[\w.-]{1,64}$/.test(v));
    return parts.length ? ` (${parts.join(", ")})` : "";
  } catch {
    return "";
  }
}

/** A 429 without a reset header pauses that model 15 s at first (Groq token buckets refill in seconds), doubling on repeats. */
const COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 15 * 60_000;
/**
 * A 429 (rate limit) or 503 (overloaded) anywhere in the error's cause chain, with the provider's Retry-After when given.
 * Measured 2026-11-02 on the Gemini free tier: bulk catalogue runs answered 429 and 503 for long stretches.
 */
function throttled(err: unknown): { retryAfterS: number | null } | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof HttpStatusError && (e.status === 429 || e.status === 503)) return { retryAfterS: e.retryAfterS };
  return null;
}
function retryAfterSeconds(h: string | null, nowMs: number): number | null {
  if (!h) return null;
  if (/^\d{1,6}$/.test(h.trim())) return Number(h.trim());
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - nowMs) / 1000)) : null;
}

/** Cooldowns, slots and removed models are per key and model: "groq#2:openai/gpt-oss-120b" is not paused by key 1's 429. */
const key = (p: LlmProviderConfig) => `${p.name}${p.slot ? `#${p.slot}` : ""}:${p.model}`;

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
 * Chat completions over the OpenAI-compatible API that Gemini and Ollama Cloud both serve.
 * Providers are tried in order on provider failure (Gemini first, then Ollama). An unusable reply gets one corrective
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

  /**
   * Keyed by provider and model ("groq:openai/gpt-oss-120b"): a rate limit on one model pauses only that model, and the
   * next model of the chain (another Groq model, then Ollama Cloud) answers at once (owner unified plan 2026-11-14).
   */
  private readonly coolingUntil = new Map<string, number>();
  /** Model → consecutive throttled answers; each one doubles the pause, a success resets it. */
  private readonly strikes = new Map<string, number>();
  /** Model → start times of its requests in the last minute (token bucket for requestsPerMinute). */
  private readonly recent = new Map<string, number[]>();
  /** Models that answered 404 / model_not_found / model_decommissioned: skipped for the rest of the process. */
  private readonly gone = new Set<string>();

  /** Whether the provider is under its per-minute limit now; records the request when it is. */
  private takeSlot(p: LlmProviderConfig, nowMs: number): boolean {
    if (!p.requestsPerMinute) return true;
    const window = (this.recent.get(key(p)) ?? []).filter((t) => nowMs - t < 60_000);
    if (window.length >= p.requestsPerMinute) {
      this.recent.set(key(p), window);
      return false;
    }
    window.push(nowMs);
    this.recent.set(key(p), window);
    return true;
  }

  /** Milliseconds until the provider has a free slot again (0 when it has one). */
  private slotWaitMs(p: LlmProviderConfig, nowMs: number): number {
    if (!p.requestsPerMinute) return 0;
    const window = (this.recent.get(key(p)) ?? []).filter((t) => nowMs - t < 60_000);
    return window.length < p.requestsPerMinute ? 0 : 60_000 - (nowMs - (window[0] as number));
  }

  async complete<T>(req: LlmRequest<T>): Promise<{ value: T; model: string }> {
    if (this.o.providers.length === 0) throw new AppError("PROVIDER_UNAVAILABLE", "AI features are not configured.");
    let last: unknown;
    const nowMs = (this.o.now ?? Date.now)();
    // A cooling provider, or one at its per-minute limit, is skipped while another is available; when none is, the
    // request waits for the first free per-minute slot rather than sending a call that would be refused.
    const alive = this.o.providers.filter((p) => !this.gone.has(key(p)));
    if (alive.length === 0) throw new AppError("PROVIDER_UNAVAILABLE", "AI is unavailable right now. Please try again shortly.");
    const ready = (p: LlmProviderConfig) => (this.coolingUntil.get(key(p)) ?? 0) <= nowMs && this.slotWaitMs(p, nowMs) === 0;
    let usable = alive.filter(ready);
    if (usable.length === 0) {
      const waits = alive.filter((p) => (this.coolingUntil.get(key(p)) ?? 0) <= nowMs).map((p) => ({ p, ms: this.slotWaitMs(p, nowMs) }));
      const soonest = waits.sort((a, b) => a.ms - b.ms)[0];
      if (soonest && soonest.ms > 0 && soonest.ms <= 60_000) {
        await (this.o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(soonest.ms);
        usable = [soonest.p];
      } else usable = alive;
    }
    for (const p of usable) {
      if (!this.takeSlot(p, (this.o.now ?? Date.now)()) && usable.length > 1) continue;
      try {
        const value = await this.withProvider(p, req, usable.length === 1);
        this.strikes.delete(key(p));
        return { value, model: `${p.name}:${p.model}` };
      } catch (err) {
        if (err instanceof LlmOutputError) {
          throw new AppError("PROVIDER_UNAVAILABLE", "The AI could not produce a usable answer. Please try again.", undefined, { cause: err });
        }
        last = err;
        if (isGoneModel(err)) this.gone.add(key(p));
        const t = throttled(err);
        if (t) {
          const n = (this.strikes.get(key(p)) ?? 0) + 1;
          this.strikes.set(key(p), n);
          // The provider's own reset time when it sent one; otherwise 15 s, doubling on repeats.
          const pause = t.retryAfterS !== null ? Math.min(t.retryAfterS * 1000, MAX_COOLDOWN_MS) : Math.min(COOLDOWN_MS * 2 ** (n - 1), MAX_COOLDOWN_MS);
          this.coolingUntil.set(key(p), (this.o.now ?? Date.now)() + pause);
        }
        this.o.logger.warn({ err, provider: p.name, slot: p.slot ?? null, model: p.model, feature: req.feature }, "LLM model failed; trying the next one");
      }
    }
    throw new AppError("PROVIDER_UNAVAILABLE", "AI is unavailable right now. Please try again shortly.", undefined, { cause: last });
  }

  private async withProvider<T>(p: LlmProviderConfig, req: LlmRequest<T>, solo: boolean): Promise<T> {
    const messages: Message[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.input },
    ];
    const first = await this.chat(p, req, messages, solo);
    const parsed = parseReply(first, req.schema);
    if (parsed.ok) return parsed.value;
    const second = await this.chat(
      p,
      req,
      [...messages, { role: "assistant", content: first }, { role: "user", content: `That reply was not valid (${parsed.error}). Reply again with only the JSON object.` }],
      solo,
    );
    const again = parseReply(second, req.schema);
    if (again.ok) return again.value;
    // Both HTTP calls were answered (and recorded as "ok"); the outcome was not usable. Recorded as its own failure so
    // the hourly error-share alert and the provider table see it (observability review 2026-11-15: ~190 unusable
    // replies in October were invisible there). The validation message is never recorded: it can quote the reply.
    await this.o.sink
      .record({
        provider: p.name, operation: req.feature, model: p.model, tokensIn: null, tokensOut: null, units: null, latencyMs: 0, status: "error",
        costUsd: 0, errorCode: "invalid_reply", workspaceId: req.ctx?.workspaceId ?? null, jobId: req.ctx?.jobId ?? null, requestId: req.ctx?.requestId ?? null,
        keySlot: p.slot ?? null,
      })
      .catch((err: unknown) => this.o.logger.error({ err, provider: p.name }, "failed to record provider call"));
    this.o.logger.warn({ event: "llm_reply_unusable", provider: p.name, model: p.model, feature: req.feature, jobId: req.ctx?.jobId ?? null, requestId: req.ctx?.requestId ?? null }, "LLM reply unusable after one correction");
    throw new LlmOutputError(again.error);
  }

  private async chat<T>(p: LlmProviderConfig, req: LlmRequest<T>, messages: Message[], solo: boolean): Promise<string> {
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
        keySlot: p.slot ?? null,
        ...(this.o.sleep ? { sleep: this.o.sleep } : {}),
        usage: (r) => ({
          model: p.model,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costUsd: Math.max(p.minCostPerCallUsd ?? 0, (r.tokensIn * p.priceInPerMTok + r.tokensOut * p.priceOutPerMTok) / 1_000_000),
        }),
        // A 4xx other than 429 means our request is wrong; repeating it would not help. A 429 is retried on the same
        // model only when no other model can answer: otherwise the next one in the chain answers at once.
        isRetryable: (err) => !(err instanceof HttpStatusError && err.status < 500 && (err.status !== 429 || !solo)),
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
        if (!res.ok) {
          const waits = [retryAfterSeconds(res.headers.get("retry-after"), Date.now()), resetSeconds(res.headers.get("x-ratelimit-reset-tokens")), res.status === 429 ? resetSeconds(res.headers.get("x-ratelimit-reset-requests")) : null].filter((w): w is number => w !== null);
          throw new HttpStatusError(res.status, text, waits.length ? Math.ceil(Math.max(...waits)) : null);
        }
        const j = JSON.parse(text) as ChatResponse;
        return { content: j.choices?.[0]?.message?.content ?? "", tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
      },
    );
    return result.content;
  }
}
