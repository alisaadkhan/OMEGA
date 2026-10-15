import { AppError } from "@mushin/core";
import type { CreatorDocument, SearchHit, SearchIndex } from "./types";

type Options = { host: string; apiKey: string; indexName: string; fetch?: typeof fetch; timeoutMs?: number; pollMs?: number };

const SETTINGS = {
  searchableAttributes: ["display_name", "name_variants", "primary_handle", "handles", "niches", "tags", "bio"],
  filterableAttributes: [
    "platforms",
    "country",
    "city",
    "audience_countries",
    "followers",
    "engagement_rate",
    "niches",
    "verified",
    "authenticity_score",
    "has_contact",
    "followers_updated_epoch",
    "eligible",
    "eligible_until",
  ],
  sortableAttributes: ["followers", "engagement_rate", "authenticity_score"],
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  pagination: { maxTotalHits: 1000 },
};

class MeiliHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "MeiliHttpError";
  }
}

/** Meilisearch over its REST API. Infrastructure with a flat fee: calls are not written to provider_calls. */
export class MeilisearchIndex implements SearchIndex {
  private readonly doFetch: typeof fetch;
  private readonly base: string;

  constructor(private readonly o: Options) {
    this.doFetch = o.fetch ?? fetch;
    this.base = `${o.host.replace(/\/+$/, "")}/indexes/${encodeURIComponent(o.indexName)}`;
  }

  private async call<T>(url: string, method: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 3000),
        headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new AppError("PROVIDER_UNAVAILABLE", "Search is temporarily unavailable. Please try again shortly.", undefined, { cause: err });
    }
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof json["code"] === "string" ? json["code"] : null;
      if (res.status >= 500) throw new AppError("PROVIDER_UNAVAILABLE", "Search is temporarily unavailable. Please try again shortly.");
      throw new MeiliHttpError(res.status, code, `Meilisearch ${method} ${url} failed with ${res.status}: ${text.slice(0, 200)}`);
    }
    return json as T;
  }

  private async waitForTask(taskUid: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const t = await this.call<{ status: string; error?: { message?: string } | null }>(`${this.o.host.replace(/\/+$/, "")}/tasks/${taskUid}`, "GET");
      if (t.status === "succeeded") return;
      if (t.status === "failed" || t.status === "canceled") throw new Error(`Meilisearch task ${taskUid} ${t.status}: ${t.error?.message ?? "unknown error"}`);
      if (Date.now() > deadline) throw new Error(`Meilisearch task ${taskUid} did not finish within 15 s`);
      await new Promise((r) => setTimeout(r, this.o.pollMs ?? 100));
    }
  }

  async ensureSettings(): Promise<void> {
    const created = await this.call<{ taskUid: number }>(`${this.o.host.replace(/\/+$/, "")}/indexes`, "POST", { uid: this.o.indexName, primaryKey: "id" });
    try {
      await this.waitForTask(created.taskUid);
    } catch (err) {
      if (!(err instanceof Error && /index_already_exists|already exists/.test(err.message))) throw err;
    }
    const s = await this.call<{ taskUid: number }>(`${this.base}/settings`, "PATCH", SETTINGS);
    await this.waitForTask(s.taskUid);
  }

  async upsert(docs: CreatorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const t = await this.call<{ taskUid: number }>(`${this.base}/documents?primaryKey=id`, "POST", docs);
    await this.waitForTask(t.taskUid);
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const t = await this.call<{ taskUid: number }>(`${this.base}/documents/delete-batch`, "POST", ids);
    await this.waitForTask(t.taskUid);
  }

  async search(q: { text: string; filter: string[]; limit: number; sort?: string[] }): Promise<{ hits: SearchHit[]; total: number }> {
    try {
      const r = await this.call<{ hits: { id: string; _rankingScore?: number }[]; estimatedTotalHits?: number }>(`${this.base}/search`, "POST", {
        q: q.text,
        filter: q.filter,
        limit: q.limit,
        ...(q.sort ? { sort: q.sort } : {}),
        attributesToRetrieve: ["id"],
        showRankingScore: true,
      });
      return { hits: r.hits.map((h) => ({ id: h.id, rankingScore: h._rankingScore ?? 0 })), total: r.estimatedTotalHits ?? r.hits.length };
    } catch (err) {
      if (err instanceof MeiliHttpError && err.code === "index_not_found") return { hits: [], total: 0 };
      throw err;
    }
  }

  async listIds(eligibilityVersion?: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let offset = 0; ; offset += 1000) {
      let page: { results: { id: string; updated_epoch?: number; eligibility_version?: string }[]; total: number };
      try {
        page = await this.call(`${this.base}/documents/fetch`, "POST", { fields: ["id", "updated_epoch", "eligibility_version"], limit: 1000, offset });
      } catch (err) {
        if (err instanceof MeiliHttpError && err.code === "index_not_found") return out;
        throw err;
      }
      for (const d of page.results) out.set(d.id, eligibilityVersion && d.eligibility_version !== eligibilityVersion ? -1 : (d.updated_epoch ?? 0));
      if (offset + 1000 >= page.total) return out;
    }
  }

  async ping(): Promise<"ok"> {
    const r = await this.call<{ status?: string }>(`${this.o.host.replace(/\/+$/, "")}/health`, "GET");
    if (r.status !== "available") throw new AppError("PROVIDER_UNAVAILABLE", "Search is temporarily unavailable.");
    return "ok";
  }

  async drop(): Promise<void> {
    try {
      const t = await this.call<{ taskUid: number }>(this.base, "DELETE");
      await this.waitForTask(t.taskUid);
    } catch (err) {
      if (!(err instanceof MeiliHttpError && err.code === "index_not_found")) throw err;
    }
  }
}
