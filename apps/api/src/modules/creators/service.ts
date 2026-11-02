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
  type EligibilityCoverage,
} from "@mushin/contracts";
import { AppError, decryptSecret, type Logger, type TenantContext } from "@mushin/core";
import { and, eq, sql } from "drizzle-orm";
import { contactReveals, writeOutbox, type Db, type TenantTx } from "@mushin/db";
import type { Llm, SearchHit, SearchIndex } from "@mushin/integrations";
import type { CatalogSearch } from "./postgres-search";
import type { BillingService } from "../billing/index";
import { interpretOutputSchema, interpretSystemPrompt } from "./prompts";
import * as repo from "./repository";
import { cleanInterpretation, contactAvailability, fenced, freshnessOf, isContactable, isMinorProtected, maskBioContacts, meiliFilter, normalizeProfileUrl, refreshActionFor, sourceHash } from "./rules";
import { toCards } from "./ranking";
import { suppressedUrls } from "./suppressions";
import { assertCanPayCatalogSearch, chargeCatalogSearch } from "./search-charge";
import { decodeCursor, encodeCursor } from "./cursor";
import { understandQuery } from "./understand";
import { understandQueryV2 } from "./understand-v2";
import { matchReasons } from "./match-reasons";
import { countryLocked, creatorEligibility, ELIGIBILITY_VERSION, type EligibilityProfile } from "./eligibility";
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
  /** Query understanding and terminology version (owner decision 2026-10-20): v1 (frozen, default) or v2. */
  searchProfile?: "v1" | "v2";
  /** Whether the worker that writes AI summaries runs; without it a profile says "unavailable" instead of "generating" forever. */
  workerAvailable?: () => Promise<boolean>;
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
  async function fromIndex(
    meili: () => Promise<{ hits: SearchHit[]; total: number }>,
    native: (s: CatalogSearch) => Promise<{ hits: SearchHit[]; total: number }>,
  ): Promise<{ hits: SearchHit[]; total: number; backend: "postgres" | "meilisearch" }> {
    if (deps.nativeSearch) return { ...(await native(deps.nativeSearch)), backend: "postgres" };
    try {
      return { ...(await meili()), backend: "meilisearch" };
    } catch (err) {
      if (!deps.fallbackSearch || !(err instanceof AppError && err.code === "PROVIDER_UNAVAILABLE")) throw err;
      deps.logger.warn({ err }, "Meilisearch unavailable: catalog search answered from the PostgreSQL projection");
      return { ...(await native(deps.fallbackSearch)), backend: "postgres" };
    }
  }

  /**
   * Usage events (0065). Recorded after the answer is built and never allowed to fail it: an event that cannot be written
   * is logged and dropped. No query text and nothing about the viewer is exposed to staff.
   */
  async function recordSearch(ctx: TenantContext, e: { backend: "postgres" | "meilisearch"; results: number; complete: boolean; charged: boolean; hasText: boolean; filterCount: number }) {
    try {
      await deps.db.withTenant(tenant(ctx), (tx) =>
        tx.execute(sql`insert into wp.search_events (workspace_id, user_id, backend, results, complete, charged, has_text, filter_count)
          values (${ctx.workspaceId}, ${ctx.userId}, ${e.backend}, ${e.results}, ${e.complete}, ${e.charged}, ${e.hasText}, ${e.filterCount})`),
      );
    } catch (err) {
      deps.logger.warn({ err }, "search event not recorded");
    }
  }
  /** One view per person and creator per 30 minutes (repeated opens and reloads count once). */
  async function recordView(ctx: TenantContext, creatorId: string, platform: string) {
    try {
      await deps.db.withTenant(tenant(ctx), (tx) =>
        tx.execute(sql`insert into wp.creator_profile_views (workspace_id, user_id, creator_id, platform)
          select ${ctx.workspaceId}, ${ctx.userId}, ${creatorId}, ${platform}
          where not exists (select 1 from wp.creator_profile_views v where v.user_id = ${ctx.userId} and v.creator_id = ${creatorId} and v.viewed_at > now() - interval '30 minutes')`),
      );
    } catch (err) {
      deps.logger.warn({ err }, "profile view not recorded");
    }
  }

  // ── search (Brain-1, spec §4) ──────────────────────────────────────────────
  async function search(ctx: TenantContext, req: SearchRequest): Promise<SearchResponse> {
    if (req.filters.audienceCountry) throw new AppError("PROVIDER_UNAVAILABLE", "Audience-country filtering is unavailable until a verified audience analytics source is connected.");
    const t = now();
    const { settings } = await config(ctx);
    // What the text asks for: topic words to match, role words for ranking, and clearly stated platform, follower or
    // engagement ranges as filters (explicit filters win). Billing and cursors stay bound to the request as sent.
    const v2 = deps.searchProfile === "v2" ? understandQueryV2(req.text) : null;
    const understood = v2 ? { text: v2.text, optional: v2.boost, filters: v2.filters } : understandQuery(req.text);
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
    // A search the workspace cannot pay for is refused before it runs, whatever it would find (no zero-credit oracle).
    await assertCanPayCatalogSearch({ db: deps.db, billing: deps.billing, now }, ctx, req);
    // Without text, Meilisearch returns matches in storage order; sorting by the fit score's strongest signals keeps the
    // capped candidate pool on the best creators when more match than it holds (SRS REQ-02.03).
    const { hits, total: indexTotal, backend } = await fromIndex(
      () =>
        deps.index.search({
          text: q.text,
          filter: meiliFilter(q.filters, t, settings.fresh.currentDays),
          limit: settings.candidatePool,
          ...(q.text ? {} : { sort: FILTER_ONLY_SORT }),
        }),
      (s) => s.search({ text: q.text, boost: understood.optional, filters: q.filters, freshCurrentDays: settings.fresh.currentDays, now: t, limit: settings.candidatePool, ...(v2?.groups.length ? { plan: v2.groups } : {}) }, tenant(ctx)),
    );
    const relevance = new Map(hits.map((h) => [h.id, h.rankingScore]));
    const rows = await deps.db.withTenant(tenant(ctx), (tx) => repo.cardRows(tx, hits.map((h) => h.id)));
    const cards = toCards(rows, q, settings, t, relevance, policy);
    const start = decodeCursor(req, req.cursor, settings.pageSize);
    // Paid only once the search has answered with at least one eligible creator (owner decision 2026-10-28: a search
    // that finds none costs nothing); refused (no results returned) when the price or balance does not allow it.
    const charge = cards.length === 0 ? { charged: false, creditsCharged: 0 } : await chargeCatalogSearch({ db: deps.db, billing: deps.billing, now }, ctx, req);
    // Why each creator on this page matched (CAT-005), from the text the projection indexed; ordering is unchanged.
    const page = cards.slice(start, start + settings.pageSize);
    const fields = q.text ? new Map((await deps.db.withTenant(tenant(ctx), (tx) => repo.matchFieldRows(tx, page.map((c) => c.id)))).map((f) => [f.id, f])) : new Map();
    const results = page.map((c) => {
      const f = fields.get(c.id);
      return { ...c, matchedOn: f ? matchReasons(q.text, f) : [] };
    });
    // A new search is its first page; paging, sorting and repeats are the same search.
    if (!req.cursor) {
      const filterCount = Object.values(parsed.data).filter((v) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0)).length;
      await recordSearch(ctx, { backend, results: cards.length, complete: hits.length < settings.candidatePool, charged: charge.charged, hasText: q.text.trim().length > 0, filterCount });
    }
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
      complete: hits.length < settings.candidatePool,
      platformCounts: {
        instagram: cards.filter((c) => c.platform === "instagram").length,
        tiktok: cards.filter((c) => c.platform === "tiktok").length,
        youtube: cards.filter((c) => c.platform === "youtube").length,
      },
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
    let locked = false;
    if (url) {
      const id = await deps.db.withTenant(tenant(ctx), (tx) => repo.findIdByCanonicalUrl(tx, url.canonicalUrl));
      // A link to a creator locked by the catalogue rules (elig-2) reveals nothing unless this workspace already holds it.
      const visible = id ? await deps.db.withTenant(tenant(ctx), async (tx) => { const e = (await repo.eligibilityOf(tx, [id], now())).get(id); return (e !== undefined && !countryLocked(e)) || (await repo.workspaceHasCreator(tx, id)); }) : false;
      locked = id !== null && !visible;
      ids = id && visible ? [id] : [];
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
      url && ids.length === 0 && !locked && !suppressed.has(url.canonicalUrl)
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
  async function summaryState(tx: TenantTx, ctx: TenantContext, c: repo.CreatorRow, hash: string, workerUp: boolean): Promise<CreatorProfile["summary"]> {
    // A possible minor's data is never sent to the AI, and no earlier summary is shown (SRS §5.2, §5.5).
    if (isMinorProtected(c)) return { status: "unavailable", text: null, model: null, generatedAt: null };
    if (c.aiSummary !== null && c.aiSummarySourceHash === hash) {
      return { status: "ready", text: c.aiSummary, model: c.aiSummaryModel, generatedAt: c.aiSummaryAt?.toISOString() ?? null };
    }
    // Nothing would write it: say so (the previous text, if any, is still shown) and request it on a later view.
    if (!workerUp) return { status: "unavailable", text: c.aiSummary, model: c.aiSummaryModel, generatedAt: c.aiSummaryAt?.toISOString() ?? null };
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
    const workerUp = deps.workerAvailable ? await deps.workerAvailable() : true;
    const shown = await deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status === "erased" || c.status === "removal_requested") throw new AppError("NOT_FOUND", "Creator not found");
      const profiles = await repo.getProfiles(tx, id);
      // Locked by the Pakistan-only rule (elig-2: no profile of the creator is Pakistani): only a workspace that already
      // holds the creator may open it; an id from anywhere else gets the same answer as an unknown id. Other exclusions
      // (follower count, possible minor) keep their existing behaviour: the profile opens, labelled or protected.
      if (countryLocked(profileEligibilityView(c, profiles, t)) && !(await repo.workspaceHasCreator(tx, id))) throw new AppError("NOT_FOUND", "Creator not found");
      const snap = await repo.latestSnapshot(tx, id);
      const contacts = await repo.contactSummaries(tx, id);
      const links = isMinorProtected(c) ? [] : await repo.linkedAccounts(tx, id);
      // Quotes come from the creator's own posts and bio: withheld under minor protection, like links.
      const attributeEvidence = isMinorProtected(c) ? [] : await repo.attributeEvidence(tx, id);
      const primary = profiles.find((p) => p.platform === c.primaryPlatform) ?? profiles[0];
      const revealed = await repo.hasReveal(tx, ctx.workspaceId, id);
      const values = new Map<string, string>();
      if (revealed) for (const v of await repo.revealedContacts(tx, id)) values.set(v.id, decryptSecret(v.value_encrypted, deps.encryptionKey));
      const summary = await summaryState(tx, ctx, c, sourceHash(repo.buildSummarySource(c, profiles, snap)), workerUp);
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
        countrySource: c.countrySource,
        niches: c.niches,
        nicheClassification: c.nicheStatus ? { main: c.nicheMain, status: c.nicheStatus, confidence: c.nicheConfidence } : null,
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
          // Emails and phone numbers in the bio stay hidden until this workspace reveals the contacts.
          bio: revealed ? p.bio : maskBioContacts(p.bio),
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
        attributeEvidence: attributeEvidence.map((e) => ({ ...e, quote: revealed ? e.quote : maskBioContacts(e.quote), observedAt: e.observedAt.toISOString() })),
      };
    });
    await recordView(ctx, shown.id, shown.platform);
    return shown;
  }

  // ── contact reveal (spec D4) ──────────────────────────────────────────────
  async function reveal(ctx: TenantContext, id: string, confirmedCost: number): Promise<RevealResponse> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await repo.getCreator(tx, id);
      if (!c || c.status !== "active") throw new AppError("NOT_FOUND", "Creator not found");
      // A creator locked by the Pakistan-only rule answers like an unknown id here too, unless this workspace holds it (BUG-32).
      if (countryLocked(profileEligibilityView(c, await repo.getProfiles(tx, id), now())) && !(await repo.workspaceHasCreator(tx, id))) throw new AppError("NOT_FOUND", "Creator not found");
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

  /** Staff coverage report (counts only) under the eligibility policy. */
  async function eligibilityCoverage(): Promise<EligibilityCoverage> {
    const t = now();
    return { policy: ELIGIBILITY_VERSION, at: t.toISOString(), ...(await deps.db.withSystem((tx) => repo.eligibilityCoverage(tx, t))) };
  }

  return { search, interpret, lookup, listSaved, createSaved, deleteSaved, profile, reveal, forgetReveal, eligibilityCoverage };
}

