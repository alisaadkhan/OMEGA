import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { LookupResponse } from "@mushin/contracts";
import { useCreatorLookup } from "../../api/search";

type Match = LookupResponse["matches"][number];

/** Global creator lookup by name, handle or profile URL (SRS §3.1). */
export function Omnibar({ onOpen }: { onOpen: (m: Match) => void }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lookup = useCreatorLookup(debounced);
  const matches = lookup.data?.matches ?? [];

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (m: Match) => {
    onOpen(m);
    setOpen(false);
    setText("");
  };

  return (
    <div ref={box} className="relative w-80">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={2} />
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && matches[0]) pick(matches[0]);
        }}
        placeholder="Look up a creator by name, handle or URL"
        aria-label="Look up a creator"
        className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      {open && debounced.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {lookup.isFetching && matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>}
          {!lookup.isFetching && matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No creator found. Try another spelling or paste their profile link.</div>}
          {matches.map((m) => (
            <button key={m.id} onClick={() => pick(m)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50">
              <span className="text-slate-900" style={{ fontWeight: 600 }}>{m.displayName}</span>
              <span className="text-slate-500">@{m.handle}</span>
              <span className="ml-auto capitalize text-slate-400">{m.platform}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
