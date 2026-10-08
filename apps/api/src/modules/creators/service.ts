import {
  searchFiltersShape,
  type InterpretResponse,
  type LookupResponse,
  type SavedSearch,
  type SearchFilters,
  type SearchRequest,
  type SearchResponse,
} from "@mushin/contracts";
import { AppError, type Logger, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { Llm, SearchIndex } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { interpretOutputSchema, interpretSystemPrompt } from "./prompts";
import * as repo from "./repository";
import { cleanInterpretation, fenced, fitLabel, fitScore, freshnessOf, meiliFilter, normalizeProfileUrl } from "./rules";

export type CreatorsDeps = {
  db: Db;
  index: SearchIndex;
  llm: Llm;
  billing: Pick<BillingService, "engine" | "getAccess">;
  encryptionKey: Buffer;
  logger: Logger;
  now?: () => Date;
};

const SETTINGS_TTL_MS = 60_000;
const MAX_SAVED_SEARCHES = 50;

export function createCreatorsService(deps: CreatorsDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  let cached: { at: number; settings: repo.SearchSettings; niches: string[] } | null = null;

  /** Search settings and the niche list change rarely; reading them once a minute keeps search to one database query. */
  async function config(ctx: TenantContext) {
    if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached;
    const loaded = await deps.db.withTenant(tenant(ctx), async (tx) => ({ settings: await repo.getSearchSettings(tx), niches: await repo.activeNiches(tx) }));
    cached = { at: Date.now(), ...loaded };
    return cached;
  }

  // ── search (Brain-1, spec §4) ──────────────────────────────────────────────
  async function search(ctx: TenantContext, req: SearchRequest): Promise<SearchResponse> {
    const t = now();
    const { settings } = await config(ctx);
    const { hits } = await deps.index.search({ text: req.text, filter: meiliFilter(req.filters, t, settings.fresh.currentDays), limit: settings.candidatePool });
    const relevance = new Map(hits.map((h) => [h.id, h.rankingScore]));
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.cardRows(tx, hits.map((h) => h.id)));
    const cards = rows
      .map((r) => {
        const followersFreshness = freshnessOf(r.followersUpdatedAt, t, settings.fresh);
        const score = fitScore(
          {
            textScore: req.text ? (relevance.get(r.id) ?? 0) : null,
            followers: r.followers,
            engagementRate: r.engagementRate,
            authenticityScore: r.authenticityScore,
            followersFreshness,
          },
          req.filters,
          settings.weights,
        );
        return {
          id: r.id,
          displayName: r.displayName,
          handle: r.primaryHandle,
          platform: r.primaryPlatform,
          avatarUrl: r.avatarUrl,
          city: r.city,
          country: r.country,
          niches: r.niches,
          tags: r.tags,
          verified: r.verified,
          followers: r.followers,
          engagementRate: r.engagementRate,
          authenticityScore: r.authenticityScore,
          fakeFollowerPct: r.fakeFollowerPct,
          hasContact: r.hasContact,
          followersFreshness,
          fitScore: score,
          fitLabel: fitLabel(score, settings.labels),
        };
      })
      .sort((a, b) => b.fitScore - a.fitScore || b.followers - a.followers || a.id.localeCompare(b.id));
    const start = (req.page - 1) * settings.pageSize;
    return {
      results: cards.slice(start, start + settings.pageSize),
      total: cards.length,
      page: req.page,
      pageSize: settings.pageSize,
      fewResults: cards.length < settings.fewResults,
    };
  }

  async function interpret(ctx: TenantContext, text: string): Promise<InterpretResponse> {
    const { niches } = await config(ctx);
    const { value } = await deps.llm.complete({
      feature: "search_interpret",
      system: interpretSystemPrompt(niches),
      input: fenced("query", text),
      schema: interpretOutputSchema,
      timeoutMs: 8_000,
      ctx: { workspaceId: ctx.workspaceId, requestId: ctx.requestId },
    });
    return cleanInterpretation(value, niches);
  }

  /** Omnibar (SRS §3.1): a profile URL is matched exactly; anything else searches names and handles. */
  async function lookup(ctx: TenantContext, q: string): Promise<LookupResponse> {
    const url = normalizeProfileUrl(q);
    let ids: string[];
    if (url) {
      const id = await deps.db.withTenant(tenant(ctx), (tx) => repo.findIdByCanonicalUrl(tx, url.canonicalUrl));
      ids = id ? [id] : [];
    } else {
      ids = (await deps.index.search({ text: q, filter: [], limit: 8 })).hits.map((h) => h.id);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.cardRows(tx, ids));
    return {
      matches: rows
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((r) => ({ id: r.id, displayName: r.displayName, handle: r.primaryHandle, platform: r.primaryPlatform, avatarUrl: r.avatarUrl })),
    };
  }

  // ── saved searches (REQ-02.04) ────────────────────────────────────────────
  function toSaved(r: repo.SavedSearchRow): SavedSearch {
    const filters = searchFiltersShape.safeParse(r.filters);
    return {
      id: r.id,
      name: r.name,
      queryText: r.queryText,
      filters: filters.success ? filters.data : searchFiltersShape.parse({}),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async function listSaved(ctx: TenantContext): Promise<{ searches: SavedSearch[] }> {
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.listSavedSearches(tx, ctx.workspaceId));
    return { searches: rows.map(toSaved) };
  }

  async function createSaved(ctx: TenantContext, body: { name: string; queryText: string; filters: SearchFilters }): Promise<SavedSearch> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      if ((await repo.countSavedSearches(tx, ctx.workspaceId)) >= MAX_SAVED_SEARCHES) {
        throw new AppError("CONFLICT", `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`);
      }
      return toSaved(
        await repo.insertSavedSearch(tx, { workspaceId: ctx.workspaceId, name: body.name, queryText: body.queryText, filters: body.filters, createdBy: ctx.userId }),
      );
    });
  }

  async function deleteSaved(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await deps.db.withTenant(tenant(ctx), (tx) => repo.deleteSavedSearch(tx, ctx.workspaceId, id));
    if (!deleted) throw new AppError("NOT_FOUND", "Saved search not found");
  }

  return { search, interpret, lookup, listSaved, createSaved, deleteSaved };
}

export type CreatorsService = ReturnType<typeof createCreatorsService>;
