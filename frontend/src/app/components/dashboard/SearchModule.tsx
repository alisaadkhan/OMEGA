import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  SlidersHorizontal,
  X,
  Instagram,
  Youtube,
  Music2,
  MapPin,
  Users,
  Sparkles,
  Star,
  Bookmark,
  GitCompare,
  Plus,
  Grid3x3,
  List,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Info,
  Zap,
  Wand2,
  Check,
} from "lucide-react";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";
import { AddByLinkDialog } from "./AddByLinkDialog";
import { Compare } from "./Compare";
import type { SearchFilters, SearchRequest } from "@mushin/contracts";
import { useCreateSavedSearch, useCreatorSearch, useDeleteSavedSearch, useInterpret, useSavedSearches } from "../../api/search";
import { useActionCosts, useBillingSummary } from "../../api/billing";
import { providerActionsLockedText } from "../../lib/provider-actions";
import {
  extraChips,
  fromChips,
  pageCount,
  applySuggestion,
  CITY_FILTER_ENABLED,
  FILTER_CITIES,
  requestFor,
  sameRequest,
  searchErrorMessage,
  toCreator,
  searchResultToCreator,
  toFilters,
  withoutExtra,
  type ChipState,
  type UiFilters,
  platformMixText,
} from "../../api/search-mapping";
import { useToast } from "../../lib/toast";
import { FindNewDialog } from "./FindNewDialog";
import { SearchCreatorCard } from "./SearchCreatorCard";
import { ShortlistDrawer, type DrawerCreator } from "./ShortlistDrawer";
import { CampaignDrawer } from "./CampaignDrawer";
import { useCancelJob, useDiscoveryJob, useLiveResults } from "../../api/discovery";
import { liveFoundText } from "../../api/discovery-mapping";

/**
 * Volumes 3 + 4A — Search System.
 * Entry, filters, execution, results grid/table, bulk actions,
 * compare, states (loading/empty/no-results/error).
 */

type Platform = "all" | "instagram" | "tiktok" | "youtube";
type ViewMode = "grid" | "table";
type Status = "idle" | "loading" | "streaming" | "results" | "empty" | "error";
type SortKey = "relevance" | "followers" | "engagement" | "freshness";

const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevance (MUSHIN IQ)",
  followers: "Followers",
  engagement: "Engagement rate",
  freshness: "Data freshness",
};

const FRESH_RANK: Record<string, number> = { current: 0, aging: 1, stale: 2, unavailable: 3 };

// The canonical niche list (platform.niches, migration 0054).
const NICHES = ["Bridal", "Fashion", "Beauty", "Tech", "Food", "Travel", "Comedy", "Finance", "Wellness", "Lifestyle", "Education & How-to", "Gaming", "History", "Literature", "Agriculture", "Business & Ecommerce", "Automotive", "Religion", "Music", "News & Commentary", "Sports", "Entertainment", "Real Estate"];

const asDrawer = (c: Creator): DrawerCreator => ({ id: c.id, name: c.name, handle: c.handle, avatar: c.avatar, city: c.city === "Unknown" ? null : c.city });

