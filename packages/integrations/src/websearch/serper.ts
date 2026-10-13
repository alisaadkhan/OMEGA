import { z } from "zod";
import type { Logger, ProviderCallSink } from "@mushin/core";
import { instrumented } from "../instrumented";
import { ProviderError, type SpendGuard } from "../scrapers/types";
import type { WebResult, WebSearch } from "./types";

const SERPER_URL = "https://google.serper.dev/search";
/** Serper charges about $1 per 1,000 searches; each call is recorded at this price (spec §4.4). */
export const SERPER_COST_USD = 0.001;

const row = z.object({ title: z.string().catch(""), link: z.string().catch(""), snippet: z.string().catch("") });
const reply = z.object({ organic: z.array(z.unknown()).catch([]) });

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

export function createSerperSearch(o: { apiKey: string | null; limit: SpendGuard; sink: ProviderCallSink; logger: Logger; fetch?: typeof fetch }): WebSearch {
  const doFetch = o.fetch ?? fetch;
  return {
    async search(q) {
      const apiKey = o.apiKey;
      if (!apiKey) throw new ProviderError(false, "not_configured", "SERPER_API_KEY is not set");
      const done = await o.limit.begin();
      try {
        return await instrumented<WebResult[]>(
          {
            provider: "serper",
            operation: "web_search",
            timeoutMs: 15_000,
            retries: 1,
            sink: o.sink,
            logger: o.logger,
            ctx: q.ctx,
            usage: () => ({ units: 1, costUsd: SERPER_COST_USD }),
            isRetryable: (err) => providerErrorOf(err)?.retryable ?? true,
          },
          async (signal) => {
            const res = await doFetch(SERPER_URL, {
              method: "POST",
              headers: { "x-api-key": apiKey, "content-type": "application/json" },
              body: JSON.stringify({ q: q.query, gl: q.country, hl: q.hl ?? "en", num: q.num, ...(q.page === undefined ? {} : { page: q.page }), ...(q.autocorrect === undefined ? {} : { autocorrect: q.autocorrect }) }),
              signal,
            });
            if (res.status === 401 || res.status === 403) throw new ProviderError(false, "not_configured", `Serper refused the key (HTTP ${res.status})`);
            if (res.status === 400) {
              const text = await res.text();
              throw new ProviderError(false, /credit/i.test(text) ? "quota" : "provider", "Serper rejected the search (HTTP 400)");
            }
            if (!res.ok) throw new ProviderError(res.status >= 500 || res.status === 429, "provider", `Serper answered HTTP ${res.status}`);
            const body = reply.parse(await res.json());
            return body.organic
              .map((r) => row.safeParse(r))
              .filter((r) => r.success && r.data.link !== "")
              .map((r) => (r as { data: WebResult }).data)
              .slice(0, q.num)
              .map((r) => ({ title: r.title.slice(0, 300), link: r.link.slice(0, 500), snippet: r.snippet.slice(0, 500) }));
          },
        );
      } catch (err) {
        throw providerErrorOf(err) ?? new ProviderError(true, "provider", err instanceof Error ? err.message : String(err));
      } finally {
        done();
      }
    },
  };
}
