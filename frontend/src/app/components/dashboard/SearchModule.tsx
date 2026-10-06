import { useEffect, useMemo, useState } from "react";
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
  Clock,
} from "lucide-react";
import { profiles } from "../../auth/profiles";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";
import { Compare } from "./Compare";
import { getCreatorIntel, fitSentence } from "./data";
import { FreshnessBadge } from "./states";
import { useToast } from "../../lib/toast";
import { CreditConfirm } from "../shared/CreditConfirm";
import { CREDIT_COST } from "../../lib/credits";

/**
 * Volumes 3 + 4A — Search System.
 * Entry, filters, execution, results grid/table, bulk actions,
 * compare, states (loading/empty/no-results/error).
 */

const creators: Creator[] = [
  {
    handle: "sanaa.k",
    name: "Sana Riaz",
    avatar: profiles.sana.avatar,
    platform: "instagram",
    city: "Karachi",
    niche: "Lifestyle · Bridal",
    followers: "412K",
    followersNum: 412000,
    engagement: 5.2,
    authenticity: 92,
    fake: 4,
    score: 89,
    verified: true,
    posts: 428,
    avgLikes: "18.4K",
    avgComments: "620",
    tags: ["#bridal", "#karachi", "#urdu"],
  },
  {
    handle: "ayeshamalik",
    name: "Ayesha Malik",
    avatar: profiles.ayesha.avatar,
    platform: "instagram",
    city: "Lahore",
    niche: "Fashion · Beauty",
    followers: "684K",
    followersNum: 684000,
    engagement: 6.1,
    authenticity: 88,
    fake: 8,
    score: 91,
    verified: true,
    posts: 612,
    avgLikes: "31.2K",
    avgComments: "1.1K",
    tags: ["#fashion", "#lahore", "#pk"],
  },
  {
    handle: "fahad.q",
    name: "Fahad Qureshi",
    avatar: profiles.fahad.avatar,
    platform: "youtube",
    city: "Islamabad",
    niche: "Tech · Reviews",
    followers: "1.2M",
    followersNum: 1200000,
    engagement: 4.4,
    authenticity: 94,
    fake: 3,
    score: 92,
    verified: true,
    posts: 214,
    avgLikes: "42K",
    avgComments: "1.8K",
    tags: ["#tech", "#urdu", "#reviews"],
  },
  {
    handle: "hira.sheikh",
    name: "Hira Sheikh",
    avatar: profiles.hira.avatar,
    platform: "instagram",
    city: "Lahore",
    niche: "Bridal · Wedding",
    followers: "228K",
    followersNum: 228000,
    engagement: 7.8,
    authenticity: 90,
    fake: 5,
    score: 87,
    verified: false,
    posts: 318,
    avgLikes: "14.2K",
    avgComments: "540",
    tags: ["#bridal", "#lahore", "#wedding"],
  },
  {
    handle: "usmantariq",
    name: "Usman Tariq",
    avatar: profiles.usman.avatar,
    platform: "tiktok",
    city: "Karachi",
    niche: "Comedy · Urdu",
    followers: "2.4M",
    followersNum: 2400000,
    engagement: 8.9,
    authenticity: 82,
    fake: 12,
    score: 84,
    verified: true,
    posts: 1240,
    avgLikes: "180K",
    avgComments: "6.2K",
    tags: ["#comedy", "#urdu", "#viral"],
  },
  {
    handle: "bilalhussain",
    name: "Bilal Hussain",
    avatar: profiles.bilal.avatar,
    platform: "youtube",
    city: "Karachi",
    niche: "Food · Travel",
    followers: "512K",
    followersNum: 512000,
    engagement: 5.5,
    authenticity: 91,
    fake: 4,
    score: 88,
    verified: false,
    posts: 186,
    avgLikes: "22K",
    avgComments: "830",
    tags: ["#food", "#karachi", "#travel"],
  },
  {
    handle: "zainab.iqbal",
    name: "Zainab Iqbal",
    avatar: profiles.zainab.avatar,
    platform: "instagram",
    city: "Islamabad",
    niche: "Wellness · Yoga",
    followers: "184K",
    followersNum: 184000,
    engagement: 4.9,
    authenticity: 93,
    fake: 3,
    score: 86,
    verified: false,
    posts: 402,
    avgLikes: "8.9K",
    avgComments: "310",
    tags: ["#wellness", "#yoga", "#islamabad"],
  },
  {
    handle: "ahmed.raza",
    name: "Ahmed Raza",
    avatar: profiles.ahmed.avatar,
    platform: "tiktok",
    city: "Lahore",
    niche: "Finance · Urdu",
    followers: "318K",
    followersNum: 318000,
    engagement: 7.1,
    authenticity: 89,
    fake: 6,
    score: 85,
    verified: false,
    posts: 526,
    avgLikes: "24K",
    avgComments: "980",
    tags: ["#finance", "#urdu", "#pk"],
  },
];

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

