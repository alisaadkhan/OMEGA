import { sql } from "drizzle-orm";
import type { WorkerConfig } from "@mushin/core";
import { providerCallsSince, type Db } from "@mushin/db";

/**
 * Hourly provider status for operations (migration 0055). Records what is configured (never a key) and a usage/limit
 * pair only when it is really known: Apify reports its account usage and limit (GET /v2/users/me/limits, an account
 * read that does not use credits); Serper usage is counted against Roster's own monthly search limit, because Serper's
 * remaining balance is not read. Gemini, Ollama and YouTube expose no quota to Roster, so none is shown for them.
 */
type Row = {
  provider: string;
  configured: boolean;
  detail: Record<string, string | number | boolean>;
  quota: { used: number; limit: number; unit: "usd" | "searches"; source: string } | null;
  checkError: string | null;
};

const APIFY_LIMITS = "https://api.apify.com/v2/users/me/limits";

async function apifyQuota(token: string, doFetch: typeof fetch): Promise<Pick<Row, "quota" | "checkError">> {
  let res: Response;
  try {
    res = await doFetch(APIFY_LIMITS, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return { quota: null, checkError: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) return { quota: null, checkError: `http_${res.status}` };
  if (!res.ok) return { quota: null, checkError: `http_${res.status}` };
  const body = (await res.json().catch(() => null)) as { data?: { limits?: { maxMonthlyUsageUsd?: unknown }; current?: { monthlyUsageUsd?: unknown } } } | null;
  const limit = body?.data?.limits?.maxMonthlyUsageUsd;
  const used = body?.data?.current?.monthlyUsageUsd;
  if (typeof limit !== "number" || typeof used !== "number" || !Number.isFinite(limit) || !Number.isFinite(used) || limit < 0 || used < 0) {
    return { quota: null, checkError: "unexpected_response" };
  }
  return { quota: { used, limit, unit: "usd", source: "Apify account limits (provider-reported)" }, checkError: null };
}

export async function checkProviderStatus(o: { db: Db; config: Pick<WorkerConfig, "llm" | "scraping">; fetch?: typeof fetch; now?: () => Date }): Promise<Row[]> {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? (() => new Date());
  const monthStart = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1));
  const llm = (name: "gemini" | "ollama"): Row => {
    const p = o.config.llm.find((x) => x.name === name);
    return { provider: name, configured: Boolean(p), detail: p ? { model: p.model } : {}, quota: null, checkError: null };
  };
  const s = o.config.scraping;
  const apify: Row = { provider: "apify", configured: Boolean(s.apifyToken), detail: {}, quota: null, checkError: null };
  if (s.apifyToken) Object.assign(apify, await apifyQuota(s.apifyToken, doFetch));
  const serperUsed = s.serperApiKey ? await providerCallsSince(o.db, "serper", monthStart) : 0;
  const rows: Row[] = [
    llm("gemini"),
    llm("ollama"),
    apify,
    {
      provider: "serper",
      configured: Boolean(s.serperApiKey),
      detail: {},
      quota: s.serperApiKey ? { used: serperUsed, limit: s.serperMonthlySearchLimit, unit: "searches", source: "MUSHIN's monthly search limit (Serper's own balance is not read)" } : null,
      checkError: null,
    },
    { provider: "youtube", configured: Boolean(s.youtubeApiKey), detail: {}, quota: null, checkError: null },
  ];
  await o.db.withSystem(async (tx) => {
    for (const r of rows) {
      await tx.execute(sql`
        insert into platform.provider_status (provider, configured, detail, quota_used, quota_limit, quota_unit, quota_source, check_error, checked_at)
        values (${r.provider}, ${r.configured}, ${JSON.stringify(r.detail)}::jsonb, ${r.quota?.used ?? null}, ${r.quota?.limit ?? null}, ${r.quota?.unit ?? null},
                ${r.quota?.source ?? null}, ${r.checkError}, now())
        on conflict (provider) do update set configured = excluded.configured, detail = excluded.detail, quota_used = excluded.quota_used,
          quota_limit = excluded.quota_limit, quota_unit = excluded.quota_unit, quota_source = excluded.quota_source,
          check_error = excluded.check_error, checked_at = excluded.checked_at`);
    }
  });
  return rows;
}
