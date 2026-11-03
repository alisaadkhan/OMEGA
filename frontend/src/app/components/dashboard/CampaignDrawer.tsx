import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, PlusCircle, Search, X } from "lucide-react";
import { useAddToCampaign, useCampaigns, useCreateCampaign } from "../../api/campaigns";
import { useToast } from "../../lib/toast";
import { Spinner } from "./states";
import { CreatorContext, type DrawerCreator } from "./ShortlistDrawer";

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-cyan-50 text-cyan-700 border border-cyan-200" },
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  paused: { label: "Paused", cls: "bg-amber-50 text-amber-700" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
};

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * "Add to Campaign" side panel. Adding only: removing a creator from a campaign deletes their progress there, so that
 * stays inside the campaign with a confirmation. Campaigns that already include the creator show as added.
 */
export function CampaignDrawer({ open, creators, onClose, onGoToCampaigns }: { open: boolean; creators: DrawerCreator[]; onClose: () => void; onGoToCampaigns?: () => void }) {
  const single = creators.length === 1 ? (creators[0] ?? null) : null;
  const campaigns = useCampaigns(single?.id ?? null, open);
  const add = useAddToCampaign();
  const create = useCreateCampaign();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setPicked(new Set());
      setFilter("");
      setCreating(false);
      setNewName("");
      setNameError(null);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const all = (campaigns.data?.campaigns ?? []).filter((c) => c.archivedAt === null && c.status !== "archived");
  const shown = all.filter((c) => `${c.name} ${c.client}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const who = single ? single.name : `${creators.length} creators`;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function createCampaign() {
    const n = newName.trim();
    if (!n) {
      setNameError("Give the new campaign a name.");
      return;
    }
    setNameError(null);
    create.mutate(
      { name: n },
      {
        onSuccess: (c) => {
          setNewName("");
          setCreating(false);
          setPicked((prev) => new Set(prev).add(c.id));
          toast.success(`Campaign "${c.name}" created`, "It's selected below as a draft. Press Add to include the creator.");
        },
        onError: (err) => toast.error("Couldn't create the campaign", err instanceof Error ? err.message : undefined),
      },
    );
  }

  async function submit() {
    if (picked.size === 0) return;
    setSaving(true);
    let added = 0;
    let already = 0;
    try {
      for (const id of picked) {
        const r = await add.mutateAsync({ id, creatorIds: creators.map((c) => c.id) });
        added += r.added;
        already += r.alreadyInCampaign;
      }
      const target = picked.size === 1 ? (all.find((c) => picked.has(c.id))?.name ?? "the campaign") : `${picked.size} campaigns`;
      toast.toast({
        level: "success",
        title: added > 0 ? `${who} added to ${target}` : `${who} ${creators.length === 1 ? "was" : "were"} already in ${target}`,
        description: added > 0 && already > 0 ? `${already} ${already === 1 ? "was" : "were"} already there.` : "Terms and deliverables are confirmed inside the campaign.",
        action: onGoToCampaigns ? { label: "View campaigns →", onClick: onGoToCampaigns } : undefined,
      });
      onClose();
    } catch (err) {
      toast.error("Couldn't add to the campaign", err instanceof Error ? err.message : "Some campaigns may not have been updated. Open the panel again to check.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 z-[60] bg-[#0b1c30]/40 backdrop-blur-sm" />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Add to campaign"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[480px] flex-col rounded-l-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
              <div className="min-w-0 flex-1 space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700">Adding to campaign</span>
                <CreatorContext creators={creators} />
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-6 pb-2 pt-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search campaigns…" aria-label="Search campaigns" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30" />
              </div>
              <button onClick={() => setCreating((v) => !v)} aria-expanded={creating} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-slate-50 py-2.5 text-sm font-medium text-[#0b1c30] transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                <PlusCircle className="h-4 w-4 text-[#06B6D4] transition-transform group-hover:scale-110" /> Create New Campaign
              </button>
              <AnimatePresence initial={false}>
                {creating && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createCampaign();
                    }}
                  >
                    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                      <label htmlFor="new-campaign" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Campaign name</label>
                      <input id="new-campaign" value={newName} maxLength={120} autoFocus onChange={(e) => { setNewName(e.target.value); if (nameError) setNameError(null); }} placeholder="e.g. Summer lawn launch" aria-invalid={nameError ? true : undefined} className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${nameError ? "border-rose-500 focus:ring-rose-500/20" : "border-slate-200 focus:ring-cyan-400/30"}`} />
                      {nameError && <p className="text-xs text-rose-600 animate-in fade-in slide-in-from-top-1 duration-200">{nameError}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Starts as a draft. Add dates and budget later.</span>
                        <button type="submit" disabled={create.isPending} className="rounded-full bg-[#0b1c30] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#131b2e] focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50">
                          {create.isPending ? "Creating…" : "Create"}
                        </button>
                      </div>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-6 py-3">
              {campaigns.isPending ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : campaigns.isError ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  Couldn't load your campaigns. <button className="font-semibold underline" onClick={() => void campaigns.refetch()}>Try again</button>
                </div>
              ) : shown.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">{all.length === 0 ? "No campaigns yet. Create your first one above." : "No campaign matches that search."}</p>
              ) : (
                shown.map((c) => {
                  const inIt = c.containsCreator === true;
                  const on = inIt || picked.has(c.id);
                  const st = STATUS[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-600" };
                  const when = c.startDate && c.endDate ? `${fmtDay(c.startDate)} – ${fmtDay(c.endDate)}` : c.startDate ? `From ${fmtDay(c.startDate)}` : "No dates yet";
                  return (
                    <button key={c.id} type="button" role="checkbox" aria-checked={on} disabled={inIt} onClick={() => toggle(c.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:cursor-default ${on ? "bg-[#acedff]/25 hover:bg-[#acedff]/35" : "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-slate-100 hover:bg-slate-50"}`}>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${on ? "bg-[#0b1c30] text-white" : "border border-slate-300 bg-slate-100"}`}>{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900">{c.name}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${st.cls}`}>{st.label}</span>
                          </span>
                          <span className="block truncate text-xs text-slate-500">{c.creatorCount} creator{c.creatorCount === 1 ? "" : "s"} · {when}</span>
                        </span>
                      </span>
                      {inIt ? <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Already added</span> : picked.has(c.id) ? <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-cyan-700">Selected</span> : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="space-y-2 border-t border-slate-100 px-6 py-5">
              <button onClick={() => void submit()} disabled={picked.size === 0 || saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b1c30] py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-px hover:bg-[#131b2e] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:translate-y-0 disabled:opacity-50">
                {saving ? "Adding…" : picked.size === 0 ? "Select a campaign" : `Add to ${picked.size} campaign${picked.size === 1 ? "" : "s"}`}
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-xs text-slate-500">Creator terms and deliverables are confirmed inside the campaign.</p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
