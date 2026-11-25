/** Presentational pieces of the search page (split from SearchModule.tsx, 25 Nov); no data fetching here. */
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Instagram,
  Youtube,
  Music2,
  MapPin,
  Users,
  Sparkles,
  Star,
  Bookmark,
  AlertTriangle,
  Info,
} from "lucide-react";
import { type Creator } from "./CreatorProfilePanel";
import type { InterpretResponse } from "@mushin/contracts";
import { extraChips, CITY_FILTER_ENABLED, FILTER_CITIES, type UiFilters, formatEr } from "../../api/search-mapping";
import { erLevel, iqLevel } from "../../api/levels";
import { NICHE_GROUPS, nicheGroupLabel } from "../../api/niche-groups";

export type Platform = "all" | "instagram" | "tiktok" | "youtube";
export type ViewMode = "grid" | "table";
export type SortKey = "relevance" | "followers" | "engagement" | "freshness";

export function PlatformIcon({ platform }: { platform: Creator["platform"] }) {
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

const scoreBg = (score: number) => iqLevel(score).chip;

/* ─────────────────────── table view ─────────────────────── */

export function ResultsTable({
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
        <thead className="sticky top-0 bg-slate-50">
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
              <td className="py-3 text-right tabular-nums">{c.engagement === null ? <span className="text-slate-500">—</span> : <span className={`rounded px-1.5 py-0.5 font-semibold ${erLevel(c.engagement, c.platform).chip}`} title={`${erLevel(c.engagement, c.platform).word} engagement`}>{formatEr(c.engagement)}</span>}</td>
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

export function ResultsSkeleton({ view }: { view: ViewMode }) {
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

/** The conditions the empty search combined, in the user's terms (natural-language master prompt §11). */
export function appliedLabels(f: UiFilters, query: string): string[] {
  const out: string[] = [];
  if (query.trim()) out.push(`words “${query.trim().slice(0, 60)}”`);
  if (f.platform && f.platform !== "all") out.push(`platform ${f.platform}`);
  if (f.city) out.push(`city ${f.city}`);
  if (f.niche) out.push(`niche ${f.niche}`);
  if (f.followerBand) out.push(`followers ${f.followerBand}`);
  if (f.minEng) out.push(`engagement ${f.minEng}`);
  if (f.verifiedOnly) out.push("verified only");
  if (f.contactOnly) out.push("has contact");
  if (f.freshOnly) out.push("fresh only");
  for (const c of extraChips(f.extra)) out.push(c.label);
  return out;
}

export function EmptyResults({ applied, onReset, onAddByLink, onFindNew }: { applied: string[]; onReset: () => void; onAddByLink: () => void; onFindNew: () => void }) {
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
      {applied.length > 1 && (
        <p className="mt-2 max-w-md text-xs text-slate-500">
          This search required all of: {applied.join(", ")}. Removing one of them usually brings results; nothing is changed until you do.
        </p>
      )}
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

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
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

export function TrayButton({
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

export function AdvancedFilterDrawer(props: {
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
            className="fixed inset-0 z-40 bg-slate-900/50"
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
                {NICHE_GROUPS.map((g) => {
                  const active = props.niche !== null && nicheGroupLabel(props.niche) === g.label;
                  return (
                    <Chip key={g.label} active={active} onClick={() => props.setNiche(active ? null : g.label)}>
                      {g.label}
                    </Chip>
                  );
                })}
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
                  <div className="text-xs text-slate-500">Hide creators whose data is 30 days old or more</div>
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

export function FilterGroup({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
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

/** "stated" when the request says it, "inferred" when the AI deduced it; null when the reading did not say. */
export type Basis = "stated" | "inferred" | "kept";
export function basisOf(reading: Pick<InterpretResponse, "understood"> | null, key: string): Basis | null {
  if (!reading) return null;
  const b = reading.understood.basis;
  if (key === "niche" && b["niche"] === "kept") return "kept";
  if (key === "niche") {
    const niches = Object.entries(b).filter(([k]) => k.startsWith("niche:"));
    if (niches.length === 0) return null;
    return niches.every(([, v]) => v === "stated") ? "stated" : "inferred";
  }
  return b[key] ?? null;
}

/** What a follow-up did to the search on screen: refined it (kept / replaced / cleared) or started a new one. */
export function FollowUpNote({ f, onAlone }: { f: NonNullable<InterpretResponse["followUp"]>; onAlone: () => void }) {
  const list = (xs: string[]) => xs.join(", ");
  return (
    <p className="mt-1.5 rounded-md bg-white/70 px-2 py-1.5 text-[11px] text-slate-600">
      {f.mode === "refine" ? (
        <>
          <span style={{ fontWeight: 600 }}>Refining your search “{f.text}”.</span>
          {f.kept.length > 0 && <> Kept: {list(f.kept)}.</>}
          {f.replaced.length > 0 && <span className="text-amber-700"> Changed: {list(f.replaced)}.</span>}
          {f.cleared.length > 0 && <> Removed: {list(f.cleared)}.</>}{" "}
          <button type="button" onClick={onAlone} className="text-indigo-700 underline-offset-2 hover:underline">Search this on its own instead</button>
        </>
      ) : (
        <><span style={{ fontWeight: 600 }}>New search.</span> Your earlier filters are not carried over.</>
      )}
    </p>
  );
}

export function InterpChip({ children, basis = null }: { children: React.ReactNode; basis?: Basis | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] capitalize text-indigo-700"
      style={{ fontWeight: 500 }}
      title={basis === "stated" ? "Taken from your words" : basis === "inferred" ? "Inferred by the AI: check it before applying" : basis === "kept" ? "Kept from your current search" : undefined}
    >
      {children}
      {basis && <span className={`normal-case ${basis === "inferred" ? "text-amber-600" : "text-indigo-400"}`}>· {basis === "stated" ? "you said" : basis === "kept" ? "kept" : "inferred"}</span>}
    </span>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
