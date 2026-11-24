import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, Plus, X } from "lucide-react";
import { useCampaigns } from "../../api/campaigns";
import { SendEmailSection } from "./SendEmail";
import { Spinner } from "./states";

/**
 * "Chat" on a creator (owner, 18 Nov): email the creator through outreach. Every email belongs to a campaign so it is
 * logged in that campaign's outreach, uses the campaign's brand, and counts against the plan's email
 * allowance; the composer is the same confirmed single send as in a campaign. A creator in no campaign yet is added
 * to one first.
 */
export function ChatDrawer({ creator, onClose, onAddToCampaign }: { creator: { id: string; name: string } | null; onClose: () => void; onAddToCampaign: () => void }) {
  const open = creator !== null;
  const campaigns = useCampaigns(creator?.id ?? null, open);
  const joined = (campaigns.data?.campaigns ?? []).filter((c) => c.containsCreator && c.archivedAt === null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const chosen = joined.find((c) => c.id === campaignId) ?? joined[0] ?? null;

  useEffect(() => {
    setCampaignId(null);
  }, [creator?.id]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=alertdialog]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {creator && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 z-[60] bg-[#0b1c30]/40 backdrop-blur-sm" />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={`Chat with ${creator.name}`}
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[520px] flex-col rounded-l-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <MessageCircle aria-hidden className="h-4 w-4 text-[#06B6D4]" />
                <h2 className="text-sm font-bold text-slate-900">Chat with {creator.name}</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {campaigns.isPending ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : campaigns.isError ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  Couldn't load your campaigns. <button className="font-semibold underline" onClick={() => void campaigns.refetch()}>Try again</button>
                </div>
              ) : chosen === null ? (
                <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                  <p>Emails to creators are sent from a campaign, so the conversation is kept with that campaign. Add {creator.name} to a campaign to start.</p>
                  <button onClick={onAddToCampaign} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B112B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F172A]">
                    <Plus aria-hidden className="h-3.5 w-3.5 text-[#57dffe]" /> Add to Campaign
                  </button>
                </div>
              ) : (
                <>
                  {joined.length > 1 && (
                    <label className="block text-xs font-semibold text-slate-700">Campaign
                      <select value={chosen.id} onChange={(e) => setCampaignId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-200">
                        {joined.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                  )}
                  {joined.length === 1 && <p className="text-xs text-slate-500">Sent from the campaign <span className="font-semibold text-slate-700">{chosen.name}</span>.</p>}
                  <SendEmailSection key={chosen.id} campaignId={chosen.id} creatorId={creator.id} creatorName={creator.name} />
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
