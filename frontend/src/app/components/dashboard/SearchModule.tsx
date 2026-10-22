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
  ArrowUpRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Info,
  Zap,
  Radio,
  Wand2,
  Check,
  Mail,
  Phone,
  Ban,
  Clock,
} from "lucide-react";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";
import { AddByLinkDialog } from "./AddByLinkDialog";
import { Compare } from "./Compare";
import type { SearchFilters, SearchRequest } from "@mushin/contracts";
import { useCreateSavedSearch, useCreatorSearch, useInterpret, useSavedSearches } from "../../api/search";
import { useActionCosts } from "../../api/billing";
import {
  extraChips,
  fromChips,
  pageCount,
  applySuggestion,
  CONTACT_AVAILABILITY_TEXT,
  requestFor,
  sameRequest,
  searchErrorMessage,
  toCreator,
  searchResultToCreator,
  matchSummary,
  toFilters,
  withoutExtra,
  type ChipState,
  type UiFilters,
  platformMixText,
} from "../../api/search-mapping";
import { FreshnessBadge } from "./states";
import { useToast } from "../../lib/toast";
import { FindNewDialog } from "./FindNewDialog";
import { SaveToListMenu } from "./SaveToListMenu";
import { AddToCampaignMenu } from "./AddToCampaignMenu";
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
  relevance: "Relevance (Creator Fit score)",
  followers: "Followers",
  engagement: "Engagement rate",
  freshness: "Data freshness",
};

const FRESH_RANK: Record<string, number> = { current: 0, aging: 1, stale: 2, unavailable: 3 };

const CITIES = ["Karachi", "Lahore", "Islamabad", "Faisalabad", "Peshawar"];
const NICHES = ["Bridal", "Fashion", "Beauty", "Tech", "Food", "Travel", "Comedy", "Finance", "Wellness", "Lifestyle"];

