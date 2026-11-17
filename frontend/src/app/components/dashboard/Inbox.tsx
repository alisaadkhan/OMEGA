import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { inboxSchema, type InboxFilter } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { relative } from "../../lib/time";
import { CHANNEL_LABEL, OUTCOME_LABEL } from "./CampaignOutreach";
import { EmptyState, ErrorState, LoadingBlock } from "./states";

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting for a reply" },
  { id: "replied", label: "Replied" },
  { id: "agreed", label: "Agreed" },
  { id: "declined", label: "Declined" },
];
const TONE = { attempted: "bg-amber-50 text-amber-800", no_response: "bg-slate-100 text-slate-700", replied: "bg-cyan-50 text-cyan-800", agreed: "bg-emerald-50 text-emerald-800", declined: "bg-rose-50 text-rose-700" } as const;

/**
 * Inbox (owner, 17 Nov): every outreach conversation across your campaigns, newest first, from what you logged (emails
 * sent through MUSHIN are logged too). MUSHIN does not read your mailbox; log a reply on the campaign creator.
 */
export function Inbox({ onOpenCampaign }: { onOpenCampaign: (id: string) => void }) {
  const { status } = useAuth();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const q = useQuery({ queryKey: ["inbox", filter], queryFn: () => apiRequest(`/v1/outreach/inbox?filter=${filter}`, inboxSchema), enabled: status === "signedIn" });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">Your outreach conversations across campaigns. Log replies on the campaign creator; MUSHIN doesn't read your mailbox.</p>
      </div>
      <div role="tablist" aria-label="Filter conversations" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filter === f.id ? "bg-[#0A0F24] text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {f.label}{q.data ? <span className="ml-1.5 tabular-nums opacity-70">{q.data.counts[f.id]}</span> : null}
          </button>
        ))}
      </div>
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} /> : q.data.threads.length === 0 ? (
        <EmptyState icon={<InboxIcon className="h-5 w-5" />} title={filter === "all" ? "No conversations yet" : "Nothing here"} body={filter === "all" ? "When you reach out to a creator in a campaign (or send an email through MUSHIN), the conversation appears here." : "No conversation has this status right now."} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          {q.data.threads.map((t, i) => (
            <motion.li key={`${t.campaign.id}:${t.creator.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}>
              <button onClick={() => onOpenCampaign(t.campaign.id)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{t.creator.name}</span>
                    <span className="text-xs text-slate-500">@{t.creator.handle}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[t.last.outcome]}`}>{OUTCOME_LABEL[t.last.outcome]}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-600">{CHANNEL_LABEL[t.last.channel]}{t.last.note ? ` · ${t.last.note}` : ""}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{t.campaign.name} · {t.events} {t.events === 1 ? "entry" : "entries"} · logged by {t.last.loggedBy.name}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                  <time dateTime={t.last.occurredAt}>{relative(t.last.occurredAt)}</time>
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