export type CreatorsService = ReturnType<typeof createCreatorsService>;

/** The profile view of eligibility (elig-1): the creator verdict and each profile's own (no counts beyond what the profile shows). */
function profileEligibilityView(
  c: { status: string; isMinor: boolean; minorOverrideByStaffId: string | null },
  profiles: { platform: "instagram" | "tiktok" | "youtube"; canonicalUrl: string; followers: number | null; followersUpdatedAt: Date | null; lastPostAt: Date | null; availability?: EligibilityProfile["availability"]; country?: string | null; countryStatus?: "pakistan" | "foreign" | "unknown" | "conflicting"; countryCheckedAt?: Date | null }[],
  now: Date,
) {
  const e = creatorEligibility(c, profiles.map((p) => ({ ...p, followers: p.platform === "youtube" && p.followers === 0 ? null : p.followers, country: { code: p.country ?? null, status: p.countryStatus ?? null, checkedAt: p.countryCheckedAt ?? null } })), now);
  return {
    eligible: e.eligible,
    version: e.version,
    reasons: e.reasons,
    qualifyingPlatforms: e.qualifyingPlatforms,
    flags: e.flags,
    profiles: e.profiles.map((p) => ({ platform: p.platform, qualifies: p.qualifies, reasons: p.reasons, flags: p.flags })),
  };
}