export function SearchModule({ liveJobId = null }: { liveJobId?: string | null } = {}) {
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
  const [showInterpret, setShowInterpret] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const [extra, setExtra] = useState<Partial<SearchFilters>>({});
  const [suggested, setSuggested] = useState<ChipState | null>(null);
  const search = useCreatorSearch(request);
  const interpret = useInterpret();
  const saved = useSavedSearches();
  const createSaved = useCreateSavedSearch();
  const uiFilters = (): UiFilters => ({ platform, city, niche, followerBand, minEng, minScore, verifiedOnly, contactOnly, freshOnly, extra });
  // A catalogue search is charged per logical search (server price, shown on the button). Filter changes therefore
  // wait for the user to search again instead of re-running, and nothing searches without a user action.
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
    if (query.trim()) {
      interpret.mutate(query.trim(), {
        onSuccess: (r) => {
          setSuggested(fromChips(r.chips));
          setShowInterpret(true);
        },
        onError: () => setSuggested(null),
      });
    }
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
          <h1
            className="tracking-tight text-slate-900"
            style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em" }}
          >
            Search
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Multi-platform creator discovery — filter, verify, and shortlist in one place.
          </p>
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
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
            style={{ fontWeight: 500 }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            Filters
          </button>
          <button
            onClick={() => runSearch("fast")}
            disabled={searchCost === null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs text-white transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md disabled:opacity-60"
            style={{ fontWeight: 500 }}
            title={searchCost === null ? "Loading the search price…" : `Search creators already in MUSHIN · ${searchCost} credits per search · further pages and repeats within 30 minutes are free`}
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={2} />
            Search Existing Creators
            {searchCost !== null && <span className="rounded bg-white/15 px-1.5 py-0.5 tabular-nums">{searchCost} cr</span>}
          </button>
          <button
            onClick={() => setCreditConfirmOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 text-xs text-amber-800 transition-all hover:-translate-y-px hover:shadow-md"
            style={{ fontWeight: 500 }}
            title={costs ? `Find New Creators · searches Google in real time · ${costs.find_new} credits when it delivers creators, plus ${costs.live_creator} per new creator, never more than the quote you confirm; nothing if it delivers none` : "Find New Creators · quoted before you confirm"}
          >
            <Radio className="h-3.5 w-3.5" strokeWidth={2} />
            Find New Creators
          </button>
        </div>
      </div>

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
            <button
              key={p.id}
              onClick={() => loadPreset(p)}
              className="max-w-[180px] truncate rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
              style={{ fontWeight: 500 }}
              title={p.query}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Platform tabs + filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {(["all", "instagram", "tiktok", "youtube"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${
                platform === p ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              style={{ fontWeight: 500 }}
            >
              {p === "all" ? "All platforms" : p}
            </button>
          ))}
        </div>

        {chips.length > 0 && <span className="h-4 w-px bg-slate-200" />}
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={c.onRemove}
            className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 transition-colors hover:bg-indigo-100"
            style={{ fontWeight: 500 }}
          >
            {c.label}
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ))}
        {chips.length > 1 && (
          <button
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-800"
            style={{ fontWeight: 500 }}
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
            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-2 text-slate-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" strokeWidth={2} />
                  {mode === "live" ? "Find New Creators · querying platforms in real time" : "Searching existing creator profiles…"}
                </span>
                <span>Searching your catalog</span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <motion.div
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm"
          >
            <span className="text-indigo-800">
              <span style={{ fontWeight: 600 }}>{selected.size}</span> selected
            </span>
            <div className="flex items-center gap-1.5">
              <BulkAction
                icon={GitCompare}
                label="Compare"
                disabled={selected.size < 2}
                onClick={() => {
                  if (selected.size < 2) {
                    toast.warning("Select at least 2 creators to compare.");
                    return;
                  }
                  setCompareOpen(true);
                }}
              />
              <SaveToListMenu creatorIds={[...selected]} label={`Save ${selected.size} to a list`} />
              <AddToCampaignMenu creatorIds={[...selected]} label={`Add ${selected.size} to a campaign`} />
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-md px-2 py-1 text-xs text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                Clear
              </button>
            </div>
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
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/60 px-3.5 py-2.5 text-xs">
              <span className="inline-flex items-center gap-2 text-amber-800">
                <Radio className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} />
                Find New Creators — querying platforms in real time
              </span>
              <span className="inline-flex items-center gap-3">
                <span className="tabular-nums text-amber-700" style={{ fontWeight: 600 }}>
                  {revealed} found
                </span>
                {/* JOB-003: stops at the next safe point; creators already found are kept and charged as quoted. */}
                <button
                  onClick={() => liveJob && cancelLive.mutate(liveJob, { onError: (err) => toast.error("Couldn't stop this search", err instanceof Error ? err.message : undefined) })}
                  disabled={stopping || cancelLive.isPending}
                  className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                  style={{ fontWeight: 600 }}
                >
                  {stopping ? "Stopping…" : "Stop"}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {liveCards.map((c, i) => (
              <div key={c.id} className="space-y-1">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${c.discovery.isNew ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}
                  style={{ fontWeight: 600 }}
                >
                  {c.discovery.isNew ? "New" : "Already in MUSHIN"}
                </span>
                <CreatorCard creator={c} index={i} query={query} selected={selected.has(c.id)} onSelect={() => toggleSelect(c.id)} onOpen={() => setProfileId(c.id)} />
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
            {search.data?.fewResults && (
              <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                Only a few creators match.
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
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 transition-colors hover:bg-slate-50"
                    style={{ fontWeight: 500 }}
                  >
                    Sort: {SORT_LABELS[sortKey]} <ChevronDown className="h-3 w-3" />
                  </button>
                  <AnimatePresence>
                    {sortOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                        >
                          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                            <button
                              key={k}
                              onClick={() => {
                                setSortKey(k);
                                setSortOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${
                                sortKey === k ? "text-indigo-700" : "text-slate-700"
                              }`}
                              style={{ fontWeight: 500 }}
                            >
                              {SORT_LABELS[k]}
                              {sortKey === k && <Check className="h-3 w-3" strokeWidth={2.5} />}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((c, i) => (
                  <CreatorCard
                    key={c.id}
                    creator={c}
                    index={i}
                    query={query}
                    selected={selected.has(c.id)}
                    onSelect={() => toggleSelect(c.id)}
                    onOpen={() => setProfileId(c.id)}
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
              <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-600">
                <button
                  onClick={() => goToPage(search.data.prevCursor)}
                  disabled={search.data.prevCursor === null}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40"
                  style={{ fontWeight: 500 }}
                >
                  Previous
                </button>
                <span>
                  Page {search.data.page} of {pageCount(search.data.total, search.data.pageSize)}
                </span>
                <button
                  onClick={() => goToPage(search.data.nextCursor)}
                  disabled={search.data.nextCursor === null}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40"
                  style={{ fontWeight: 500 }}
                >
                  Next
                </button>
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

      {/* Creator profile panel (Vol 4B) */}
      <CreatorProfilePanel
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

function CreatorCard({
  creator,
  index,
  query,
  selected,
  onSelect,
  onOpen,
}: {
  creator: Creator;
  index: number;
  query?: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const contact = creator.contactAvailability ?? (creator.hasContact ? "email_unverified" : "none");
  const contactText = CONTACT_AVAILABILITY_TEXT[contact];
  const ContactIcon = contact === "email_invalid" ? Ban : contact === "phone_unverified" ? Phone : contact === "none" ? Clock : Mail;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
      whileHover={{ y: -2 }}
      className={`group relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-all hover:shadow-md ${
        selected ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"
      }`}
    >
      <button
        onClick={onSelect}
        aria-label="Select"
        className={`absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded border transition-all ${
          selected
            ? "border-indigo-500 bg-indigo-500 text-white"
            : "border-slate-300 bg-white opacity-0 hover:border-slate-400 group-hover:opacity-100"
        }`}
      >
        {selected && <Sparkles className="h-3 w-3" strokeWidth={2.5} />}
      </button>

      <button onClick={onOpen} className="block w-full text-left">
        <div className="flex items-start gap-3">
          <div className="relative flex-shrink-0">
            <img src={creator.avatar} alt={creator.name} className="h-11 w-11 rounded-full object-cover" />
            <span className="absolute -bottom-0.5 -right-0.5">
              <PlatformIcon platform={creator.platform} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <div className="truncate text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>
                {creator.name}
              </div>
              {creator.verified && (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0 fill-indigo-500">
                  <path d="M12 2l2.4 2.1 3.2-.4.8 3.1 2.6 1.9-1.5 2.8L21 15l-3 1-.4 3.2-3.2.3L12 22l-2.4-2.1-3.2.3L6 17l-3-1 .5-3.2L1.9 10 3.5 7.2 3 4.7l3.2-.4L9.6 2 12 4z" />
                </svg>
              )}
            </div>
            <div className="truncate text-xs text-slate-500">@{creator.handle}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
              <MapPin className="h-2.5 w-2.5" strokeWidth={2} />
              {creator.city} · {creator.niche}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric label="Followers" value={creator.followers} />
          <Metric label="ER" value={creator.engagement === null ? "—" : `${creator.engagement.toFixed(1)}%`} />
          <Metric label="Auth." value={creator.authenticity === null ? "—" : String(creator.authenticity)} />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {creator.tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {t}
              </span>
            ))}
          </div>
          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] ${scoreBg(creator.score)}`} style={{ fontWeight: 700 }}>
            <Star className="h-2.5 w-2.5 fill-current" />
            Fit {creator.score}
          </span>
        </div>
      </button>

      {/* Fit sentence + honesty markers (§7.4) */}
      <p className="mt-2.5 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>
        {creator.fitLabel}
      </p>
      {matchSummary(creator.matchedOn) && (
        <p className="mt-1 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }} data-testid="match-reasons">
          <span className="text-slate-600" style={{ fontWeight: 500 }}>Matched: </span>
          {matchSummary(creator.matchedOn)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FreshnessBadge value={creator.followersFreshness} />
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            contact === "email_invalid"
              ? "border-rose-100 bg-rose-50 text-rose-700"
              : contact === "none"
                ? "border-slate-200 bg-slate-50 text-slate-600"
                : "border-sky-100 bg-sky-50 text-sky-700"
          }`}
          style={{ fontWeight: 500 }}
          title={contactText.title}
        >
          <ContactIcon className="h-3 w-3" strokeWidth={2} />
          {contactText.label}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
        <button
          onClick={onOpen}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] text-white transition-colors hover:bg-slate-800"
          style={{ fontWeight: 500 }}
        >
          View profile
          <ArrowUpRight className="h-3 w-3" />
        </button>
        <SaveToListMenu creatorIds={[creator.id]} variant="icon" />
      </div>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="tabular-nums text-slate-900" style={{ fontSize: 12, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50/80 backdrop-blur">
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="w-8 py-3 pl-4" />
            <th className="py-3" style={{ fontWeight: 600 }}>Creator</th>
            <th className="py-3" style={{ fontWeight: 600 }}>Platform</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>Followers</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>ER</th>
            <th className="py-3 text-right" style={{ fontWeight: 600 }}>Auth.</th>
            <th className="py-3 pr-4 text-right" style={{ fontWeight: 600 }}>Fit</th>
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
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Info className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        No creators match your filters
      </div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        No creators match these filters yet. Find new creators live, add a creator you know by their profile link, or widen the filters.
      </p>
      <div className="mt-4 flex gap-2">
        <button onClick={onFindNew} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
          Find new creators
        </button>
        <button onClick={onReset} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Reset filters
        </button>
        <button onClick={onAddByLink} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Add by profile link
        </button>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-red-600 shadow-sm ring-1 ring-red-200">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        Search failed
      </div>
      <p className="mt-1 max-w-md text-sm text-slate-600">
        {message} Searching existing creators never uses credits.
      </p>
      <button onClick={onRetry} className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
        Retry search
      </button>
    </div>
  );
}

/* ─────────────────────── bulk action button ─────────────────────── */

function BulkAction({
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
      className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ fontWeight: 500 }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
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
              <FilterGroup label="City" icon={MapPin}>
                {["Karachi", "Lahore", "Islamabad", "Faisalabad", "Peshawar"].map((c) => (
                  <Chip key={c} active={props.city === c} onClick={() => props.setCity(props.city === c ? null : c)}>
                    {c}
                  </Chip>
                ))}
              </FilterGroup>

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
