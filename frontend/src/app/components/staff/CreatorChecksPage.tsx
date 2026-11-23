import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronLeft, ChevronRight, Flag, Search, ShieldCheck } from "lucide-react";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { CreatorInspector } from "./CreatorInspector";
import { Empty, errText, fmtNum } from "./kit";
import { FILTER_HELP, FILTER_LABEL, FILTERS, REPORT_REASON, TRASH_DAYS, fmtFollowers, staffCreatorListSchema, trashDaysLeft, type Filter, type StaffCreator } from "./creatorTypes";

const PAGE = 50;

/** The line under a creator's name: what needs attention first. */
function note(c: StaffCreator): string {
  if (c.reports > 0) return `Reported: ${c.reportReasons.map((r) => REPORT_REASON[r] ?? r).join(", ") || "no reason given"}`;
  if (c.status === "trashed") return `${c.trashBanned ? "Banned" : "In Trash"}: erased in ${trashDaysLeft(c.trashedAt) ?? TRASH_DAYS} days`;
  if (c.status === "hidden") return `Hidden: ${c.hiddenReason ?? "by staff"}`;
  if (c.isMinor) return `Possible minor${c.minorReason ? `: ${c.minorReason}` : ""}`;
  if (c.organisationCategory) return `Looks like an organisation: ${c.organisationCategory}`;
  const p = c.profiles[0];
  if (p && (p.countryStatus === "unknown" || p.countryStatus === "conflicting")) return `Country ${p.countryStatus}`;
  return [c.nicheMain, c.city].filter(Boolean).join(" · ") || (c.eligible ? "In customer search" : "Not in customer search");
}

/**
 * Creator Checks (owner design, 22 Nov): every creator MUSHIN holds, reported ones first and highlighted, with a queue
 * filter per kind of check and a search; the selected creator opens in the editor on the right.
 */
export function CreatorChecksPage({ canEdit }: { canEdit: boolean }) {
  const [filter, setFilter] = useState<Filter>("qualified");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(text.trim()); setOffset(0); }, 350);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: ["admin", "creators", filter, q, offset],
    queryFn: () => adminRequest(`/admin/v1/catalogue/all?filter=${filter}&q=${encodeURIComponent(q)}&offset=${offset}`, staffCreatorListSchema),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const current = items.find((c) => c.id === selected) ?? items[0] ?? null;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE));
  const page = Math.floor(offset / PAGE) + 1;
  const counts = list.data?.counts;

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <div className="mb-1.5 flex items-center gap-2"><span className="text-[11px] font-extrabold uppercase tracking-wider text-[#00687a]">Moderation &amp; provenance</span></div>
          <h1 className="text-[28px] font-bold leading-9 tracking-tight text-slate-900">Creator Checks</h1>
          <p className="mt-0.5 text-[13.5px] text-slate-600">Every creator MUSHIN holds: check locations, account types and reports, and edit any detail.</p>
        </div>
        {counts && (
          <div className="flex items-center gap-3 self-start rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_8px_rgba(0,0,0,0.02)] xl:self-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#acedff]/70 text-[#00687a]"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <div className="text-[13.5px] font-bold text-slate-900">{fmtNum(counts.country + counts.organisation + counts.minor + counts.assessment)} creators waiting for a check</div>
              <div className="mt-0.5 text-[11.5px] text-slate-600">{fmtNum(counts.reported)} reported by customers · {fmtNum(counts.all)} creators in all</div>
            </div>
          </div>
        )}
      </div>

      {/* Sub-pages (owner, 23 Nov): who qualifies, who cannot be reached, who does not qualify, then the review queues. */}
      <nav aria-label="Creator pages" className="mb-4 space-y-2">
        {[FILTERS.slice(0, 3), FILTERS.slice(3)].map((row, n) => (
          <div key={n} className="flex flex-wrap items-center gap-1.5">
            {n === 1 && <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Review</span>}
            {row.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); setOffset(0); setSelected(null); }}
                className={n === 0
                  ? `rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors ${filter === f ? "bg-[#131b2e] text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`
                  : `rounded-full px-2.5 py-1 text-[11px] transition-colors ${filter === f ? "bg-[#131b2e] font-bold text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {FILTER_LABEL[f]}{counts ? ` (${fmtNum(counts[f])})` : ""}
              </button>
            ))}
          </div>
        ))}
        <p className="text-xs text-slate-500">{FILTER_HELP[filter]}</p>
      </nav>
      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <section aria-label="Creators" className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_8px_rgba(0,0,0,0.03)] lg:w-[380px]">
          <div className="space-y-3 border-b border-slate-100 p-4">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" />
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="Search by name or @handle…" aria-label="Search creators" className="w-full rounded-lg bg-slate-100 py-2 pl-9 pr-3 text-[12.5px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-black/15" />
            </div>
          </div>
          {list.isPending ? <div className="p-4"><LoadingBlock lines={6} /></div> : list.isError ? <div className="p-4"><ErrorState body={errText(list.error)} onRetry={() => void list.refetch()} /></div> : items.length === 0 ? <div className="p-4"><Empty title="No creator matches" /></div> : (
            <ul className={`max-h-[70vh] divide-y divide-slate-100 overflow-y-auto ${list.isFetching ? "opacity-60" : ""}`}>
              {items.map((c) => {
                const on = current?.id === c.id;
                const p = c.profiles[0];
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelected(c.id)} aria-current={on ? "true" : undefined} className={`flex w-full items-start justify-between gap-2 border-l-[3.5px] p-4 text-left transition-colors ${on ? "border-l-[#4cd7f6] bg-[#f0fbfe]" : c.reports > 0 ? "border-l-rose-400 bg-rose-50/40 hover:bg-rose-50" : "border-l-transparent hover:bg-slate-50"}`}>
                      <span className="flex min-w-0 items-start gap-3">
                        <img src={c.avatarUrl ?? ""} alt="" className="h-10 w-10 shrink-0 rounded-full bg-slate-100 object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5"><span className="truncate text-[13.5px] font-bold text-slate-900">{c.displayName}</span>{p?.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-label="Verified" />}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-600">{p ? `@${p.handle} · ${fmtFollowers(p.followers)} followers` : "No profile"}</span>
                          <span className="mt-1.5 line-clamp-2 block text-[11.5px] leading-snug text-slate-600">{note(c)}</span>
                        </span>
                      </span>
                      {c.reports > 0 ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800"><Flag className="h-3 w-3" />{c.reports}</span> : c.status === "hidden" ? <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">Hidden</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 bg-[#f7f9fb] px-4 py-3 text-[11px] text-slate-600">
            <span>{list.data ? `${fmtNum(list.data.total)} creator${list.data.total === 1 ? "" : "s"}` : ""}</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">Page {page} of {pages}</span>
              <button type="button" aria-label="Previous page" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE)); setSelected(null); }} className="rounded border border-slate-200 bg-white p-1 text-slate-900 hover:bg-slate-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => { setOffset(offset + PAGE); setSelected(null); }} className="rounded border border-slate-200 bg-white p-1 text-slate-900 hover:bg-slate-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>
        {current ? <CreatorInspector key={current.id} c={current} canEdit={canEdit} /> : <div className="flex-1"><Empty title="Pick a creator" body="Their details open here." /></div>}
      </div>
    </div>
  );
}
