import { AnimatePresence, motion } from "motion/react";
import { X, ArrowUpRight, Info } from "lucide-react";
import type { Creator } from "./CreatorProfilePanel";
import { FreshnessBadge } from "./states";

/**
 * Compare creators — spec §9.
 * 2–5 creators, campaign criteria pinned at the top, identical fields per
 * creator, meaningful differences highlighted, no universal "winner".
 */

type Row = {
  label: string;
  get: (c: Creator) => string;
  /** Which creators hold the best value for this row (by creator id) — highlighted. */
  best?: (list: Creator[]) => Set<string>;
};

function bestByMax(pick: (c: Creator) => number) {
  return (list: Creator[]) => {
    const max = Math.max(...list.map(pick));
    return new Set(list.filter((c) => pick(c) === max).map((c) => c.id));
  };
}

const ROWS: Row[] = [
  { label: "Platform", get: (c) => c.platform },
  { label: "City", get: (c) => c.city },
  { label: "Niche", get: (c) => c.niche },
  { label: "Followers", get: (c) => c.followers, best: bestByMax((c) => c.followersNum) },
  { label: "Engagement", get: (c) => `${c.engagement.toFixed(1)}%`, best: bestByMax((c) => c.engagement) },
  { label: "Authenticity", get: (c) => (c.authenticity === null ? "Not yet assessed" : `${c.authenticity}`), best: bestByMax((c) => c.authenticity ?? -1) },
  { label: "Flagged interactions", get: (c) => (c.fake === null ? "—" : `${c.fake}%`), best: bestByMax((c) => -(c.fake ?? 100)) },
  { label: "Creator Fit", get: (c) => `${c.score}`, best: bestByMax((c) => c.score) },
];

export function Compare({
  creators,
  criteria,
  onClose,
  onOpen,
}: {
  creators: Creator[];
  criteria?: string;
  onClose: () => void;
  onOpen?: (id: string) => void;
}) {
  const list = creators.slice(0, 5);
  const open = list.length >= 2;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[96%] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            {/* Header + pinned campaign criteria */}
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-slate-900" style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>
                    Compare {list.length} creators
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <Info className="h-3 w-3" strokeWidth={2} />
                    Campaign criteria: {criteria || "No campaign selected — comparing on general fit"}
                  </div>
                </div>
                <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr>
                    <th className="w-40 border-b border-slate-100 px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-400" style={{ fontWeight: 600 }}>
                      Creator
                    </th>
                    {list.map((c) => (
                      <th key={c.id} className="min-w-[160px] border-b border-l border-slate-100 px-4 py-3 text-left align-top">
                        <div className="flex items-center gap-2">
                          <img src={c.avatar} alt={c.name} className="h-9 w-9 rounded-full object-cover" />
                          <div className="min-w-0">
                            <div className="truncate text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                            <div className="truncate text-[11px] text-slate-500">@{c.handle}</div>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const best = row.best ? row.best(list) : new Set<string>();
                    return (
                      <tr key={row.label} className="border-b border-slate-50">
                        <td className="px-6 py-2.5 text-xs text-slate-500" style={{ fontWeight: 500 }}>{row.label}</td>
                        {list.map((c) => {
                          const isBest = best.has(c.id) && list.length > 1;
                          return (
                            <td
                              key={c.id}
                              className={`border-l border-slate-100 px-4 py-2.5 text-xs capitalize ${
                                isBest ? "bg-emerald-50/60 text-emerald-800" : "text-slate-700"
                              }`}
                              style={{ fontWeight: isBest ? 600 : 400 }}
                            >
                              {row.get(c)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* Freshness row */}
                  <tr className="border-b border-slate-50">
                    <td className="px-6 py-2.5 text-xs text-slate-500" style={{ fontWeight: 500 }}>Data freshness</td>
                    {list.map((c) => (
                      <td key={c.id} className="border-l border-slate-100 px-4 py-2.5">
                        <FreshnessBadge value={c.followersFreshness} />
                      </td>
                    ))}
                  </tr>

                  {/* Contact trust row */}
                  <tr className="border-b border-slate-50">
                    <td className="px-6 py-2.5 text-xs text-slate-500" style={{ fontWeight: 500 }}>Contact</td>
                    {list.map((c) => (
                      <td key={c.id} className="border-l border-slate-100 px-4 py-2.5 text-xs text-slate-700">
                        {c.hasContact ? "On file" : "—"}
                      </td>
                    ))}
                  </tr>

                  {/* Recommendation row */}
                  <tr>
                    <td className="px-6 py-3 text-xs text-slate-500 align-top" style={{ fontWeight: 500 }}>Best-fit note</td>
                    {list.map((c) => {
                      return (
                        <td key={c.id} className="border-l border-slate-100 px-4 py-3 align-top">
                          <div className="text-[11px] text-slate-700" style={{ fontWeight: 600 }}>{c.fitLabel || "—"}</div>
                          {onOpen && (
                            <button
                              onClick={() => onOpen(c.id)}
                              className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:text-indigo-700"
                              style={{ fontWeight: 600 }}
                            >
                              Open profile <ArrowUpRight className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-[11px] text-slate-500">
              Highlighted cells show the strongest value for each row. A creator that fits one campaign best may not be best for another — review against your criteria.
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
