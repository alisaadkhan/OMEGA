import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ExternalLink, ThumbsUp } from "lucide-react";
import { CREATOR_REVIEW_REASON_LABEL, STAFF_EXCLUDE_TYPES, creatorFlagListSchema, type CreatorFlag } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { Header } from "./OpsViews";

type Status = "pending" | "resolved" | "dismissed";
const TYPE_LABEL: Record<(typeof STAFF_EXCLUDE_TYPES)[number], string> = {
  CELEBRITY_PUBLIC_FIGURE: "Celebrity / public figure",
  BRAND_ACCOUNT: "Brand",
  BUSINESS_STORE: "Shop / business",
  MEDIA_PUBLICATION: "Media outlet",
  FAN_PAGE_AGGREGATOR: "Fan page",
  COMPANY_CORPORATE: "Company",
};

/**
 * Creator flags (owner directive 2026-11-15 §3): profiles customers reported from search or Live Discovery. Every staff
 * member can read the queue; admins resolve (after fixing the creator in Catalogue review), exclude the creator as a
 * non-creator account (it leaves search; rules and AI never undo it) or dismiss the report. Submitters stay anonymous.
 */
export function CreatorFlags({ canDecide }: { canDecide: boolean }) {
  const [status, setStatus] = useState<Status>("pending");
  const list = useQuery({ queryKey: ["admin", "creator-flags", status], queryFn: () => adminRequest(`/admin/v1/catalogue/flags?status=${status}`, creatorFlagListSchema) });
  const counts = list.data?.counts;
  return (
    <section className="space-y-4">
      <Header title="Reported Profiles" sub="Profiles customers reported as wrong. Fix the creator in Catalogue review, then resolve; or exclude it here, or dismiss the report." />
      <div role="tablist" aria-label="Flag status" className="flex gap-2">
        {(["pending", "resolved", "dismissed"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`tab ${status === s ? "tab-on" : ""}`}>
            {s === "pending" ? "Open" : s === "resolved" ? "Resolved" : "Dismissed"} {counts ? `(${counts[s]})` : ""}
          </button>
        ))}
      </div>
      {list.isPending && <p className="text-xs text-slate-500" role="status">Loading…</p>}
      {list.isError && <p className="text-xs text-rose-700">Could not load the flags.</p>}
      {list.data && list.data.items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">No {status === "pending" ? "open" : status} flags.</p>}
      <ul className="space-y-3">
        {list.data?.items.map((f) => <FlagRow key={f.id} flag={f} canDecide={canDecide && status === "pending"} />)}
      </ul>
    </section>
  );
}

function FlagRow({ flag, canDecide }: { flag: CreatorFlag; canDecide: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [excludeAs, setExcludeAs] = useState<(typeof STAFF_EXCLUDE_TYPES)[number]>(flag.reason === "not_individual_creator" ? "CELEBRITY_PUBLIC_FIGURE" : "BRAND_ACCOUNT");
  const decide = useMutation({
    mutationFn: (action: "resolve" | "dismiss" | "exclude") =>
      adminRequest(`/admin/v1/catalogue/flags/${flag.id}/decision`, z.object({ status: z.string(), creatorId: z.string() }), { method: "POST", body: { action, note, ...(action === "exclude" ? { excludeAs } : {}) } }),
    onSuccess: (_, action) => {
      toast.success(action === "dismiss" ? "Flag dismissed" : action === "exclude" ? "Creator excluded from search" : "Flag resolved");
      void qc.invalidateQueries({ queryKey: ["admin", "creator-flags"] });
    },
    onError: (err) => toast.error("Not saved", err instanceof Error ? err.message : undefined),
  });
  const ready = note.trim().length >= 3 && !decide.isPending;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4" aria-label={`Flag on ${flag.displayName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {flag.displayName}{" "}
            {flag.url && (
              <a href={flag.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-xs font-normal text-cyan-700 hover:underline">
                @{flag.handle} <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {flag.accountType ?? "Type unknown"}{flag.accountTypeSource ? ` (${flag.accountTypeSource})` : ""} · reported from {flag.sourceMode === "live_discovery" ? "Live Discovery" : "database search"}
            {flag.platform ? ` · ${flag.platform}` : ""} · {new Date(flag.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-800">{flag.openFlags} open flag{flag.openFlags === 1 ? "" : "s"}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800"><ThumbsUp aria-hidden className="h-3 w-3" />{flag.confirmations} confirmed</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-800"><span className="font-semibold">Reason:</span> {CREATOR_REVIEW_REASON_LABEL[flag.reason]}</p>
      {flag.note ? <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700"><span className="font-semibold">What the customer wrote:</span> “{flag.note}”</p> : <p className="mt-1 text-xs text-slate-500">The customer added no note.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {flag.creatorStatus === "hidden" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Hidden from customers</span>}
        <a href={`#checks?filter=all&q=${encodeURIComponent(flag.handle ?? flag.displayName)}`} className="btn btn-violet btn-sm">Open in Creator Checks</a>
      </div>
      {flag.resolution && <p className="mt-2 text-xs text-slate-500">Decision: {flag.resolution}</p>}
      {canDecide && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What was done or why (required)" aria-label={`Decision note for ${flag.displayName}`} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400/40" />
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={!ready} onClick={() => decide.mutate("resolve")} className="btn btn-primary btn-sm">Resolve</button>
            <button disabled={!ready} onClick={() => decide.mutate("dismiss")} className="btn btn-outline btn-sm">Dismiss</button>
            <span className="ml-auto flex items-center gap-1.5">
              <label htmlFor={`exclude-${flag.id}`} className="text-xs text-slate-500">Exclude as</label>
              <select id={`exclude-${flag.id}`} value={excludeAs} onChange={(e) => setExcludeAs(e.target.value as (typeof STAFF_EXCLUDE_TYPES)[number])} className="rounded-md border border-slate-200 px-1.5 py-1 text-xs">
                {STAFF_EXCLUDE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
              <button disabled={!ready} onClick={() => decide.mutate("exclude")} className="btn btn-danger btn-sm">Exclude</button>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
