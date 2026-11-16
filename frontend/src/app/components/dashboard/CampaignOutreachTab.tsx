import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mail, MessageSquareText, Plus, Search, Send } from "lucide-react";
import type { CampaignDetail } from "@mushin/contracts";
import { useOutreachLog } from "../../api/campaigns";
import { avatarFallback, toCreator } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { Button, EASE, EmptyState, Segmented, Skeleton } from "../../ui/kit";
import { cn } from "../ui/utils";
import { OUTCOME_LABEL, OutreachPanel } from "./CampaignOutreach";

const CHANNEL = { email: "Email", phone: "Phone call", whatsapp: "WhatsApp", instagram: "Instagram DM", tiktok: "TikTok DM", youtube: "YouTube", other: "Other" } as const;

/** Outreach (owner design 2026-11-16): conversations on the left, the logged history on the right, write or log from here. */
export function CampaignOutreachTab({ c, initialId = null }: { c: CampaignDetail; initialId?: string | null }) {
  const [filter, setFilter] = useState<"all" | "contacted" | "waiting">("all");
  const [find, setFind] = useState("");
  const members = [...c.creators].sort((a, b) => (b.lastOutreach?.occurredAt ?? b.addedAt).localeCompare(a.lastOutreach?.occurredAt ?? a.addedAt));
  const shown = members.filter((m) => (filter === "all" || (filter === "contacted" ? m.lastOutreach : !m.lastOutreach)) && `${m.creator.displayName} ${m.creator.handle}`.toLowerCase().includes(find.trim().toLowerCase()));
  const [openId, setOpenId] = useState<string | null>(initialId ?? members[0]?.creator.id ?? null);
  const [writing, setWriting] = useState(false);
  const active = c.creators.find((m) => m.creator.id === openId) ?? null;
  const log = useOutreachLog(c.id, active?.creator.id ?? null);
  if (c.creators.length === 0) return <EmptyState icon={Mail} title="No creators to contact yet" body="Add creators to this campaign, then log or write outreach to them here." />;
  const contacted = c.creators.filter((m) => m.lastOutreach).length;
  const replied = c.creators.filter((m) => m.lastOutreach && (m.lastOutreach.outcome === "replied" || m.lastOutreach.outcome === "agreed")).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 rounded-lg bg-surface-low px-4 py-1.5 text-[10px] font-semibold text-ink-soft">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-dim" />Contacted: <strong className="text-on">{contacted}</strong></span>
          <span className="text-line">/</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#006172]" />Replied: <strong className="text-on">{replied}{contacted ? ` (${Math.round((replied / contacted) * 100)}%)` : ""}</strong></span>
        </div>
        <Button icon={Plus} disabled={!active} onClick={() => setWriting(true)}>New Outreach</Button>
      </div>
      <div className="flex min-h-[620px] flex-col overflow-hidden rounded-xl bg-white shadow-sm lg:flex-row">
        <section className="flex w-full shrink-0 flex-col lg:w-96" aria-label="Conversations">
          <div className="space-y-2 border-b border-surface-mid/60 p-3">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-faint" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search creators..." aria-label="Search conversations" className="w-full rounded-lg bg-surface-low/50 py-2 pl-9 pr-3 text-xs text-on placeholder:text-line focus:outline-none focus:ring-1 focus:ring-teal" /></div>
            <Segmented<"all" | "contacted" | "waiting"> dark value={filter} onChange={setFilter} options={[{ id: "all", label: `All (${members.length})` }, { id: "contacted", label: "Contacted" }, { id: "waiting", label: "Not yet" }]} />
          </div>
          <div className="flex-1 divide-y divide-surface-mid/40 overflow-y-auto">
            {shown.map((m, i) => {
              const on = m.creator.id === openId;
              return (
                <motion.button key={m.creator.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} onClick={() => setOpenId(m.creator.id)} className={cn("flex w-full items-center gap-3 p-3 text-left transition-colors", on ? "border-l-4 border-l-teal bg-cyan-soft/10" : "border-l-4 border-l-transparent hover:bg-surface-low/40")}>
                  <span className="relative shrink-0">
                    <img src={toCreator(m.creator).avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-9 w-9 rounded-full object-cover" />
                    {m.lastOutreach?.outcome === "replied" && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-cyan-dim ring-2 ring-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className={cn("truncate text-[13px] text-on", on ? "font-semibold" : "font-medium")}>{m.creator.displayName}</span><span className="shrink-0 text-[11px] tabular-nums text-faint">{m.lastOutreach ? relative(m.lastOutreach.occurredAt) : ""}</span></span>
                    <span className="mt-0.5 block truncate text-xs text-ink-soft">{m.lastOutreach ? `${OUTCOME_LABEL[m.lastOutreach.outcome]} · ${CHANNEL[m.lastOutreach.channel]}` : "No outreach logged yet"}</span>
                  </span>
                </motion.button>
              );
            })}
            {shown.length === 0 && <p className="p-6 text-center text-xs text-ink-soft">No conversation matches.</p>}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col bg-surface lg:border-l lg:border-surface-mid/40">
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div key={active.creator.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22, ease: EASE }} className="flex flex-1 flex-col">
                <div className="flex flex-col gap-1 border-b border-surface-mid/40 bg-white px-6 py-4">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Conversation with</span>
                  <h2 className="text-lg font-semibold tracking-tight text-on">{active.creator.displayName} <span className="text-sm font-normal text-ink-soft">@{active.creator.handle}</span></h2>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
                  {log.isPending ? (
                    <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
                  ) : (log.data?.events.length ?? 0) === 0 ? (
                    <div className="flex flex-col items-center py-16 text-center">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-soft/20 text-teal"><MessageSquareText className="h-6 w-6" /></span>
                      <p className="text-sm font-semibold text-on">No outreach logged yet</p>
                      <p className="mt-1 max-w-xs text-xs text-ink-soft">Write an email from a template, or log a call or message you already sent.</p>
                    </div>
                  ) : (
                    log.data!.events.map((e, i) => (
                      <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="flex max-w-3xl flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">{e.loggedBy.name.slice(0, 2).toUpperCase()}</span><span className="text-[15px] font-medium text-on">{e.loggedBy.name}</span></span>
                          <span className="text-[10px] font-semibold tabular-nums text-faint">{new Date(e.occurredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                        </div>
                        <div className="ml-9 space-y-1.5 rounded-xl border border-surface-mid/40 bg-white p-3 text-[13px] leading-relaxed text-on shadow-sm">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-pale/40 px-2 py-0.5 text-[10px] font-semibold text-teal-deep">{OUTCOME_LABEL[e.outcome]} · {CHANNEL[e.channel]}</span>
                          {e.note && <p className="whitespace-pre-wrap">{e.note}</p>}
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
                <div className="border-t border-surface-mid/40 bg-white p-4">
                  <button onClick={() => setWriting(true)} className="flex w-full items-center justify-between rounded-xl border border-surface-mid/60 px-4 py-3 text-left text-[13px] text-line transition-all hover:border-teal/40 hover:shadow-sm">
                    Write an email or log outreach to {active.creator.displayName}…
                    <span className="flex items-center gap-1.5 rounded-lg bg-shell px-4 py-1.5 text-[11px] font-semibold text-white">Open <Send className="h-3.5 w-3.5" /></span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-10 text-sm text-ink-soft">Choose a creator to see the conversation.</div>
            )}
          </AnimatePresence>
        </section>
      </div>
      {writing && active && <OutreachPanel campaignId={c.id} campaign={{ name: c.name, client: c.client }} member={active} onClose={() => setWriting(false)} />}
    </div>
  );
}
