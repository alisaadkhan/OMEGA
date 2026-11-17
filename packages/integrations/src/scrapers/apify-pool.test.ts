import { describe, expect, it } from "vitest";
import { createApifyPool } from "./apify";

type Call = { token: string; url: string };
/** A fake Apify: `limited` tokens answer the monthly-limit refusal when starting a run; runs belong to their token. */
function fakeApify(limited: string[], other: Record<string, number> = {}) {
  const calls: Call[] = [];
  const runs = new Map<string, string>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const token = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    calls.push({ token, url });
    if (/\/acts\/.+\/runs/.test(url)) {
      if (other[token]) return json({ error: { type: "invalid-input" } }, other[token]);
      if (limited.includes(token)) return json({ error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" } }, 403);
      const id = `run-${token}`;
      runs.set(id, token);
      return json({ data: { id, status: "SUCCEEDED", defaultDatasetId: `ds-${token}`, usageTotalUsd: 0.01 } });
    }
    const runId = url.match(/actor-runs\/([^/?]+)/)?.[1];
    if (runId) return runs.get(runId) === token ? json({ data: { id: runId, status: "SUCCEEDED", defaultDatasetId: `ds-${token}`, usageTotalUsd: 0.01 } }) : json({ error: { type: "record-not-found" } }, 404);
    if (/datasets\/.+\/items/.test(url)) return json([{ username: "x" }]);
    return json({ data: { itemCount: 1 } });
  }) as typeof fetch;
  return { calls, fetch: fetchFake };
}

describe("several Apify accounts (owner, 17 Nov)", () => {
  it("starts a run on the next account once one is at its monthly limit, and reads that run from the same account", async () => {
    const f = fakeApify(["one"]);
    const pool = createApifyPool({ tokens: ["one", "two"], fetch: f.fetch, sleep: async () => {} });
    const out = await pool.runActor("apify/instagram-profile-scraper", { usernames: ["x"] });
    expect(out.runId).toBe("run-two");
    expect(f.calls.filter((c) => c.url.includes("/datasets/")).every((c) => c.token === "two")).toBe(true);
    // The account that was full is not asked again for the next run.
    await pool.runActor("apify/instagram-profile-scraper", { usernames: ["y"] });
    expect(f.calls.filter((c) => /\/acts\//.test(c.url)).map((c) => c.token)).toEqual(["one", "two", "two"]);
  });

  it("does not switch accounts for any other error", async () => {
    const f = fakeApify([], { one: 400 });
    const pool = createApifyPool({ tokens: ["one", "two"], fetch: f.fetch, sleep: async () => {} });
    await expect(pool.runActor("apify/instagram-profile-scraper", {})).rejects.toThrow(/HTTP 400/);
    expect(f.calls.some((c) => c.token === "two")).toBe(false);
  });

  it("says so when every account is at its limit, and finds a stored run on whichever account owns it", async () => {
    const f = fakeApify(["one", "two"]);
    const pool = createApifyPool({ tokens: ["one", "two"], fetch: f.fetch, sleep: async () => {} });
    await expect(pool.runActor("a/b", {})).rejects.toThrow(/Every configured Apify account/);
    const g = fakeApify([]);
    const pool2 = createApifyPool({ tokens: ["one", "two"], fetch: g.fetch, sleep: async () => {} });
    await createApifyPool({ tokens: ["two"], fetch: g.fetch, sleep: async () => {} }).runActor("a/b", {});
    expect((await pool2.inspectRun("run-two")).terminal).toBe(true);
  });
});
