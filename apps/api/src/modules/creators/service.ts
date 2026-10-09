import {
  searchFiltersShape,
  type AudienceResponse,
  type CreatorProfile,
  type InterpretResponse,
  type LookupResponse,
  type RevealResponse,
  type SavedSearch,
  type SearchFilters,
  type SearchRequest,
  type SearchResponse,
} from "@mushin/contracts";
import { AppError, decryptSecret, type Logger, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import type { Llm, SearchIndex } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { interpretOutputSchema, interpretSystemPrompt } from "./prompts";
import * as repo from "./repository";
import { cleanInterpretation, fenced, fitLabel, fitScore, freshnessOf, isMinorProtected, meiliFilter, monthKey, normalizeProfileUrl, sourceHash } from "./rules";

export type CreatorsDeps = {
  db: Db;
  index: SearchIndex;
  llm: Llm;
  billing: Pick<BillingService, "engine" | "getAccess" | "actionCost">;
  encryptionKey: Buffer;
  logger: Logger;
  now?: () => Date;
};

const SETTINGS_TTL_MS = 60_000;
const MAX_SAVED_SEARCHES = 50;

export function createCreatorsService(deps: CreatorsDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  let cached: { at: number; settings: repo.SearchSettings; niches: string[]; revealCost: number } | null = null;

  /** Search settings, the niche list and the reveal price change rarely; reading them once a minute keeps search to one database query. */
  async function config(ctx: TenantContext) {
    if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached;
    const loaded = await deps.db.withTenant(tenant(ctx), async (tx) => ({ settings: await repo.getSearchSettings(tx), niches: await repo.activeNiches(tx) }));
    cached = { at: Date.now(), ...loaded, revealCost: await deps.billing.actionCost(ctx, "reveal_contact") };
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

  // ── profile (spec §5) ──────────────────────────────────────────────────────
  async function summaryState(tx: TenantTx, ctx: TenantContext, c: repo.CreatorRow, hash: string): Promise<CreatorProfile["summary"]> {
    // A possible minor's data is never sent to the AI, and no earlier summary is shown (SRS §5.2, §5.5).
    if (isMinorProtected(c)) return { status: "unavailable", text: null, model: null, generatedAt: null };
    if (c.aiSummary !== null && c.aiSummarySourceHash === hash) {
      return { status: "ready", text: c.aiSummary, model: c.aiSummaryModel, generatedAt: c.aiSummaryAt?.toISOString() ?? null };
    }
    const requested = await repo.requestSummary(tx, c.id, hash);
    if (requested) {
      await writeOutbox(tx, {
        eventType: "creator.summary_requested",
        aggregateType: "creator",
        aggregateId: c.id,
        workspaceId: null,
        payload: { creatorId: c.id, sourceHash: hash },
        requestId: ctx.requestId,
      });
    }
    const failedLast = !requested && c.aiSummaryFailedAt !== null && (c.aiSummaryAt === null || c.aiSummaryFailedAt > c.aiSummaryAt);
    // While a new version is written, the previous text (if any) is still shown.
    return { status: failedLast ? "unavailable" : "generating", text: c.aiSummary, model: c.aiSummaryModel, generatedAt: c.aiSummaryAt?.toISOString() ?? null };
  }

  async function profile(ctx: TenantContext, id: string): Promise<CreatorProfile> {
    const t = now();
    const { settings, revealCost } = await config(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status === "erased" || c.status === "removal_requested") throw new AppError("NOT_FOUND", "Creator not found");
      const profiles = await repo.getProfiles(tx, id);
      const snap = await repo.latestSnapshot(tx, id);
      const contacts = await repo.contactSummaries(tx, id);
      const revealed = await repo.hasReveal(tx, ctx.workspaceId, id);
      const values = new Map<string, string>();
      if (revealed) for (const v of await repo.revealedContacts(tx, id)) values.set(v.id, decryptSecret(v.value_encrypted, deps.encryptionKey));
      const summary = await summaryState(tx, ctx, c, sourceHash(repo.buildSummarySource(c, profiles, snap)));
      const evidence = snap?.evidenceBreakdown ?? [];
      const iso = (d: Date | null) => d?.toISOString() ?? null;
      return {
        id: c.id,
        displayName: c.displayName,
        handle: c.primaryHandle,
        platform: c.primaryPlatform,
        avatarUrl: c.avatarUrl,
        city: c.city,
        country: c.country,
        niches: c.niches,
        tags: c.tags,
        verified: c.verified,
        profiles: profiles.map((p) => ({
          platform: p.platform,
          handle: p.handle,
          url: p.canonicalUrl,
          followers: p.followers,
          following: p.following,
          posts: p.posts,
          engagementRate: p.engagementRate,
          avgLikes: p.avgLikes,
          avgComments: p.avgComments,
          avgViews: p.avgViews,
          bio: p.bio,
          freshness: {
            followers: freshnessOf(p.followersUpdatedAt, t, settings.fresh),
            engagement: freshnessOf(p.engagementUpdatedAt, t, settings.fresh),
            audience: freshnessOf(p.audienceUpdatedAt, t, settings.fresh),
          },
          updatedAt: { followers: iso(p.followersUpdatedAt), engagement: iso(p.engagementUpdatedAt), audience: iso(p.audienceUpdatedAt) },
        })),
        summary,
        // Never a score without the evidence behind it (SRS REQ-01.02, §5.5).
        authenticity:
          snap && snap.authenticityScore !== null && evidence.length > 0
            ? { status: "assessed" as const, score: snap.authenticityScore, fakeFollowerPct: c.fakeFollowerPct, evidence, assessedAt: snap.createdAt.toISOString() }
            : { status: "not_assessed" as const },
        contacts: contacts.map((k) => ({ id: k.id, kind: k.kind, masked: k.masked, trust: k.trust, value: values.get(k.id) ?? null })),
        revealed,
        revealCost,
        minorProtected: isMinorProtected(c),
        hasContacts: contacts.length > 0,
        mergedInto: c.mergedIntoId,
      };
    });
  }

  // ── estimated audience (spec D5) ──────────────────────────────────────────
  async function audience(ctx: TenantContext, id: string): Promise<AudienceResponse> {
    const access = await deps.billing.getAccess(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status !== "active") throw new AppError("NOT_FOUND", "Creator not found");
      const latest = await repo.latestAudience(tx, id);
      if (!latest) return { status: "not_assessed" as const };
      const firstThisMonth = await repo.insertAudienceView(tx, ctx.workspaceId, id, monthKey(now()), ctx.userId);
      if (firstThisMonth && !(await deps.billing.engine.useEntitlement(tx, ctx.workspaceId, "audience_views", access.entitlements.audienceViewsPerMonth))) {
        // Throwing rolls back the view row recorded above.
        const reason = access.planId !== null || access.status === "trialing" ? "plan_limit" : "no_active_plan";
        throw new AppError(
          "ENTITLEMENT_REQUIRED",
          reason === "plan_limit" ? "You've used this month's audience views on your plan." : "Choose a plan to see audience details.",
          { reason, key: "audience_views" },
        );
      }
      return { status: "estimated" as const, audience: latest.audience, updatedAt: latest.at.toISOString() };
    });
  }

  // ── contact reveal (spec D4) ──────────────────────────────────────────────
  async function reveal(ctx: TenantContext, id: string, confirmedCost: number): Promise<RevealResponse> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status !== "active") throw new AppError("NOT_FOUND", "Creator not found");
      if (isMinorProtected(c)) throw new AppError("FORBIDDEN", "Contact details of possible minors cannot be revealed.", { reason: "minor_protected" });
      if ((await repo.contactSummaries(tx, id)).length === 0) {
        throw new AppError("CONFLICT", "We have no contact details for this creator yet.", { reason: "no_contacts" });
      }
      // The reveal row comes first: a simultaneous duplicate waits on its key and then finds it, so only one request pays.
      let charged = false;
      if (await repo.insertReveal(tx, ctx.workspaceId, id, ctx.userId)) {
        const held = await deps.billing.engine.spendInstant(
          tx,
          ctx.workspaceId,
          { action: "reveal_contact", confirmedCost, refType: "creator", refId: id },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
        await repo.setRevealReservation(tx, ctx.workspaceId, id, held.reservationId);
        charged = true;
      }
      const values = await repo.revealedContacts(tx, id);
      return { contacts: values.map((v) => ({ id: v.id, kind: v.kind, value: decryptSecret(v.value_encrypted, deps.encryptionKey), trust: v.trust })), charged };
    });
  }

  return { search, interpret, lookup, listSaved, createSaved, deleteSaved, profile, audience, reveal };
}

export type CreatorsService = ReturnType<typeof createCreatorsService>;
