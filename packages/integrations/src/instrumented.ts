import { AppError, type Logger, type ProviderCall, type ProviderCallSink } from "@mushin/core";

export type CallContext = { workspaceId?: string | null; jobId?: string | null; requestId?: string | null };
export type Usage = { model?: string | null; tokensIn?: number | null; tokensOut?: number | null; units?: number | null; costUsd: number };

export type InstrumentOptions<T> = {
  provider: string;
  operation: string;
  timeoutMs: number;
  retries: number;
  sink: ProviderCallSink;
  logger: Logger;
  ctx?: CallContext;
  usage?: (result: T) => Usage;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

export class ProviderTimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} did not respond within ${ms} ms`);
    this.name = "ProviderTimeoutError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Settles with `work`, or rejects with the abort reason as soon as `signal` fires, even if `work` ignores the signal. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function instrumented<T>(opts: InstrumentOptions<T>, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ProviderTimeoutError(opts.provider, opts.timeoutMs)), opts.timeoutMs);
    const started = performance.now();
    let result: T;
    try {
      result = await untilAborted(fn(controller.signal), controller.signal);
    } catch (err) {
      lastError = err;
      const timedOut = err instanceof ProviderTimeoutError || controller.signal.reason instanceof ProviderTimeoutError;
      await record(opts, {
        model: null,
        tokensIn: null,
        tokensOut: null,
        units: null,
        costUsd: 0,
        latencyMs: Math.round(performance.now() - started),
        status: "error",
        errorCode: timedOut ? "timeout" : errorCodeOf(err),
      });
      opts.logger.warn({ err, provider: opts.provider, operation: opts.operation, attempt }, "provider call failed");
      if (attempt === opts.retries || !(timedOut || isRetryable(err))) break;
      await sleep(200 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    // The provider call succeeded (and may have been billed): nothing below may trigger a retry.
    const latencyMs = Math.round(performance.now() - started);
    const u = usageOf(opts, result);
    await record(opts, {
      model: u?.model ?? null,
      tokensIn: u?.tokensIn ?? null,
      tokensOut: u?.tokensOut ?? null,
      units: u?.units ?? null,
      costUsd: u?.costUsd ?? 0,
      latencyMs,
      status: "ok",
      errorCode: null,
    });
    return result;
  }

  throw new AppError("PROVIDER_UNAVAILABLE", `${opts.provider} is unavailable right now. Please try again shortly.`, undefined, {
    cause: lastError,
  });
}

/**
 * A fixed, non-sensitive failure class: `http_<status>` when the provider answered, the adapter's reason otherwise.
 * Messages are never recorded (they can echo prompts or provider output). A generic "error" for every failure hid
 * whether 12 live-run Groq failures were rate limits or bad requests (2026-10-13).
 */
export function errorCodeOf(err: unknown): string {
  if (typeof err !== "object" || err === null) return "error";
  const { status, reason } = err as { status?: unknown; reason?: unknown };
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) return `http_${status}`;
  if (typeof reason === "string" && /^[a-z_]{1,32}$/.test(reason)) return reason;
  return "error";
}

function usageOf<T>(opts: InstrumentOptions<T>, result: T): Usage | undefined {
  try {
    return opts.usage?.(result);
  } catch (err) {
    opts.logger.error({ err, provider: opts.provider, operation: opts.operation }, "failed to read provider usage; recording zero cost");
    return undefined;
  }
}

async function record<T>(
  opts: InstrumentOptions<T>,
  part: Omit<ProviderCall, "provider" | "operation" | "workspaceId" | "jobId" | "requestId">,
) {
  try {
    await opts.sink.record({
      provider: opts.provider,
      operation: opts.operation,
      workspaceId: opts.ctx?.workspaceId ?? null,
      jobId: opts.ctx?.jobId ?? null,
      requestId: opts.ctx?.requestId ?? null,
      ...part,
    });
  } catch (err) {
    opts.logger.error({ err, provider: opts.provider }, "failed to record provider call");
  }
}