export function SearchModule({ liveJobId = null, onGoToCampaigns }: { liveJobId?: string | null; onGoToCampaigns?: () => void } = {}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<Platform>("all");
  const [city, setCity] = useState<string | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [followerBand, setFollowerBand] = useState<string | null>(null);
  const [minEng, setMinEng] = useState<string | null>(null);
  const [minScore, setMinScore] = useState<string | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [contactOnly, setContactOnly] = useState(false);
  const [freshOnly, setFreshOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [shortlistFor, setShortlistFor] = useState<DrawerCreator[] | null>(null);
  const [campaignFor, setCampaignFor] = useState<DrawerCreator[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [linkCreator, setLinkCreator] = useState<Creator | null>(null);
  const [mode, setMode] = useState<"fast" | "live">("fast");
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  const [liveJob, setLiveJob] = useState<string | null>(liveJobId);
  useEffect(() => {
    if (liveJobId) setLiveJob(liveJobId);
  }, [liveJobId]);
  const live = useLiveResults(liveJob);
  const liveJobInfo = useDiscoveryJob(liveJob);
  const liveCards = useMemo(() => live.results.map((r) => ({ ...toCreator(r), discovery: { isNew: r.isNew, reason: r.reason, campaignFit: r.campaignFit } })), [live.results]);
  const liveStreaming = liveJob !== null && !live.done && !live.isError;
  const cancelLive = useCancelJob();
  const stopping = liveJobInfo.data?.cancelRequested === true;
  const [showInterpret, setShowInterpret] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const [extra, setExtra] = useState<Partial<SearchFilters>>({});
  const [suggested, setSuggested] = useState<ChipState | null>(null);
  const search = useCreatorSearch(request);
  const interpret = useInterpret();
  const saved = useSavedSearches();
  const createSaved = useCreateSavedSearch();
  const deleteSaved = useDeleteSavedSearch();
  const removePreset = (p: { id: string; name: string }) =>
    deleteSaved.mutate(p.id, { onSuccess: () => toast.success(`Removed saved search "${p.name}".`), onError: (err) => toast.error("Couldn't remove the saved search", err instanceof Error ? err.message : undefined) });
  const uiFilters = (): UiFilters => ({ platform, city, niche, followerBand, minEng, minScore, verifiedOnly, contactOnly, freshOnly, extra });
  // A catalogue search is charged per logical search (server price, shown on the button). Filter changes therefore
  // wait for the user to search again instead of re-running, and nothing searches without a user action.
  const findNewLocked = providerActionsLockedText(useBillingSummary().data);
  const costs = useActionCosts();
  const searchCost = costs?.search_existing ?? null;
  const filtersChanged = request !== null && JSON.stringify(toFilters(uiFilters())) !== JSON.stringify(request.filters);

  // Picking a preset replaces the matching exact value the AI suggested, so the chips show what is really sent.
  useEffect(() => {
    if (followerBand) setExtra((e) => (e.followersMin === undefined && e.followersMax === undefined ? e : withoutExtra(e, "followers")));
  }, [followerBand]);
  useEffect(() => {
    if (minEng) setExtra((e) => (e.engagementMin === undefined ? e : withoutExtra(e, "engagementMin")));
  }, [minEng]);
  useEffect(() => {
    if (niche) setExtra((e) => (e.niches === undefined ? e : withoutExtra(e, "niches")));
  }, [niche]);

  /** Runs a search; the same request again (e.g. Retry) re-fetches, because an unchanged query key fetches nothing. */
  const submit = (next: SearchRequest) => {
    if (sameRequest(next, request)) void search.refetch();
    else setRequest(next);
  };
  /** Further pages of the same search are free (the server recognises the same logical search). */
  const goToPage = (cursor: string | null) => {
    if (request && cursor) setRequest({ ...request, cursor });
  };

  const filtered = useMemo(() => {
    const list = (search.data?.results ?? []).map(searchResultToCreator);
    if (sortKey === "followers") return [...list].sort((a, b) => (a.followersNum === null ? 1 : b.followersNum === null ? -1 : b.followersNum - a.followersNum));
    if (sortKey === "engagement") return [...list].sort((a, b) => (a.engagement === null ? 1 : b.engagement === null ? -1 : b.engagement - a.engagement));
    if (sortKey === "freshness") return [...list].sort((a, b) => FRESH_RANK[a.followersFreshness] - FRESH_RANK[b.followersFreshness]);
    return list; // relevance: the API's fit order
  }, [search.data, sortKey]);
  const visible = filtered;
  // "streaming" returns with live discovery (sub-project 4); the screen keeps that state.
  const status = (request === null ? "idle" : search.isFetching ? "loading" : search.isError ? "error" : filtered.length === 0 ? "empty" : "results") as Status;
  const revealed = liveCards.length;
  const partialFail = 0;
  const activeProfile = filtered.find((c) => c.id === profileId) ?? liveCards.find((c) => c.id === profileId) ?? null;
  const selectedCreators = [...filtered, ...liveCards].filter((c, i, all) => selected.has(c.id) && all.findIndex((x) => x.id === c.id) === i);
  const interpreted = suggested
    ? Object.fromEntries(
        Object.entries({
          platform: suggested.platform === "all" ? undefined : suggested.platform,
          city: suggested.city ?? undefined,
          niche: suggested.niche ?? undefined,
          followerBand: suggested.followerBand ?? undefined,
          minEng: suggested.minEng ?? undefined,
          verifiedOnly: suggested.verifiedOnly || undefined,
        }).filter(([, v]) => v !== undefined),
      )
    : {};
  const presets = (saved.data?.searches ?? []).map((s) => ({ id: s.id, name: s.name, query: s.queryText, filters: s.filters }));

  const runSearch = (searchMode: "fast" | "live" = mode) => {
    if (searchCost === null) return;
    setMode(searchMode);
    setSelected(new Set());
    submit(requestFor(query, uiFilters(), searchCost));
    // Catalogue search itself is deterministic; the AI reading is asked for only when the user clicks for it.
    setSuggested(null);
    setShowInterpret(false);
  };

  /** The optional AI reading of the query (one LLM call), only on request. */
  const suggestFilters = () => {
    if (!query.trim()) return;
    interpret.mutate(query.trim(), {
      onSuccess: (r) => {
        setSuggested(fromChips(r.chips));
        setShowInterpret(true);
      },
      onError: () => setSuggested(null),
    });
  };

  /** The AI's reading is a suggestion: it changes the filters only when the user applies it (SRS REQ-02.02, REQ-03.06). */
  const applyInterpreted = () => {
    if (!suggested || searchCost === null) return;
    const next = applySuggestion(uiFilters(), suggested);
    setPlatform(next.platform);
    setCity(next.city);
    setNiche(next.niche);
    setFollowerBand(next.followerBand);
    setMinEng(next.minEng);
    setVerifiedOnly(next.verifiedOnly);
    setExtra(next.extra);
    toast.info("Applied MUSHIN's reading of your search. Edit the chips anytime.");
    submit(requestFor(query, { ...uiFilters(), ...next }, searchCost));
  };

  const savePreset = () => {
    const name = query.trim().slice(0, 40) || "Untitled search";
    createSaved.mutate(
      { name, queryText: query.trim(), filters: toFilters(uiFilters()) },
      { onSuccess: () => toast.success(`Saved search "${name}".`), onError: (err) => toast.error("Couldn't save the search", err instanceof Error ? err.message : undefined) },
    );
  };

  const loadPreset = (p: { query: string; filters: SearchFilters }) => {
    if (searchCost === null) return;
    const s = fromChips(p.filters);
    setQuery(p.query);
    setPlatform(s.platform);
    setCity(s.city);
    setNiche(s.niche);
    setFollowerBand(s.followerBand);
    setMinEng(s.minEng);
    setVerifiedOnly(s.verifiedOnly);
    setExtra(s.extra);
    setMinScore(p.filters.minAuthenticity !== undefined ? `${p.filters.minAuthenticity}+` : null);
    setContactOnly(p.filters.hasContact);
    setFreshOnly(p.filters.freshOnly);
    setRequest({ text: p.query, filters: p.filters, confirmedCost: searchCost });
  };

  const compareList = filtered.filter((c) => selected.has(c.id)).slice(0, 5);

  // A query typed on the dashboard is a submitted search: run it once the price is known. Opening the page alone
  // never searches (it would be a paid search the user did not ask for).
  const pendingQuery = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (pendingQuery.current === undefined) {
      try {
        pendingQuery.current = sessionStorage.getItem("mushin.pendingQuery");
        if (pendingQuery.current) sessionStorage.removeItem("mushin.pendingQuery");
      } catch {
        pendingQuery.current = null; // storage unavailable
      }
      if (pendingQuery.current) setQuery(pendingQuery.current);
    }
    if (pendingQuery.current && searchCost !== null) {
      setRequest(requestFor(pendingQuery.current, uiFilters(), searchCost));
      pendingQuery.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCost]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chips: { label: string; onRemove: () => void }[] = [
    platform !== "all" && { label: platform, onRemove: () => setPlatform("all") },
    city && { label: city, onRemove: () => setCity(null) },
    niche && { label: niche, onRemove: () => setNiche(null) },
    followerBand && { label: followerBand, onRemove: () => setFollowerBand(null) },
    minEng && { label: `ER ${minEng}`, onRemove: () => setMinEng(null) },
    minScore && { label: `Authenticity ${minScore}`, onRemove: () => setMinScore(null) },
    verifiedOnly && { label: "Verified", onRemove: () => setVerifiedOnly(false) },
    contactOnly && { label: "Has contact", onRemove: () => setContactOnly(false) },
    freshOnly && { label: "Fresh only", onRemove: () => setFreshOnly(false) },
    ...extraChips(extra).map((c) => ({ label: c.label, onRemove: () => setExtra((e) => withoutExtra(e, c.key)) })),
  ].filter(Boolean) as { label: string; onRemove: () => void }[];

  const clearAll = () => {
    setPlatform("all");
    setCity(null);
    setNiche(null);
    setFollowerBand(null);
    setMinEng(null);
    setMinScore(null);
    setVerifiedOnly(false);
    setContactOnly(false);
    setFreshOnly(false);
    setExtra({});
  };

  /** Clears the filters only; searching again (a new, charged search) stays the user's choice. */
  const resetSearch = () => clearAll();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Search &amp; Discovery</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200/60 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-800">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#06B6D4]" />
              Pakistani creators
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Find creators on Instagram, TikTok and YouTube, check their numbers, and shortlist the right ones.</p>
        </div>
      </div>

      {/* Search bar: the input keeps its full width; the actions sit beside it on wide screens and wrap below it on narrow
          ones (they used to be laid over the input, hiding typed text and shrinking its tap target below WCAG 2.5.8). */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch("fast")}
          placeholder="Find Pakistani creators — e.g. bridal Lahore 50k+ engagement 5%+…"
          aria-label="Search creators"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-sm font-medium text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-[#06B6D4] focus:outline-none focus:ring-4 focus:ring-cyan-100"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search text" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
            Filters
            {chips.length > 0 && <span className="rounded-full bg-[#0A0F24] px-1.5 text-[10px] font-bold text-white">{chips.length}</span>}
          </button>
          <button
            onClick={() => runSearch("fast")}
            disabled={searchCost === null}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#0A0F24] px-4 text-xs font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:translate-y-0 disabled:opacity-50"
            title={searchCost === null ? "Loading the search price…" : `Search creators already in MUSHIN · ${searchCost} credits per search · further pages and repeats within 30 minutes are free`}
          >
            <Zap className="h-4 w-4 text-[#06B6D4]" strokeWidth={2} />
            Search Existing Creators
            {searchCost !== null && <span className="rounded bg-white/15 px-1.5 py-0.5 tabular-nums">{searchCost} cr</span>}
          </button>
          <button
            onClick={() => setCreditConfirmOpen(true)}
            disabled={findNewLocked !== null}
            aria-describedby={findNewLocked ? "find-new-locked" : undefined}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            title={findNewLocked ?? (costs ? `Find New Creators · searches Google in real time · ${costs.find_new} credits when it delivers creators, plus ${costs.live_creator} per new creator, never more than the quote you confirm; nothing if it delivers none` : "Find New Creators · quoted before you confirm")}
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#06B6D4]" />
            </span>
            Find New Creators
          </button>
        </div>
      </div>
      {findNewLocked && (
        <p id="find-new-locked" className="text-xs text-slate-600" data-testid="find-new-locked">
          Find New Creators: {findNewLocked}
        </p>
      )}

      {/* The fee before the click: a search that finds no eligible creator is free (owner decision 2026-10-28). */}
      {searchCost !== null && (
        <p className="text-xs text-slate-600" data-testid="search-fee-note">
          Each new search costs {searchCost} credits when it finds creators; a search that finds none is free. Repeating the same search, changing page or sorting within 30 minutes is free.
        </p>
      )}

      {query.trim() && !showInterpret && (
        <button type="button" onClick={suggestFilters} disabled={interpret.isPending} className="inline-flex items-center gap-1.5 self-start rounded-md border border-indigo-100 bg-white px-2.5 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
          <Wand2 className="h-3 w-3" strokeWidth={2} />
          {interpret.isPending ? "Reading your search…" : "Suggest filters with AI"}
        </button>
      )}

      {/* AI interpretation (§7.2) — transparent, editable reading of the query */}
      <AnimatePresence>
        {showInterpret && (Object.keys(interpreted).length > 0 || (suggested !== null && extraChips(suggested.extra).length > 0)) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-700" style={{ fontWeight: 600 }}>
                    Here's how MUSHIN read your search
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Review before running — these become editable filters, nothing is assumed silently.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {interpreted.platform && <InterpChip>Platform · {interpreted.platform}</InterpChip>}
                    {interpreted.city && <InterpChip>City · {interpreted.city}</InterpChip>}
                    {interpreted.niche && <InterpChip>Niche · {interpreted.niche}</InterpChip>}
                    {interpreted.followerBand && <InterpChip>Followers · {interpreted.followerBand}</InterpChip>}
                    {interpreted.minEng && <InterpChip>Engagement · {interpreted.minEng}</InterpChip>}
                    {interpreted.verifiedOnly && <InterpChip>Verified only</InterpChip>}
                    {suggested && extraChips(suggested.extra).map((c) => <InterpChip key={c.key}>{c.label}</InterpChip>)}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      onClick={applyInterpreted}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-indigo-700"
                      style={{ fontWeight: 500 }}
                    >
                      {/* Changed filters are a new logical search: say it is billed, as the search button does. */}
                      <Check className="h-3 w-3" strokeWidth={2.5} /> Apply &amp; search{searchCost !== null ? ` (${searchCost} credits)` : ""}
                    </button>
                    <button
                      onClick={() => setShowInterpret(false)}
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                      style={{ fontWeight: 500 }}
                    >
                      Dismiss — I'll set filters myself
                    </button>
                  </div>
                </div>
                <button onClick={() => setShowInterpret(false)} className="rounded-md p-1 text-slate-500 hover:bg-white/60">
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Saved searches (§7 presets) */}
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" style={{ fontWeight: 500 }}>
            <Bookmark className="h-3 w-3" strokeWidth={2} /> Saved
          </span>
          {presets.map((p) => (
            <span key={p.id} className="inline-flex items-center rounded-full border border-slate-200 bg-white transition-colors hover:border-cyan-300">
              <button
                onClick={() => loadPreset(p)}
                className="max-w-[180px] truncate rounded-l-full py-1 pl-2.5 pr-1.5 text-[11px] text-slate-600 hover:text-cyan-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                style={{ fontWeight: 500 }}
                title={p.query}
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => removePreset(p)}
                disabled={deleteSaved.isPending}
                aria-label={`Remove saved search ${p.name}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-r-full text-slate-500 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Platform tabs + filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Platform">
          {(["all", "instagram", "tiktok", "youtube"] as const).map((p) => {
            const Icon = p === "instagram" ? Instagram : p === "tiktok" ? Music2 : p === "youtube" ? Youtube : null;
            const on = platform === p;
            return (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${on ? "bg-[#0A0F24] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {Icon && <Icon aria-hidden className={`h-3.5 w-3.5 ${on ? "text-[#06B6D4]" : p === "instagram" ? "text-rose-500" : p === "youtube" ? "text-red-600" : "text-slate-900"}`} />}
                {p === "all" ? "All Platforms" : { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" }[p]}
              </button>
            );
          })}
        </div>

        {chips.length > 0 && <span className="h-4 w-px bg-slate-200" />}
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={c.onRemove}
            aria-label={`Remove filter ${c.label}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium capitalize text-cyan-800 transition-colors animate-in fade-in zoom-in-95 duration-200 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          >
            {c.label}
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ))}
        {chips.length > 1 && (
          <button
            onClick={clearAll}
            className="rounded-full text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          >
            Clear all
          </button>
        )}
        {filtersChanged && (
          <button
            onClick={() => runSearch("fast")}
            role="status"
            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
            style={{ fontWeight: 500 }}
          >
            Filters changed · search again to apply{searchCost !== null ? ` (${searchCost} credits)` : ""}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView("grid")}
              className={`rounded p-1.5 transition-colors ${view === "grid" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
              title="Grid"
            >
              <Grid3x3 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setView("table")}
              className={`rounded p-1.5 transition-colors ${view === "table" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
              title="Table"
            >
              <List className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar (Vol 4A §7 Realtime) */}
      <AnimatePresence>
        {status === "loading" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-2 text-slate-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#06B6D4]" strokeWidth={2} />
                  {mode === "live" ? "Find New Creators · querying platforms in real time" : "Searching existing creator profiles…"}
                </span>
                <span>Searching your catalog</span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <motion.div
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#06B6D4] to-teal-600"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating selection tray: slides up from the bottom while creators are selected */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            role="region"
            aria-label="Selected creators"
            className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-[#0A0F24] px-4 py-2.5 text-white shadow-2xl"
          >
            <div className="flex items-center gap-2 border-r border-slate-700/60 pr-3">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#06B6D4] px-1 text-[11px] font-bold text-[#0A0F24]">{selected.size}</span>
              <span className="text-xs font-semibold">selected</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <TrayButton icon={GitCompare} label="Compare" disabled={selected.size < 2} title={selected.size < 2 ? "Select at least 2 creators to compare" : undefined} onClick={() => setCompareOpen(true)} />
              <TrayButton icon={Bookmark} label="Add to List" onClick={() => setShortlistFor(selectedCreators.map(asDrawer))} />
              <TrayButton icon={Plus} label="Add to Campaign" onClick={() => setCampaignFor(selectedCreators.map(asDrawer))} />
            </div>
            <button onClick={() => setSelected(new Set())} title="Clear selection" aria-label="Clear selection" className="rounded-full p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live streaming banner (§7.3) */}
      <AnimatePresence>
        {liveStreaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="inline-flex items-center gap-2.5 text-xs font-semibold text-slate-900">
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#06B6D4]" />
                </span>
                Find New Creators is searching the platforms live
                <span className="rounded-full border border-cyan-200/60 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">Running</span>
              </span>
              <span className="inline-flex items-center gap-3 text-xs">
                <span className="tabular-nums text-slate-700" style={{ fontWeight: 600 }}>
                  {revealed} found
                </span>
                {/* JOB-003: stops at the next safe point; creators already found are kept and charged as quoted. */}
                <button
                  onClick={() => liveJob && cancelLive.mutate(liveJob, { onError: (err) => toast.error("Couldn't stop this search", err instanceof Error ? err.message : undefined) })}
                  disabled={stopping || cancelLive.isPending}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 shadow-sm transition-colors hover:border-rose-200 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-300/50 disabled:opacity-50"
                >
                  {stopping ? "Stopping…" : "Stop search"}
                </button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Find New Creators results (sub-project 4B): best fit first, new and known marked */}
      {liveJob !== null && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">
            {liveFoundText(liveCards, liveStreaming)}
          </div>
          {live.isError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              <span>{live.error instanceof Error ? live.error.message : "Couldn't load this discovery run's progress."}</span>
              <button onClick={() => void live.retry()} className="shrink-0 font-medium underline underline-offset-2">Retry</button>
            </div>
          )}
          {live.done && liveCards.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-5 text-sm text-slate-700">
              <div className="font-medium text-slate-900">
                {liveJobInfo.data?.status === "failed" ? "Live Discovery could not complete." : "No creator profiles were delivered in this run."}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {liveJobInfo.data?.status === "failed"
                  ? liveJobInfo.data.error?.message ?? "Open Jobs to review this run and its credit settlement."
                  : "Open Jobs to review the final outcome and credit settlement."}
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {liveCards.map((c, i) => (
              <div key={c.id} className="space-y-1">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${c.discovery.isNew ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}
                  style={{ fontWeight: 600 }}
                >
                  {c.discovery.isNew ? "New" : "Already in MUSHIN"}
                </span>
                <SearchCreatorCard creator={c} index={i} selected={selected.has(c.id)} onSelect={() => toggleSelect(c.id)} onOpen={() => setProfileId(c.id)} onShortlist={() => setShortlistFor([asDrawer(c)])} />
                {c.discovery.campaignFit && <p className="px-1 text-[11px] text-indigo-700">Fit based on {c.discovery.campaignFit.sampleSize} recent posts · {Math.round(c.discovery.campaignFit.confidence * 100)}% evidence confidence</p>}
                {c.discovery.campaignFit && c.discovery.campaignFit.evidence.length > 0 && (
                  <details className="px-1 text-[11px] text-slate-600">
                    <summary className="cursor-pointer text-slate-700">Why this creator</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {c.discovery.campaignFit.evidence.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                    <a href={c.discovery.campaignFit.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-indigo-600 hover:underline">
                      Checked on the public profile
                    </a>
                  </details>
                )}
                {c.discovery.reason && <p className="px-1 text-[11px] text-slate-500">{c.discovery.reason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="min-h-[420px]">
        {status === "loading" && <ResultsSkeleton view={view} />}
        {status === "error" && <ErrorState message={searchErrorMessage(search.error)} onRetry={() => void search.refetch()} />}
        {status === "empty" && <EmptyResults onReset={resetSearch} onAddByLink={() => setAddOpen(true)} onFindNew={() => setCreditConfirmOpen(true)} />}

        {(status === "results" || status === "streaming") && (
          <div className="space-y-3">
            {search.data && (Object.keys(search.data.understood.filters).length > 0 || search.data.understood.text !== (request?.text ?? "").trim().toLowerCase()) && (
              <p className="text-xs text-slate-500" role="status">
                Searched for{" "}
                <span className="text-slate-700" style={{ fontWeight: 600 }}>{search.data.understood.text || "all creators"}</span>
                {search.data.understood.filters.platform && <> · {search.data.understood.filters.platform}</>}
                {(search.data.understood.filters.followersMin !== undefined || search.data.understood.filters.followersMax !== undefined) && (
                  <> · {search.data.understood.filters.followersMin?.toLocaleString("en-PK") ?? "any"}–{search.data.understood.filters.followersMax?.toLocaleString("en-PK") ?? "any"} followers</>
                )}
                {search.data.understood.filters.engagementMin !== undefined && <> · engagement {search.data.understood.filters.engagementMin}%+</>}
              </p>
            )}
            {search.data && request?.filters.platform === undefined && search.data.understood.filters.platform === undefined && (
              <p className="text-xs text-slate-500">{platformMixText(search.data.platformCounts)}</p>
            )}
            {search.data && !search.data.complete && (
              <p className="text-xs text-slate-600" data-testid="partial-note">
                More creators matched than MUSHIN ranks at once: these are the best matches, not all of them. Add a filter or more words to narrow the search.
              </p>
            )}
            {search.data?.fewResults && (
              <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                Only a few creators match: MUSHIN's catalogue has limited coverage for this search.
                <button onClick={() => setCreditConfirmOpen(true)} className="text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 600 }}>Find new creators</button>
                or
                <button onClick={() => setAddOpen(true)} className="text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 600 }}>add a creator by profile link</button>.
              </p>
            )}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                <span className="text-slate-900" style={{ fontWeight: 600 }}>
                  {status === "streaming" ? revealed : (search.data?.total ?? filtered.length)}
                </span>{" "}
                creator{(search.data?.total ?? filtered.length) === 1 ? "" : "s"} {status === "streaming" ? "found so far" : "match"}
                {status === "results" && <> · sorted by {SORT_LABELS[sortKey].toLowerCase()}</>}
              </span>

              {status === "results" && (
                <div className="relative">
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    aria-expanded={sortOpen}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                  >
                    <span className="text-slate-500">Sort by:</span> <span className="font-semibold text-slate-900">{SORT_LABELS[sortKey]}</span> <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${sortOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {sortOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: -6, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.98 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xl"
                        >
                          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                            <button
                              key={k}
                              onClick={() => {
                                setSortKey(k);
                                setSortOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${sortKey === k ? "bg-slate-50 font-semibold text-slate-900" : "text-slate-600"}`}
                            >
                              {SORT_LABELS[k]}
                              {sortKey === k && <Check className="h-3.5 w-3.5 text-[#06B6D4]" strokeWidth={2.5} />}
                            </button>
                          ))}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Partial completion note (§7.3) */}
            {status === "results" && partialFail > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
                <span>
                  {partialFail} profile{partialFail > 1 ? "s" : ""} could not be fully enriched in this run — their
                  cards show only fields we could confirm. No values were invented. Re-run live discovery to retry
                  the missing fields.
                </span>
              </div>
            )}

            {view === "grid" ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((c, i) => (
                  <SearchCreatorCard
                    key={c.id}
                    creator={c}
                    index={i}
                    selected={selected.has(c.id)}
                    onSelect={() => toggleSelect(c.id)}
                    onOpen={() => setProfileId(c.id)}
                    onShortlist={() => setShortlistFor([asDrawer(c)])}
                  />
                ))}
              </div>
            ) : (
              <ResultsTable
                creators={visible}
                selected={selected}
                onSelect={toggleSelect}
                onOpen={(id) => setProfileId(id)}
              />
            )}

            {search.data && pageCount(search.data.total, search.data.pageSize) > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-4 text-xs text-slate-600">
                <span>Page <strong className="font-semibold text-slate-900">{search.data.page}</strong> of <strong className="font-semibold text-slate-900">{pageCount(search.data.total, search.data.pageSize)}</strong> · <strong className="font-semibold text-slate-900">{search.data.total}</strong> creators</span>
                <span className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(search.data.prevCursor)}
                  disabled={search.data.prevCursor === null}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToPage(search.data.nextCursor)}
                  disabled={search.data.nextCursor === null}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-medium transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                >
                  Next
                </button>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Advanced filter drawer */}
      <AdvancedFilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        city={city} setCity={setCity}
        niche={niche} setNiche={setNiche}
        followerBand={followerBand} setFollowerBand={setFollowerBand}
        minEng={minEng} setMinEng={setMinEng}
        minScore={minScore} setMinScore={setMinScore}
        verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
        contactOnly={contactOnly} setContactOnly={setContactOnly}
        freshOnly={freshOnly} setFreshOnly={setFreshOnly}
        onReset={clearAll}
        onSavePreset={savePreset}
      />

      <AddByLinkDialog open={addOpen} onClose={() => setAddOpen(false)} onOpenCreator={setLinkCreator} />

      <ShortlistDrawer open={shortlistFor !== null} creators={shortlistFor ?? []} onClose={() => setShortlistFor(null)} />
      <CampaignDrawer open={campaignFor !== null} creators={campaignFor ?? []} onClose={() => setCampaignFor(null)} onGoToCampaigns={onGoToCampaigns} />

      {/* Creator profile panel (Vol 4B) */}
      <CreatorProfilePanel
        onGoToCampaigns={onGoToCampaigns}
        creator={activeProfile ?? linkCreator}
        onClose={() => {
          setProfileId(null);
          setLinkCreator(null);
        }}
        onCompare={(c) => {
          setSelected((prev) => new Set(prev).add(c.id));
          setProfileId(null);
          if (selected.size >= 1) setCompareOpen(true);
          else toast.info("Added to comparison — pick at least one more creator, then choose Compare.");
        }}
      />

      {/* Compare overlay (§9) */}
      {compareOpen && (
        <Compare
          creators={compareList}
          criteria={[niche, city, followerBand, minEng && `ER ${minEng}`].filter(Boolean).join(" · ") || undefined}
          onClose={() => setCompareOpen(false)}
          onOpen={(id) => {
            setCompareOpen(false);
            setProfileId(id);
          }}
        />
      )}

      <FindNewDialog
        open={creditConfirmOpen}
        onOpenChange={setCreditConfirmOpen}
        search={{ text: query.trim(), filters: toFilters(uiFilters()) }}
        onStarted={(id) => {
          // Live results stream in on their own; no extra catalogue search (and no extra charge) is started.
          setLiveJob(id);
          setMode("live");
          setSelected(new Set());
        }}
      />
    </div>
  );
}

/* ─────────────────────── creator card ─────────────────────── */

function PlatformIcon({ platform }: { platform: Creator["platform"] }) {
  const map = {
    instagram: { Icon: Instagram, bg: "bg-gradient-to-br from-pink-500 to-orange-400" },
    tiktok: { Icon: Music2, bg: "bg-slate-900" },
    youtube: { Icon: Youtube, bg: "bg-red-500" },
  }[platform];
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-white ${map.bg}`}>
      <map.Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
    </span>
  );
}

function scoreBg(score: number) {
  if (score >= 90) return "bg-emerald-100 text-emerald-700";
  if (score >= 75) return "bg-indigo-100 text-indigo-700";
  if (score >= 60) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

/* ─────────────────────── table view ─────────────────────── */

function ResultsTable({
  creators,
  selected,
  onSelect,
  onOpen,
}: {
  creators: Creator[];
  selected: Set<string>;
  onSelect: (h: string) => void;
  onOpen: (h: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50/80 backdrop-blur">
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="w-8 py-3 pl-4" />
            <th className="py-3" style={{ fontWeight: 600 }}>Creator</th>
            <th className="py-3" style={{ fontWeight: 600 }}>Platform</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>Followers</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>ER</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>Auth.</th>
            <th className="py-3 pr-4 text-right" style={{ fontWeight: 600 }}>IQ</th>
          </tr>
        </thead>
        <tbody>
          {creators.map((c) => (
            <motion.tr
              key={c.id}
              layout
              className={`border-t border-slate-100 transition-colors ${selected.has(c.id) ? "bg-indigo-50/40" : "hover:bg-slate-50/50"}`}
            >
              <td className="pl-4">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => onSelect(c.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </td>
              <td className="py-3">
                <button onClick={() => onOpen(c.id)} className="flex items-center gap-3">
                  <img src={c.avatar} alt={c.name} className="h-8 w-8 rounded-full object-cover" />
                  <div className="text-left">
                    <div className="text-slate-900" style={{ fontWeight: 500 }}>{c.name}</div>
                    <div className="text-xs text-slate-500">@{c.handle} · {c.city}</div>
                  </div>
                </button>
              </td>
              <td className="py-3">
                <div className="inline-flex items-center gap-1.5">
                  <PlatformIcon platform={c.platform} />
                  <span className="text-xs capitalize text-slate-600">{c.platform}</span>
                </div>
              </td>
              <td className="py-3 text-right tabular-nums text-slate-700">{c.followers}</td>
              <td className="py-3 text-right tabular-nums text-slate-700">{c.engagement === null ? "—" : `${c.engagement.toFixed(1)}%`}</td>
              <td className="py-3 text-right tabular-nums text-slate-700">{c.authenticity ?? "—"}</td>
              <td className="py-3 pr-4 text-right">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${scoreBg(c.score)}`} style={{ fontWeight: 600 }}>
                  {c.score}
                </span>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── states ─────────────────────── */

function ResultsSkeleton({ view }: { view: ViewMode }) {
  if (view === "table") {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
            <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
              <div className="h-2.5 w-24 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded-full bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-slate-200/80 bg-white p-4">
          <div className="flex gap-3">
            <div className="h-11 w-11 rounded-full bg-slate-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 rounded bg-slate-100" />
              <div className="h-2.5 w-20 rounded bg-slate-100" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="h-9 rounded bg-slate-100" />
            <div className="h-9 rounded bg-slate-100" />
            <div className="h-9 rounded bg-slate-100" />
          </div>
          <div className="mt-3 h-7 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyResults({ onReset, onAddByLink, onFindNew }: { onReset: () => void; onAddByLink: () => void; onFindNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center animate-in fade-in duration-300">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Info className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        No creators match your filters
      </div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        No eligible Pakistani creators match these filters yet, so this search cost nothing. Widen the filters, add a creator you know by their profile link, or find new creators live where your plan allows it.
      </p>
      <div className="mt-4 flex gap-2">
        <button onClick={onFindNew} className="rounded-xl bg-[#0A0F24] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
          Find new creators
        </button>
        <button onClick={onReset} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
          Reset filters
        </button>
        <button onClick={onAddByLink} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
          Add by profile link
        </button>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-6 py-16 text-center animate-in fade-in duration-300">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-red-600 shadow-sm ring-1 ring-red-200">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        Search failed
      </div>
      <p className="mt-1 max-w-md text-sm text-slate-600">
        {message} Searching existing creators never uses credits.
      </p>
      <button onClick={onRetry} className="mt-4 rounded-xl bg-[#0A0F24] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
        Retry search
      </button>
    </div>
  );
}

/* ─────────────────────── bulk action button ─────────────────────── */

function TrayButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: any;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-4 w-4 text-[#06B6D4]" strokeWidth={2} />
      {label}
    </button>
  );
}

/* ─────────────────────── advanced filter drawer ─────────────────────── */

function AdvancedFilterDrawer(props: {
  open: boolean;
  onClose: () => void;
  city: string | null; setCity: (v: string | null) => void;
  niche: string | null; setNiche: (v: string | null) => void;
  followerBand: string | null; setFollowerBand: (v: string | null) => void;
  minEng: string | null; setMinEng: (v: string | null) => void;
  minScore: string | null; setMinScore: (v: string | null) => void;
  verifiedOnly: boolean; setVerifiedOnly: (v: boolean) => void;
  contactOnly: boolean; setContactOnly: (v: boolean) => void;
  freshOnly: boolean; setFreshOnly: (v: boolean) => void;
  onReset: () => void;
  onSavePreset: () => void;
}) {
  const { open, onClose } = props;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-slate-900" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  Advanced filters
                </div>
                <div className="mt-0.5 text-xs text-slate-500">Refine your search</div>
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
              {CITY_FILTER_ENABLED && (
                <FilterGroup label="City" icon={MapPin}>
                  {FILTER_CITIES.map((c) => (
                    <Chip key={c} active={props.city === c} onClick={() => props.setCity(props.city === c ? null : c)}>
                      {c}
                    </Chip>
                  ))}
                </FilterGroup>
              )}

              <FilterGroup label="Niche" icon={Sparkles}>
                {NICHES.map((n) => (
                  <Chip key={n} active={props.niche === n} onClick={() => props.setNiche(props.niche === n ? null : n)}>
                    {n}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Follower band" icon={Users}>
                {["10K–100K", "100K–1M", "1M+"].map((b) => (
                  <Chip key={b} active={props.followerBand === b} onClick={() => props.setFollowerBand(props.followerBand === b ? null : b)}>
                    {b}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Engagement rate" icon={Sparkles}>
                {["2%+", "5%+", "8%+"].map((e) => (
                  <Chip key={e} active={props.minEng === e} onClick={() => props.setMinEng(props.minEng === e ? null : e)}>
                    {e}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Authenticity score" icon={Star}>
                {["70+", "85+", "90+"].map((s) => (
                  <Chip key={s} active={props.minScore === s} onClick={() => props.setMinScore(props.minScore === s ? null : s)}>
                    {s}
                  </Chip>
                ))}
              </FilterGroup>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={props.verifiedOnly}
                  onChange={(e) => props.setVerifiedOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 500 }}>Verified only</div>
                  <div className="text-xs text-slate-500">Show only platform-verified accounts</div>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={props.contactOnly}
                  onChange={(e) => props.setContactOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 500 }}>Contact available</div>
                  <div className="text-xs text-slate-500">Only creators with a usable contact on file</div>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={props.freshOnly}
                  onChange={(e) => props.setFreshOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 500 }}>Fresh data only</div>
                  <div className="text-xs text-slate-500">Hide creators whose core data is aging or stale</div>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
              <button
                onClick={props.onSavePreset}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                style={{ fontWeight: 500 }}
              >
                <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} /> Save preset
              </button>
              <div className="flex gap-2">
                <button
                  onClick={props.onReset}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  style={{ fontWeight: 500 }}
                >
                  Reset
                </button>
                <button onClick={onClose} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
                  Apply
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function FilterGroup({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function InterpChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] capitalize text-indigo-700"
      style={{ fontWeight: 500 }}
    >
      {children}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-all ${
        active
          ? "border-indigo-500 bg-indigo-500 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
      style={{ fontWeight: 500 }}
    >
      {children}
    </button>
  );
}
