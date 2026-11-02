import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerConfig } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { createStaffActions } from "../../api/src/modules/staffops/index";
import { checkProviderStatus } from "./provider-status";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const SECRET = "apify_api_SECRETTOKEN123";
const config = (o: { apify?: boolean; serper?: boolean; gemini?: boolean } = {}): Pick<WorkerConfig, "llm" | "scraping"> => ({
  llm: [
    ...(o.gemini === false ? [] : [{ name: "gemini" as const, baseUrl: "https://x", apiKey: "gem-secret", model: "gemini-test", priceInPerMTok: 1, priceOutPerMTok: 1 }]),
    { name: "ollama" as const, baseUrl: "https://y", apiKey: "oll-secret", model: "gpt-oss:20b", priceInPerMTok: 0, priceOutPerMTok: 0 },
  ],
  scraping: { apifyToken: o.apify === false ? null : SECRET, serperApiKey: o.serper === false ? null : "serper-secret", serperMonthlySearchLimit: 100, youtubeApiKey: null } as WorkerConfig["scraping"],
});
const apifyReply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rows = () => ownerQuery<{ provider: string; configured: boolean; detail: Record<string, unknown>; quota_used: string | null; quota_limit: string | null; quota_unit: string | null; check_error: string | null }>(`select * from platform.provider_status order by provider`);

describe("provider status (0055)", () => {
  it("records configuration and only the quota a provider reports or Roster itself limits, never a key", async () => {
    await ownerQuery(`insert into platform.provider_calls (provider, operation, model, tokens_in, tokens_out, units, latency_ms, status, cost_usd) values ('serper', 'web_search', null, null, null, 1, 300, 'ok', 0.001), ('serper', 'web_search', null, null, null, 1, 300, 'ok', 0.001)`);
    const seen: string[] = [];
    await checkProviderStatus({ db, config: config(), fetch: (async (url: string, init?: RequestInit) => { seen.push(`${url} ${new Headers(init?.headers).get("authorization")}`); return apifyReply(200, { data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 4.5 } } })(); }) as typeof fetch });
    expect(seen).toEqual([`https://api.apify.com/v2/users/me/limits Bearer ${SECRET}`]);
    const r = Object.fromEntries((await rows()).map((x) => [x.provider, x]));
    expect(r["apify"]).toMatchObject({ configured: true, quota_used: "4.5", quota_limit: "5", quota_unit: "usd", check_error: null });
    expect(r["serper"]).toMatchObject({ configured: true, quota_used: "2", quota_limit: "100", quota_unit: "searches" });
    expect(r["gemini"]).toMatchObject({ configured: true, detail: { model: "gemini-test" }, quota_used: null });
    expect(r["youtube"]).toMatchObject({ configured: false, quota_used: null });
    expect(JSON.stringify(await rows())).not.toMatch(/SECRET|secret/);
  });

  it("records a rejected key or an unexpected answer as a check error, without inventing a quota", async () => {
    await checkProviderStatus({ db, config: config(), fetch: apifyReply(401, { error: { type: "token-not-valid" } }) as typeof fetch });
    expect((await rows()).find((x) => x.provider === "apify")).toMatchObject({ check_error: "http_401", quota_used: null, quota_limit: null });
    await checkProviderStatus({ db, config: config(), fetch: apifyReply(200, { data: { limits: {} } }) as typeof fetch });
    expect((await rows()).find((x) => x.provider === "apify")).toMatchObject({ check_error: "unexpected_response", quota_used: null });
    await checkProviderStatus({ db, config: config(), fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    expect((await rows()).find((x) => x.provider === "apify")).toMatchObject({ check_error: "unreachable" });
  });

  it("raises staff alerts for rejected credentials, low and exhausted quota, and failed checks", async () => {
    await checkProviderStatus({ db, config: config(), fetch: apifyReply(200, { data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 5 } } }) as typeof fetch });
    await ownerQuery(`insert into platform.provider_calls (provider, operation, model, tokens_in, tokens_out, units, latency_ms, status, cost_usd, error_code) values ('gemini', 'creator_assessment', 'gemini-test', 0, 0, null, 100, 'error', 0, 'http_401')`);
    const { alerts } = await createStaffActions({ db }).alerts();
    expect(alerts).toContainEqual(expect.objectContaining({ key: "quota_apify", severity: "critical" }));
    expect(alerts).toContainEqual(expect.objectContaining({ key: "auth_gemini", severity: "critical" }));
    await checkProviderStatus({ db, config: config(), fetch: apifyReply(200, { data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 4.2 } } }) as typeof fetch });
    expect((await createStaffActions({ db }).alerts()).alerts).toContainEqual(expect.objectContaining({ key: "quota_apify", severity: "warning" }));
    await checkProviderStatus({ db, config: config(), fetch: apifyReply(403, {}) as typeof fetch });
    expect((await createStaffActions({ db }).alerts()).alerts).toContainEqual(expect.objectContaining({ key: "status_apify", severity: "critical" }));
    // Not configured: no quota alert at all (nothing is known, nothing is invented).
    await checkProviderStatus({ db, config: config({ apify: false, serper: false }) });
    expect((await createStaffActions({ db }).alerts()).alerts.filter((a) => a.key.startsWith("quota_"))).toEqual([]);
  });
});