type SavedPreset = {
  name: string;
  query: string;
  platform: Platform;
  city: string | null;
  niche: string | null;
  followerBand: string | null;
  minEng: string | null;
  minScore: string | null;
  verifiedOnly: boolean;
  contactOnly: boolean;
  freshOnly: boolean;
};

/**
 * Lightweight natural-language interpretation (§7.2). The prototype has no LLM,
 * so we deterministically parse the query into the same filter state the user can
 * edit — the interpreted chips ARE the filters, shown transparently before applying.
 */
function interpretQuery(q: string): {
  platform?: Platform;
  city?: string;
  niche?: string;
  followerBand?: string;
  minEng?: string;
  verifiedOnly?: boolean;
} {
  const s = q.toLowerCase();
  const out: ReturnType<typeof interpretQuery> = {};
  if (/instagram|insta|ig\b/.test(s)) out.platform = "instagram";
  else if (/tiktok|tik tok/.test(s)) out.platform = "tiktok";
  else if (/youtube|yt\b/.test(s)) out.platform = "youtube";

  const city = CITIES.find((c) => s.includes(c.toLowerCase()));
  if (city) out.city = city;

  const niche = NICHES.find((n) => s.includes(n.toLowerCase()));
  if (niche) out.niche = niche;

  // Follower magnitude, e.g. "50k+", "100k", "1m"
  const m = s.match(/(\d+(?:\.\d+)?)\s*([km])\+?/);
  if (m) {
    const n = parseFloat(m[1]) * (m[2] === "m" ? 1_000_000 : 1_000);
    out.followerBand = n >= 1_000_000 ? "1M+" : n >= 100_000 ? "100K–1M" : "10K–100K";
  }

  const eng = s.match(/(?:engagement|er)\D*(\d+)\s*%|(\d+)\s*%\+?/);
  if (eng) {
    const v = parseInt(eng[1] || eng[2], 10);
    out.minEng = v >= 8 ? "8%+" : v >= 5 ? "5%+" : "2%+";
  }
  if (/verified/.test(s)) out.verifiedOnly = true;
  return out;
}

