import {
  searchFiltersSchema,
  searchFiltersShape,
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
import { and, eq } from "drizzle-orm";
import { contactReveals, writeOutbox, type Db, type TenantTx } from "@mushin/db";
import type { Llm, SearchHit, SearchIndex } from "@mushin/integrations";
import type { CatalogSearch } from "./postgres-search";
import type { BillingService } from "../billing/index";
import { interpretOutputSchema, interpretSystemPrompt } from "./prompts";
import * as repo from "./repository";
import { cleanInterpretation, contactAvailability, fenced, freshnessOf, isContactable, isMinorProtected, meiliFilter, normalizeProfileUrl, refreshActionFor, sourceHash } from "./rules";
import { toCards } from "./ranking";
import { suppressedUrls } from "./suppressions";
import { chargeCatalogSearch } from "./search-charge";
import { decodeCursor, encodeCursor } from "./cursor";
import { understandQuery } from "./understand";
import { matchReasons } from "./match-reasons";
import { creatorEligibility } from "./eligibility";
import { DEFAULT_SOURCE_POLICY, restrictsDerived, type SourcePolicy } from "./source-policy";

export type CreatorsDeps = {
  db: Db;
  index: SearchIndex;
  nativeSearch?: CatalogSearch;
  /** With Meilisearch as the backend: the always-maintained PostgreSQL projection answers while Meilisearch is unavailable. */
  fallbackSearch?: CatalogSearch;
  llm: Llm;
  billing: Pick<BillingService, "engine" | "getAccess" | "actionCost">;
  encryptionKey: Buffer;
  logger: Logger;
  now?: () => Date;
  /** Source-specific metric rules (DATA-004); defaults to the restrictive policy. */
  sourcePolicy?: SourcePolicy;
};

const SETTINGS_TTL_MS = 60_000;
const MAX_SAVED_SEARCHES = 50;
const FILTER_ONLY_SORT = ["engagement_rate:desc", "authenticity_score:desc", "followers:desc"];

export function createCreatorsService(deps: CreatorsDeps) {
  const now = deps.now ?? (() => new Date());
  const policy = deps.sourcePolicy ?? DEFAULT_SOURCE_POLICY;
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  let cached: { at: number; settings: repo.SearchSettings; niches: string[]; revealCost: number; refreshCost: Record<"refresh_data" | "refresh_tiktok", number> } | null = null;

  /** Search settings, the niche list and the reveal and refresh prices change rarely; reading them once a minute keeps search to one database query. */
  async function config(ctx: TenantContext) {
    if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached;
    const loaded = await deps.db.withTenant(tenant(ctx), async (tx) => ({ settings: await repo.getSearchSettings(tx), niches: await repo.activeNiches(tx) }));
    cached = {
      at: Date.now(),
      ...loaded,
      revealCost: await deps.billing.actionCost(ctx, "reveal_contact"),
      refreshCost: {
        refresh_data: await deps.billing.actionCost(ctx, "refresh_data"),
        refresh_tiktok: await deps.billing.actionCost(ctx, "refresh_tiktok"),
      },
    };
    return cached;
  }

  /** Meilisearch first when it is the backend; only its unavailability (not a bad request) falls back to PostgreSQL. */
  async function fromIndex(meili: () => Promise<{ hits: SearchHit[]; total: number }>, native: (s: CatalogSearch) => Promise<{ hits: SearchHit[]; total: number }>) {
    if (deps.nativeSearch) return native(deps.nativeSearch);
    try {
      return await meili();
    } catch (err) {
      if (!deps.fallbackSearch || !(err instanceof AppError && err.code === "PROVIDER_UNAVAILABLE")) throw err;
      deps.logger.warn({ err }, "Meilisearch unavailable: catalog search answered from the PostgreSQL projection");
      return native(deps.fallbackSearch);
    }
  }

  // ── search (Brain-1, spec §4) ──────────────────────────────────────────────
  async function search(ctx: TenantContext, req: SearchRequest): Promise<SearchResponse> {
    if (req.filters.audienceCountry) throw new AppError("PROVIDER_UNAVAILABLE", "Audience-country filtering is unavailable until a verified audience analytics source is connected.");
    const t = now();
    const { settings } = await config(ctx);
    // What the text asks for: topic words to match, role words for ranking, and clearly stated platform, follower or
    // engagement ranges as filters (explicit filters win). Billing and cursors stay bound to the request as sent.
    const understood = understandQuery(req.text);
    const merged = {
      ...req.filters,
      platform: req.filters.platform ?? understood.filters.platform,
      followersMin: req.filters.followersMin ?? understood.filters.followersMin,
      followersMax: req.filters.followersMax ?? understood.filters.followersMax,
      engagementMin: req.filters.engagementMin ?? understood.filters.engagementMin,
    };
    const parsed = searchFiltersSchema.safeParse(merged);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "The search asks for an impossible range (the minimum is above the maximum). Adjust it and search again.", { reason: "conflicting_range" });
    const q = { ...req, text: understood.text, filters: parsed.data };
    // Without text, Meilisearch returns matches in storage order; sorting by the fit score's strongest signals keeps the
    // capped candidate pool on the best creators when more match than it holds (SRS REQ-02.03).
    const { hits, total: indexTotal } = await fromIndex(
      () =>
        deps.index.search({
          text: q.text,
          filter: meiliFilter(q.filters, t, settings.fresh.currentDays),
          limit: settings.candidatePool,
          ...(q.text ? {} : { sort: FILTER_ONLY_SORT }),
        }),
      (s) => s.search({ text: q.text, boost: understood.optional, filters: q.filters, freshCurrentDays: settings.fresh.currentDays, now: t, limit: settings.candidatePool }, tenant(ctx)),
    );
    const relevance = new Map(hits.map((h) => [h.id, h.rankingScore]));
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.cardRows(tx, hits.map((h) => h.id)));
    const cards = toCards(rows, q, settings, t, relevance, policy);
    const start = decodeCursor(req, req.cursor, settings.pageSize);
    // Paid only once the search has answered; refused (no results returned) when the price or balance does not allow it.
    const charge = await chargeCatalogSearch({ db: deps.db, billing: deps.billing, now }, ctx, req);
    // Why each creator on this page matched (CAT-005), from the text the projection indexed; ordering is unchanged.
    const page = cards.slice(start, start + settings.pageSize);
    const fields = q.text ? new Map((await deps.db.withTenant(tenant(ctx), (tx) => repo.matchFieldRows(tx, page.map((c) => c.id)))).map((f) => [f.id, f])) : new Map();
    const results = page.map((c) => {
      const f = fields.get(c.id);
      return { ...c, matchedOn: f ? matchReasons(q.text, f) : [] };
    });
    return {
      ...charge,
      understood: { text: understood.text, filters: Object.fromEntries(Object.entries(understood.filters).filter(([k, v]) => v !== undefined && req.filters[k as keyof typeof req.filters] === undefined)) },
      results,
      nextCursor: start + settings.pageSize < cards.length ? encodeCursor(req, start + settings.pageSize) : null,
      prevCursor: start > 0 ? encodeCursor(req, Math.max(0, start - settings.pageSize)) : null,
      // A full pool means more creators matched than were scored; the index's estimate is then the better total.
      total: hits.length >= settings.candidatePool ? Math.max(cards.length, indexTotal) : cards.length,
      page: Math.floor(start / settings.pageSize) + 1,
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
      ids = (await fromIndex(
        () => deps.index.search({ text: q, filter: meiliFilter(searchFiltersShape.parse({}), now(), 0), limit: 8 }),
        (s) => s.search({ text: q, filters: searchFiltersShape.parse({}), freshCurrentDays: 0, now: now(), limit: 8 }, tenant(ctx)),
      )).hits.map((h) => h.id);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.cardRows(tx, ids));
    const { refreshCost } = await config(ctx);
    const suppressed = url && ids.length === 0 ? await deps.db.withTenant(tenant(ctx), (tx) => suppressedUrls(tx, [url.canonicalUrl])) : new Set<string>();
    // A profile link MUSHIN does not have yet can be added (a hidden creator's link matched an id, so it is not addable).
    const addable =
      url && ids.length === 0 && !suppressed.has(url.canonicalUrl)
        ? {
            platform: url.platform,
            handle: (url.canonicalUrl.split("/").pop() ?? "").replace(/^@/, ""),
            url: url.canonicalUrl,
            cost: refreshCost[refreshActionFor(url.platform)],
          }
        : null;
    return {
      matches: rows
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((r) => ({ id: r.id, displayName: r.displayName, handle: r.primaryHandle, platform: r.primaryPlatform, avatarUrl: r.avatarUrl })),
      addable,
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
    const { settings, revealCost, refreshCost } = await config(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status === "erased" || c.status === "removal_requested") throw new AppError("NOT_FOUND", "Creator not found");
      const profiles = await repo.getProfiles(tx, id);
      const snap = await repo.latestSnapshot(tx, id);
      const contacts = await repo.contactSummaries(tx, id);
      const links = isMinorProtected(c) ? [] : await repo.linkedAccounts(tx, id);
      const primary = profiles.find((p) => p.platform === c.primaryPlatform) ?? profiles[0];
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
          // Averages and rates are MUSHIN-derived; observed counts above stay visible.
          engagementRate: restrictsDerived(p.platform, policy) ? null : p.engagementRate,
          avgLikes: restrictsDerived(p.platform, policy) ? null : p.avgLikes,
          avgComments: restrictsDerived(p.platform, policy) ? null : p.avgComments,
          avgViews: restrictsDerived(p.platform, policy) ? null : p.avgViews,
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
        authenticity: restrictsDerived(c.primaryPlatform, policy)
          ? { status: "restricted" as const, reason: "youtube_api_policy" as const }
          : snap && snap.authenticityScore !== null && evidence.length > 0
            ? { status: "assessed" as const, score: snap.authenticityScore, fakeFollowerPct: c.fakeFollowerPct, evidence, assessedAt: snap.createdAt.toISOString() }
            : c.assessmentStatus === "pending"
              ? { status: "pending" as const }
              : c.assessmentStatus === "insufficient_data"
                ? { status: "insufficient_data" as const }
                : { status: "not_assessed" as const },
        contacts: contacts.map((k) => ({
          id: k.id, kind: k.kind, masked: k.masked, trust: k.trust, value: values.get(k.id) ?? null, source: k.source,
          firstSeenAt: k.firstSeenAt.toISOString(), lastSeenAt: k.lastSeenAt.toISOString(), status: k.status, checkedAt: iso(k.checkedAt), checkDetail: k.checkDetail,
        })),
        contactAvailability: contactAvailability(contacts),
        eligibility: profileEligibilityView(c, profiles, t),
        revealed,
        revealCost,
        refreshCost: refreshCost[refreshActionFor(c.primaryPlatform)],
        // Links can lead to a possible minor as directly as a contact can (SRS §5.5).
        linkedAccounts: links,
        lastScrapedAt: iso(primary?.lastScrapedAt ?? null),
        minorProtected: isMinorProtected(c),
        // Something worth revealing: not only addresses shown not to work.
        hasContacts: isContactable(contactAvailability(contacts)),
        mergedInto: c.mergedIntoId,
      };
    });
  }

  // ── contact reveal (spec D4) ──────────────────────────────────────────────
  async function reveal(ctx: TenantContext, id: string, confirmedCost: number): Promise<RevealResponse> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status !== "active") throw new AppError("NOT_FOUND", "Creator not found");
      if (isMinorProtected(c)) throw new AppError("FORBIDDEN", "Contact details of possible minors cannot be revealed.", { reason: "minor_protected" });
      if (!isContactable(contactAvailability(await repo.contactSummaries(tx, id)))) {
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

  /** SRS §6.3 "deletable per workspace": the workspace forgets contacts it revealed (no refund). */
  async function forgetReveal(ctx: TenantContext, creatorId: string): Promise<void> {
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can remove revealed contacts.");
    await deps.db.withTenant(tenant(ctx), (tx) => tx.delete(contactReveals).where(and(eq(contactReveals.workspaceId, ctx.workspaceId), eq(contactReveals.creatorId, creatorId))));
  }

  return { search, interpret, lookup, listSaved, createSaved, deleteSaved, profile, reveal, forgetReveal };
}

export type CreatorsService = ReturnType<typeof createCreatorsService>;

/** The profile view of eligibility (elig-1): the creator verdict and each profile's own (no counts beyond what the profile shows). */
function profileEligibilityView(
  c: { status: string; isMinor: boolean; minorOverrideByStaffId: string | null },
  profiles: { platform: "instagram" | "tiktok" | "youtube"; canonicalUrl: string; followers: number | null; followersUpdatedAt: Date | null; lastPostAt: Date | null }[],
  now: Date,
) {
  const e = creatorEligibility(c, profiles.map((p) => ({ ...p, followers: p.platform === "youtube" && p.followers === 0 ? null : p.followers })), now);
  return {
    eligible: e.eligible,
    version: e.version,
    reasons: e.reasons,
    qualifyingPlatforms: e.qualifyingPlatforms,
    flags: e.flags,
    profiles: e.profiles.map((p) => ({ platform: p.platform, qualifies: p.qualifies, reasons: p.reasons, flags: p.flags })),
  };
}
