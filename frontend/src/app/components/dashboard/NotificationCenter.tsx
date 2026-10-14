import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useRecentActivity } from "../../api/activity";
import { useAuth } from "../../auth/AuthContext";
import { ActivityRow } from "./ActivityLog";
import { Spinner } from "./states";

/**
 * The bell: recent workspace activity from the server (canonical spec page 15). "New" means newer than the last time
 * you opened it in this browser; that marker is a per-viewer convenience, so losing it only re-highlights old items.
 */
export function NotificationCenter({ onSeeAll }: { onSeeAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const key = `mushin.activitySeen.${user?.id ?? "anon"}`;
  const [seen, setSeen] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const recent = useRecentActivity(15);
  const events = recent.data?.events ?? [];
  // Your own actions are not news to you; a finished Find New Creators run always is.
  const fresh = events.filter((e) => e.at > seen && (e.actor?.id !== user?.id || e.kind === "live_run_finished")).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle() {
    if (!open && events[0]) {
      setSeen(events[0].at);
      try {
        localStorage.setItem(key, events[0].at);
      } catch {
        /* storage unavailable: the marker only lasts this session */
      }
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-all hover:-translate-y-px hover:shadow-sm"
        aria-label={`Activity${fresh ? `, ${fresh} new` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {fresh > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white" style={{ fontWeight: 700 }}>{fresh}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[26rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="dialog" aria-label="Recent activity">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-900" style={{ fontWeight: 600 }}>Recent activity</div>
          {recent.isPending ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : recent.isError ? (
            <div className="px-4 py-4 text-xs text-red-700">Couldn't load activity. <button className="underline" onClick={() => void recent.refetch()}>Retry</button></div>
          ) : events.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">No recorded activity yet.</div>
          ) : (
            <ol className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{events.map((e) => <ActivityRow key={e.id} e={e} />)}</ol>
          )}
          {onSeeAll && (
            <button onClick={() => { setOpen(false); onSeeAll(); }} className="w-full border-t border-slate-100 py-2 text-xs text-indigo-600 hover:bg-slate-50" style={{ fontWeight: 600 }}>
              See all activity
            </button>
          )}
        </div>
      )}
    </div>
  );
}