export function SearchModule() {
  const toast = useToast();
  const [query, setQuery] = useState("bridal Lahore 50k+ engagement 5%+");
  const [platform, setPlatform] = useState<Platform>("all");
  const [city, setCity] = useState<string | null>("Lahore");
  const [niche, setNiche] = useState<string | null>("Bridal");
  const [followerBand, setFollowerBand] = useState<string | null>("10K–100K");
  const [minEng, setMinEng] = useState<string | null>("5%+");
  const [minScore, setMinScore] = useState<string | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [contactOnly, setContactOnly] = useState(false);
  const [freshOnly, setFreshOnly] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [partialFail, setPartialFail] = useState(0);
  const [view, setView] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileHandle, setProfileHandle] = useState<string | null>(null);
  const [mode, setMode] = useState<"fast" | "live">("fast");
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  const [showInterpret, setShowInterpret] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const [presets, setPresets] = useState<SavedPreset[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("mushin.presets") || "[]");
    } catch {
      return [];
    }
  });

  const activeProfile = creators.find((c) => c.handle === profileHandle) ?? null;

  const interpreted = useMemo(() => interpretQuery(query), [query]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const terms = q.split(/\s+/).filter((t) => t.length > 2 && !/^\d/.test(t) && !t.includes("%"));
    const list = creators.filter((c) => {
      if (platform !== "all" && c.platform !== platform) return false;
      if (city && c.city !== city) return false;
      if (niche && !c.niche.toLowerCase().includes(niche.toLowerCase())) return false;
      if (verifiedOnly && !c.verified) return false;
      if (minEng === "2%+" && c.engagement < 2) return false;
      if (minEng === "5%+" && c.engagement < 5) return false;
      if (minEng === "8%+" && c.engagement < 8) return false;
      if (followerBand === "10K–100K" && !(c.followersNum >= 10000 && c.followersNum < 100000)) return false;
      if (followerBand === "100K–1M" && !(c.followersNum >= 100000 && c.followersNum < 1_000_000)) return false;
      if (followerBand === "1M+" && !(c.followersNum >= 1_000_000)) return false;
      if (minScore === "70+" && c.score < 70) return false;
      if (minScore === "85+" && c.score < 85) return false;
      if (minScore === "90+" && c.score < 90) return false;
      if (contactOnly) {
        const email = getCreatorIntel(c).contacts.find((x) => x.kind === "email");
        if (!email || email.trust === "invalid") return false;
      }
      if (freshOnly && getCreatorIntel(c).followersFreshness.value !== "current") return false;
      // Free-text terms (niche/city keywords) narrow further when present.
      if (terms.length) {
        const hay = `${c.name} ${c.handle} ${c.niche} ${c.city} ${c.tags.join(" ")}`.toLowerCase();
        const known = new Set([...CITIES, ...NICHES].map((x) => x.toLowerCase()));
        const meaningful = terms.filter((t) => known.has(t));
        if (meaningful.length && !meaningful.some((t) => hay.includes(t))) return false;
      }
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      if (sortKey === "followers") return b.followersNum - a.followersNum;
      if (sortKey === "engagement") return b.engagement - a.engagement;
      if (sortKey === "freshness") {
        return (
          FRESH_RANK[getCreatorIntel(a).followersFreshness.value] -
          FRESH_RANK[getCreatorIntel(b).followersFreshness.value]
        );
      }
      return b.score - a.score;
    });
    return sorted;
  }, [platform, city, niche, verifiedOnly, minEng, followerBand, minScore, contactOnly, freshOnly, query, sortKey]);

  const visible = status === "streaming" ? filtered.slice(0, revealed) : filtered;

  const runSearch = (searchMode: "fast" | "live" = mode) => {
    setMode(searchMode);
    setSelected(new Set());
    setPartialFail(0);
    if (searchMode === "live") {
      // Live discovery streams results in one at a time (§7.3).
      setStatus("streaming");
      setRevealed(0);
      let shown = 0;
      const total = filtered.length;
      const interval = setInterval(() => {
        shown += 1;
        setRevealed(shown);
        if (shown >= total) {
          clearInterval(interval);
          // Simulate partial enrichment failure on the last live batch.
          const fails = total > 3 ? (total % 2) + 1 : 0;
          setPartialFail(fails);
          setTimeout(() => setStatus(total ? "results" : "empty"), 350);
        }
      }, 420);
      return;
    }
    // Fast path — cached graph, quick progress bar.
    setStatus("loading");
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = p + 8 + Math.random() * 12;
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(() => setStatus(filtered.length ? "results" : "empty"), 200);
          return 100;
        }
        return next;
      });
    }, 90);
  };

  const applyInterpreted = () => {
    if (interpreted.platform) setPlatform(interpreted.platform);
    if (interpreted.city) setCity(interpreted.city);
    if (interpreted.niche) setNiche(interpreted.niche);
    if (interpreted.followerBand) setFollowerBand(interpreted.followerBand);
    if (interpreted.minEng) setMinEng(interpreted.minEng);
    if (interpreted.verifiedOnly) setVerifiedOnly(true);
    toast.info("Applied MUSHIN's reading of your search. Edit the chips anytime.");
    setTimeout(() => runSearch("fast"), 0);
  };

  const savePreset = () => {
    const name = query.trim().slice(0, 40) || "Untitled search";
    const preset: SavedPreset = {
      name, query, platform, city, niche, followerBand, minEng, minScore,
      verifiedOnly, contactOnly, freshOnly,
    };
    const next = [preset, ...presets.filter((p) => p.name !== name)].slice(0, 8);
    setPresets(next);
    try {
      localStorage.setItem("mushin.presets", JSON.stringify(next));
    } catch {
      /* storage unavailable — preset kept in memory only */
    }
    toast.success(`Saved search "${name}".`);
  };

  const loadPreset = (p: SavedPreset) => {
    setQuery(p.query);
    setPlatform(p.platform);
    setCity(p.city);
    setNiche(p.niche);
    setFollowerBand(p.followerBand);
    setMinEng(p.minEng);
    setMinScore(p.minScore);
    setVerifiedOnly(p.verifiedOnly);
    setContactOnly(p.contactOnly);
    setFreshOnly(p.freshOnly);
    setTimeout(() => runSearch("fast"), 0);
  };

  const compareList = creators.filter((c) => selected.has(c.handle)).slice(0, 5);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("mushin.pendingQuery");
      if (pending) {
        sessionStorage.removeItem("mushin.pendingQuery");
        setQuery(pending);
        setShowInterpret(true);
      }
    } catch {
      /* storage unavailable */
    }
    runSearch("fast");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (handle: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  };

  const chips: { label: string; onRemove: () => void }[] = [
    platform !== "all" && { label: platform, onRemove: () => setPlatform("all") },
    city && { label: city, onRemove: () => setCity(null) },
    niche && { label: niche, onRemove: () => setNiche(null) },
    followerBand && { label: followerBand, onRemove: () => setFollowerBand(null) },
    minEng && { label: `ER ${minEng}`, onRemove: () => setMinEng(null) },
    minScore && { label: `Fit ${minScore}`, onRemove: () => setMinScore(null) },
    verifiedOnly && { label: "Verified", onRemove: () => setVerifiedOnly(false) },
    contactOnly && { label: "Has contact", onRemove: () => setContactOnly(false) },
    freshOnly && { label: "Fresh only", onRemove: () => setFreshOnly(false) },
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
  };

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

      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch("fast")}
          placeholder="Find Pakistani creators — e.g. bridal Lahore 50k+ engagement 5%+…"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-40 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs text-white transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md"
            style={{ fontWeight: 500 }}
            title="Search existing creators · uses our cached graph · free"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={2} />
            Search Existing Creators
          </button>
          <button
            onClick={() => setCreditConfirmOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 text-xs text-amber-800 transition-all hover:-translate-y-px hover:shadow-md"
            style={{ fontWeight: 500 }}
            title="Find New Creators · queries platforms in real time · 12 credits"
          >
            <Radio className="h-3.5 w-3.5" strokeWidth={2} />
            Find New Creators
          </button>
        </div>
      </div>

      {/* AI interpretation (§7.2) — transparent, editable reading of the query */}
      <AnimatePresence>
        {showInterpret && Object.keys(interpreted).length > 0 && (
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
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      onClick={applyInterpreted}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-indigo-700"
                      style={{ fontWeight: 500 }}
                    >
                      <Check className="h-3 w-3" strokeWidth={2.5} /> Apply &amp; search
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
                <button onClick={() => setShowInterpret(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/60">
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
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" style={{ fontWeight: 500 }}>
            <Bookmark className="h-3 w-3" strokeWidth={2} /> Saved
          </span>
          {presets.map((p) => (
            <button
              key={p.name}
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
                  {mode === "live" ? "Find New Creators · querying platforms in real time" : "Search Existing Creators · streaming cached results"}
                </span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.2, ease: "linear" }}
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                />
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                <StageDot active={progress > 5}>Validating credits</StageDot>
                <StageDot active={progress > 25}>Queueing</StageDot>
                <StageDot active={progress > 55}>Refreshing creator data</StageDot>
                <StageDot active={progress > 85}>Scoring</StageDot>
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
                icon={Plus}
                label="Add to list"
                onClick={() => toast.success(`Added ${selected.size} creator${selected.size > 1 ? "s" : ""} to your shortlist.`)}
              />
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
              <BulkAction
                icon={Bookmark}
                label="Save"
                onClick={() => toast.success(`Saved ${selected.size} creator${selected.size > 1 ? "s" : ""}.`)}
              />
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
        {status === "streaming" && (
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
              <span className="tabular-nums text-amber-700" style={{ fontWeight: 600 }}>
                {revealed} found
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <div className="min-h-[420px]">
        {status === "loading" && <ResultsSkeleton view={view} />}
        {status === "error" && <ErrorState onRetry={() => runSearch()} />}
        {status === "empty" && <EmptyResults onReset={() => { clearAll(); runSearch("fast"); }} />}

        {(status === "results" || status === "streaming") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                <span className="text-slate-900" style={{ fontWeight: 600 }}>
                  {status === "streaming" ? revealed : filtered.length}
                </span>{" "}
                creator{filtered.length === 1 ? "" : "s"} {status === "streaming" ? "found so far" : "match"}
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
                    key={c.handle}
                    creator={c}
                    index={i}
                    query={query}
                    selected={selected.has(c.handle)}
                    onSelect={() => toggleSelect(c.handle)}
                    onOpen={() => setProfileHandle(c.handle)}
                  />
                ))}
              </div>
            ) : (
              <ResultsTable
                creators={visible}
                selected={selected}
                onSelect={toggleSelect}
                onOpen={(h) => setProfileHandle(h)}
              />
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

      {/* Creator profile panel (Vol 4B) */}
      <CreatorProfilePanel
        creator={activeProfile}
        onClose={() => setProfileHandle(null)}
        onCompare={(c) => {
          setSelected((prev) => new Set(prev).add(c.handle));
          setProfileHandle(null);
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
          onOpen={(h) => {
            setCompareOpen(false);
            setProfileHandle(h);
          }}
        />
      )}

      <CreditConfirm
        open={creditConfirmOpen}
        onOpenChange={setCreditConfirmOpen}
        action="Find New Creators"
        cost={CREDIT_COST.findNew}
        onConfirm={() => runSearch("live")}
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
  if (score >= 60) return "bg-amber-100 text-amber-700";
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
  const intel = getCreatorIntel(creator);
  const email = intel.contacts.find((c) => c.kind === "email");
  const hasContact = email && email.trust !== "invalid";
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
          <Metric label="ER" value={`${creator.engagement.toFixed(1)}%`} />
          <Metric label="Auth." value={`${creator.authenticity}`} />
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
        {fitSentence(creator, query)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FreshnessBadge value={intel.followersFreshness.value} updated={intel.lastUpdated} />
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            hasContact
              ? "border-sky-100 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-slate-50 text-slate-400"
          }`}
          style={{ fontWeight: 500 }}
          title={hasContact ? "A contact channel is on file — trust shown on the profile" : "No usable contact on file yet"}
        >
          {hasContact ? <Mail className="h-3 w-3" strokeWidth={2} /> : <Clock className="h-3 w-3" strokeWidth={2} />}
          {hasContact ? "Contact on file" : "No contact yet"}
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
        <button
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition-colors hover:bg-slate-50"
          title="Add to list"
        >
          <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
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
              key={c.handle}
              layout
              className={`border-t border-slate-100 transition-colors ${selected.has(c.handle) ? "bg-indigo-50/40" : "hover:bg-slate-50/50"}`}
            >
              <td className="pl-4">
                <input
                  type="checkbox"
                  checked={selected.has(c.handle)}
                  onChange={() => onSelect(c.handle)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </td>
              <td className="py-3">
                <button onClick={() => onOpen(c.handle)} className="flex items-center gap-3">
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
              <td className="py-3 text-right tabular-nums text-slate-700">{c.engagement.toFixed(1)}%</td>
              <td className="py-3 text-right tabular-nums text-slate-700">{c.authenticity}</td>
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

function StageDot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full transition-colors ${active ? "bg-emerald-500" : "bg-slate-300"}`} />
      <span className={active ? "text-slate-700" : "text-slate-400"}>{children}</span>
    </span>
  );
}

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

function EmptyResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Info className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        No creators match your filters
      </div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Try broadening your niche, city, or engagement thresholds. Or start from a saved template.
      </p>
      <div className="mt-4 flex gap-2">
        <button onClick={onReset} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
          Reset filters
        </button>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Try suggested template
        </button>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-red-600 shadow-sm ring-1 ring-red-200">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        Search failed
      </div>
      <p className="mt-1 max-w-md text-sm text-slate-600">
        A provider timed out while running your query. Your credits were not charged.
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
}: {
  icon: any;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
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

              <FilterGroup label="Creator Fit score" icon={Star}>
                {["70+", "85+", "90+"].map((s) => (
                  <Chip key={s} active={props.minScore === s} onClick={() => props.setMinScore(props.minScore === s ? null : s)}>
                    Fit {s}
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
