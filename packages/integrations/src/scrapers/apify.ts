import { ProviderError } from "./types";

export type ApifyRun = {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number | null;
  chargedEventCounts?: Record<string, number> | null;
  pricingInfo?: {
    pricingModel?: string;
    pricingPerEvent?: { actorChargeEvents?: Record<string, ChargeEvent> };
  } | null;
};
type ChargeEvent = { eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd?: number }>; isPrimaryEvent?: boolean };

/** A flat event price, or for tiered pricing the highest tier's price (the account's tier is not in the run; never undercount). */
function eventPrice(e: ChargeEvent | undefined): number {
  if (!e) return 0;
  if (typeof e.eventPriceUsd === "number") return e.eventPriceUsd;
  return Math.max(0, ...Object.values(e.eventTieredPricingUsd ?? {}).map((t) => t.tieredEventPriceUsd ?? 0));
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/**
 * A pay-per-event run's price is its charged events × event prices. usageTotalUsd may still be 0 when the run is read,
 * or may already include those same event charges once settled (measured 2026-10-13), so the larger of the two is the
 * cost — never their sum. Free-tier runs report no charged events, so items × the primary event's price is recorded
 * instead; the spend cap must still count them.
 */
export function apifyRunCost(run: ApifyRun, items: number): number {
  const events = run.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  let charged = 0;
  for (const [name, count] of Object.entries(run.chargedEventCounts ?? {})) charged += eventPrice(events[name]) * count;
  let cost = Math.max(run.usageTotalUsd ?? 0, charged);
  if (cost === 0 && items > 0) {
    const primary = Object.values(events).find((e) => e.isPrimaryEvent);
    cost = eventPrice(primary) * items;
  }
  return Math.round(cost * 1_000_000) / 1_000_000;
}

type ClientOptions = { token: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number };

/** Apify error types that mean "this account has used its allowance", not "this token is wrong". */
const USAGE_LIMIT = /limit|usage|exceed|feature-disabled|insufficient|credit/i;
const isUsageLimit = (err: unknown) => (err as { code?: unknown } | null)?.code === "usage_limit";
const isNotFound = (err: unknown) => (err as { status?: unknown } | null)?.status === 404;

export function createApifyClient(o: ClientOptions) {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = "https://api.apify.com/v2";

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" } });
    } catch (err) {
      throw new ProviderError(true, "provider", `Apify is unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 || res.status === 403) {
      // Apify also answers 403 for a pinned build its publisher removed: say so, not "token" (found 2026-11-14).
      const type = await res.json().then((b: { error?: { type?: string } }) => b?.error?.type ?? null).catch(() => null);
      // Recorded as their own classes (observability review 2026-11-15): "build_not_found" raises its own alert, and a
      // refused token carries its status so the credentials alert fires (it counts http_401/http_403 only).
      if (type === "build-not-found") throw Object.assign(new ProviderError(false, "not_configured", "Apify: the pinned actor build no longer exists (re-pin APIFY_*_BUILD)"), { code: "build_not_found" });
      if (type && USAGE_LIMIT.test(type)) throw Object.assign(new ProviderError(false, "provider", `Apify account limit reached (${type})`), { status: res.status, code: "usage_limit" });
      throw Object.assign(new ProviderError(false, "not_configured", `Apify refused the token (HTTP ${res.status})`), { status: res.status });
    }
    if (res.status === 402) throw Object.assign(new ProviderError(false, "provider", "Apify account limit reached (HTTP 402)"), { status: 402, code: "usage_limit" });
    if (!res.ok) throw Object.assign(new ProviderError(res.status >= 500 || res.status === 429, "provider", `Apify answered HTTP ${res.status}`), { status: res.status });
    return (await res.json()) as T;
  }

  /** What a failed or stopped run was charged: its events, or its dataset items at the primary event price. */
  async function finalCost(run: ApifyRun): Promise<number> {
    const items = await call<{ data: { itemCount?: number } }>(`${base}/datasets/${run.defaultDatasetId}`)
      .then((r) => r.data.itemCount ?? 0)
      .catch(() => 0);
    return apifyRunCost(run, items);
  }

  /**
   * Starts an actor, waits for it (Apify waits at most 60 s per request), then reads its dataset. Audit SRCH-04:
   * `resumeRunId` polls an existing run instead of starting (and paying for) a new one; `onStarted` receives the new run
   * id before any waiting, so it can be stored; Apify itself stops the run at `timeoutSecs` and refuses charges beyond
   * `maxTotalChargeUsd` (pay-per-event actors), so an orphaned run cannot run or charge without bound.
   */
  async function runActor(
    actorId: string,
    input: unknown,
    opts: { maxWaitMs?: number; build?: string; resumeRunId?: string; onStarted?: (runId: string) => Promise<void>; timeoutSecs?: number; maxTotalChargeUsd?: number } = {},
  ): Promise<{ items: unknown[]; costUsd: number; runId: string }> {
    let run: ApifyRun;
    if (opts.resumeRunId) {
      run = (await call<{ data: ApifyRun }>(`${base}/actor-runs/${opts.resumeRunId}?waitForFinish=60`)).data;
    } else {
      const params = new URLSearchParams({ waitForFinish: "0" });
      if (opts.build) params.set("build", opts.build);
      if (opts.timeoutSecs) params.set("timeout", String(opts.timeoutSecs));
      if (opts.maxTotalChargeUsd !== undefined) params.set("maxTotalChargeUsd", String(opts.maxTotalChargeUsd));
      run = (await call<{ data: ApifyRun }>(`${base}/acts/${actorId.replace("/", "~")}/runs?${params.toString()}`, { method: "POST", body: JSON.stringify(input) })).data;
      // Stored before waiting: a crash from here on leaves a run the retry or the reconciler can find.
      await opts.onStarted?.(run.id);
    }
    const deadline = Date.now() + (opts.maxWaitMs ?? o.maxWaitMs ?? 180_000);
    while (!TERMINAL.has(run.status)) {
      if (Date.now() >= deadline) {
        // A run we stop waiting for keeps running (and charging) on Apify: stop it, then count what it cost.
        const stopped = await call<{ data: ApifyRun }>(`${base}/actor-runs/${run.id}/abort`, { method: "POST" })
          .then((r) => r.data)
          .catch(() => run);
        throw new ProviderError(true, "provider", `Apify run did not finish in time and was stopped (status ${run.status})`, await finalCost(stopped));
      }
      run = (await call<{ data: ApifyRun }>(`${base}/actor-runs/${run.id}?waitForFinish=60`)).data;
      if (!TERMINAL.has(run.status)) await sleep(1000);
    }
    if (run.status !== "SUCCEEDED") throw new ProviderError(true, "provider", `Apify run ended ${run.status}`, await finalCost(run));
    const items = await call<unknown[]>(`${base}/datasets/${run.defaultDatasetId}/items?clean=true`);
    return { items, costUsd: apifyRunCost(run, items.length), runId: run.id };
  }

  /** For the reconciler: a run's status and, once it has ended, what it cost; `abort` stops a run that is still going. */
  async function inspectRun(runId: string, opts: { abort?: boolean } = {}): Promise<{ status: string; terminal: boolean; costUsd: number | null }> {
    let run = (await call<{ data: ApifyRun }>(`${base}/actor-runs/${runId}`)).data;
    if (!TERMINAL.has(run.status) && opts.abort) run = (await call<{ data: ApifyRun }>(`${base}/actor-runs/${runId}/abort`, { method: "POST" })).data;
    const terminal = TERMINAL.has(run.status);
    return { status: run.status, terminal, costUsd: terminal ? await finalCost(run) : null };
  }

  return { runActor, inspectRun };
}

/**
 * Several Apify accounts (APIFY_TOKEN, APIFY_TOKEN_2, …; owner 2026-11-17): a new run starts on the current account and,
 * when Apify answers that the account's monthly allowance is used up, on the next one. A run belongs to the account that
 * started it, so its polling and results stay on that account; resuming or inspecting a stored run asks each account
 * until one knows it. Any other error is returned as before, without trying another account.
 */
export function createApifyPool(o: Omit<ClientOptions, "token"> & { tokens: string[] }) {
  const clients = o.tokens.map((token) => createApifyClient({ ...o, token }));
  if (clients.length === 0) throw new Error("createApifyPool needs at least one token");
  let current = 0;
  const firstThatKnows = async <T>(call: (c: ReturnType<typeof createApifyClient>) => Promise<T>): Promise<T> => {
    let last: unknown;
    for (const c of clients) {
      try {
        return await call(c);
      } catch (err) {
        if (!isNotFound(err)) throw err;
        last = err;
      }
    }
    throw last;
  };
  return {
    /** The account (1 = first token) runs start on now, for recording which key served a call (0105). */
    account: () => current + 1,
    async runActor(...args: Parameters<ReturnType<typeof createApifyClient>["runActor"]>) {
      const [, , opts] = args;
      if (opts?.resumeRunId) return firstThatKnows((c) => c.runActor(...args));
      for (;;) {
        const client = clients[current];
        if (!client) throw new ProviderError(false, "provider", "Every configured Apify account has used its monthly allowance");
        try {
          return await client.runActor(...args);
        } catch (err) {
          if (!isUsageLimit(err)) throw err;
          current += 1;
        }
      }
    },
    inspectRun: (runId: string, opts: { abort?: boolean } = {}) => firstThatKnows((c) => c.inspectRun(runId, opts)),
  };
}
