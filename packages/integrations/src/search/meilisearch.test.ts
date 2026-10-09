import { describe, expect, it } from "vitest";
import { MeilisearchIndex } from "./meilisearch";

type Call = { url: string; method: string; body: unknown };

function fakeMeili(routes: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(input), method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null };
    calls.push(c);
    return routes(c);
  };
  const index = new MeilisearchIndex({ host: "http://meili.test", apiKey: "k", indexName: "t_creators", fetch: fetchFake as typeof fetch, pollMs: 1 });
  return { index, calls };
}

describe("MeilisearchIndex", () => {
  it("searches with filters, retrieves only ids and returns ranking scores", async () => {
    const { index, calls } = fakeMeili(() => Response.json({ hits: [{ id: "a", _rankingScore: 0.9 }, { id: "b", _rankingScore: 0.4 }], estimatedTotalHits: 2 }));
    const out = await index.search({ text: "bridal", filter: ['platforms = "instagram"'], limit: 200 });
    expect(out).toEqual({ hits: [{ id: "a", rankingScore: 0.9 }, { id: "b", rankingScore: 0.4 }], total: 2 });
    expect(calls[0]).toMatchObject({
      url: "http://meili.test/indexes/t_creators/search",
      method: "POST",
      body: { q: "bridal", filter: ['platforms = "instagram"'], limit: 200, attributesToRetrieve: ["id"], showRankingScore: true },
    });
  });

  it("passes a sort order when one is given (filter-only searches)", async () => {
    const { index, calls } = fakeMeili(() => Response.json({ hits: [], estimatedTotalHits: 0 }));
    await index.search({ text: "", filter: [], limit: 200, sort: ["engagement_rate:desc", "followers:desc"] });
    expect(calls[0]?.body).toMatchObject({ q: "", sort: ["engagement_rate:desc", "followers:desc"] });
  });

  it("treats a missing index as no results", async () => {
    const { index } = fakeMeili(() => Response.json({ code: "index_not_found", message: "x" }, { status: 404 }));
    expect(await index.search({ text: "", filter: [], limit: 10 })).toEqual({ hits: [], total: 0 });
  });

  it("reports an unreachable engine as PROVIDER_UNAVAILABLE", async () => {
    const { index } = fakeMeili(() => {
      throw new TypeError("fetch failed");
    });
    await expect(index.search({ text: "x", filter: [], limit: 10 })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("waits for the indexing task to finish and reports failed tasks", async () => {
    let polls = 0;
    const { index } = fakeMeili((c) => {
      if (c.url.endsWith("/documents?primaryKey=id")) return Response.json({ taskUid: 7 }, { status: 202 });
      if (c.url.endsWith("/tasks/7")) return Response.json({ status: ++polls < 2 ? "processing" : "succeeded" });
      if (c.url.endsWith("/documents/delete-batch")) return Response.json({ taskUid: 8 }, { status: 202 });
      return Response.json({ status: "failed", error: { message: "bad" } });
    });
    await index.upsert([{ id: "a" } as never]);
    expect(polls).toBe(2);
    await expect(index.remove(["a"])).rejects.toThrow(/bad/);
  });
});
