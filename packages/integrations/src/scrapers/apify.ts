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
    if (res.status === 401 || res.status === 403) throw new ProviderError(false, "not_configured", `Apify refused the token (HTTP ${res.status})`);
    if (!res.ok) throw new ProviderError(res.status >= 500 || res.status === 429, "provider", `Apify answered HTTP ${res.status}`);
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
