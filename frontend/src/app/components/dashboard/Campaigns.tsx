import { useState } from "react";
import { ExportButton } from "./ExportButton";
import { CalendarDays, Megaphone, Plus, Users } from "lucide-react";
import type { CampaignSummary, CreateCampaign } from "@mushin/contracts";
import { rupees, toMinor, useCampaigns, useCreateCampaign } from "../../api/campaigns";
import { relative } from "../../lib/time";
import { useToast } from "../../lib/toast";
import { CampaignDetail } from "./CampaignDetail";
import type { Creator } from "./CreatorProfilePanel";
import { EmptyState, ErrorState, LoadingBlock } from "./states";

/**
 * Campaign management (canonical frontend spec page 10): a minimal pipeline (Identified → Contacted → Negotiating →
 * Confirmed; Declined is an outcome) with creator membership, fees in PKR and a manual outreach log. Every change is
 * saved on the server. Tasks/reminders, sequences and automated sending are not part of the MVP.
 */
export function Campaigns({ onOpenCreator, onGoToSearch }: { onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <CampaignDetail id={openId} onBack={() => setOpenId(null)} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} /> : <CampaignIndex onOpen={setOpenId} />;
}

export const STATUS_LABEL = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" } as const;
export const STATUS_TONE = { draft: "bg-slate-100 text-slate-700", active: "bg-emerald-50 text-emerald-700", paused: "bg-amber-50 text-amber-800", completed: "bg-indigo-50 text-indigo-700", archived: "bg-slate-100 text-slate-600" } as const;
export const STAGE_LABEL = { identified: "Identified", contacted: "Contacted", negotiating: "Negotiating", confirmed: "Confirmed" } as const;

/** `archived` appears only when editing an archived campaign (archiving and restoring have their own buttons). */
export type CampaignFormValue = Required<Omit<CreateCampaign, "budgetMinor" | "status">> & { budgetMinor: number | null; status: keyof typeof STATUS_LABEL };

export function CampaignForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial?: Partial<CampaignFormValue>; submitLabel: string; busy: boolean; onSubmit: (v: CampaignFormValue) => void; onCancel: () => void }) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    status: initial?.status ?? "draft",
    platform: initial?.platform ?? null,
    client: initial?.client ?? "",
    objective: initial?.objective ?? "",
    notes: initial?.notes ?? "",
    budget: initial?.budgetMinor == null ? "" : String(Math.round(initial.budgetMinor / 100)),
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const datesBad = v.startDate !== "" && v.endDate !== "" && v.endDate < v.startDate;
  const input = "mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none";
  const label = "block text-xs text-slate-600";
  return (
    <form
      className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.name.trim() || datesBad) return;
        onSubmit({
          name: v.name.trim(),
          status: v.status,
          platform: v.platform,
          client: v.client.trim(),
          objective: v.objective.trim(),
          notes: v.notes.trim(),
          budgetMinor: toMinor(v.budget),
          startDate: v.startDate || null,
          endDate: v.endDate || null,
        });
      }}
    >
      <label className={`${label} sm:col-span-2`} style={{ fontWeight: 600 }}>
        Campaign name
        <input autoFocus required maxLength={120} value={v.name} onChange={set("name")} className={input} />
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        Client <span className="text-slate-500" style={{ fontWeight: 400 }}>(optional)</span>
        <input maxLength={120} value={v.client} onChange={set("client")} className={input} />
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        Status
        <select value={v.status} onChange={(e) => setV((x) => ({ ...x, status: e.target.value as CampaignFormValue["status"] }))} className={input}>
          {Object.entries(STATUS_LABEL).filter(([k]) => k !== "archived" || initial?.status === "archived").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        Platform
        <select value={v.platform ?? ""} onChange={(e) => setV((x) => ({ ...x, platform: (e.target.value || null) as CampaignFormValue["platform"] }))} className={input}>
          <option value="">Not set</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        Budget (PKR) <span className="text-slate-500" style={{ fontWeight: 400 }}>(optional)</span>
        <input inputMode="numeric" value={v.budget} onChange={set("budget")} placeholder="e.g. 500000" className={input} />
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        Start date
        <input type="date" value={v.startDate} onChange={set("startDate")} className={input} />
      </label>
      <label className={label} style={{ fontWeight: 600 }}>
        End date
        <input type="date" value={v.endDate} onChange={set("endDate")} className={input} aria-invalid={datesBad} aria-describedby={datesBad ? "dates-error" : undefined} />
        {datesBad && <span id="dates-error" className="mt-1 block text-[11px] text-red-600">The end date must be on or after the start date.</span>}
      </label>
      <label className={`${label} sm:col-span-2`} style={{ fontWeight: 600 }}>
        Objective <span className="text-slate-500" style={{ fontWeight: 400 }}>(optional)</span>
        <textarea rows={2} maxLength={1000} value={v.objective} onChange={set("objective")} className={input} />
      </label>
      <label className={`${label} sm:col-span-2`} style={{ fontWeight: 600 }}>
        Notes <span className="text-slate-500" style={{ fontWeight: 400 }}>(optional)</span>
        <textarea rows={2} maxLength={4000} value={v.notes} onChange={set("notes")} className={input} />
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy || !v.name.trim() || datesBad} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{submitLabel}</button>
      </div>
    </form>
  );
}

function CampaignCard({ c, onOpen }: { c: CampaignSummary; onOpen: () => void }) {
  const open = c.creatorCount - c.declinedCount;
  // MUSHIN design (2026-10-27): client label, name and status; a figures bar (budget, fees agreed, creators); the
  // pipeline bar along the bottom. Only the campaign's own records are shown (no ROAS: MUSHIN does not measure sales).
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()} className="flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-shadow hover:shadow-[0_12px_32px_-16px_rgba(15,23,42,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <div className="flex-1 p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{c.client || "No client"}{c.platform ? ` · ${c.platform}` : ""}</div>
            <div className="mt-1 truncate text-[18px] font-semibold tracking-[-0.015em] text-slate-900">{c.name}</div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-4 py-3 text-center">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Budget</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-900">{c.budgetMinor === null ? "—" : rupees(c.budgetMinor)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Agreed</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-indigo-700" title="Fees marked agreed">{rupees(c.agreedFeesMinor)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Creators</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-slate-900"><Users aria-hidden className="h-3.5 w-3.5 text-slate-500" /> {c.creatorCount}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-800">{c.creatorCount === 0 ? "No creators added yet" : `${c.stageCounts.confirmed} of ${open} confirmed${c.declinedCount ? ` · ${c.declinedCount} declined` : ""}`}</span>
          <span className="text-slate-500">Updated {relative(c.updatedAt)}</span>
        </div>
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><CalendarDays aria-hidden className="h-3 w-3" /> {c.startDate ?? "No start"} → {c.endDate ?? "No end"}</div>
      </div>
      <div className="flex h-1.5 bg-slate-100" aria-label={`${c.stageCounts.confirmed} of ${open} open creators confirmed`}>
        {(["identified", "contacted", "negotiating", "confirmed"] as const).map((s, i) => (
          <div key={s} style={{ width: open ? `${(c.stageCounts[s] / open) * 100}%` : 0 }} className={["bg-slate-300", "bg-sky-300", "bg-amber-300", "bg-indigo-500"][i]} />
        ))}
      </div>
    </div>
  );
}

function CampaignIndex({ onOpen }: { onOpen: (id: string) => void }) {
  const campaigns = useCampaigns();
  const create = useCreateCampaign();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">Track creators from first contact to confirmed, with fees and an outreach log.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton kind="campaigns" />
          <button onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" /> New campaign
          </button>
        </div>
      </div>
      {creating && (
        <CampaignForm
          submitLabel="Create campaign"
          busy={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(v) => create.mutate({ ...v, status: v.status === "archived" ? "draft" : v.status }, { onSuccess: (c) => { setCreating(false); toast.success(`Created ${c.name}`); onOpen(c.id); }, onError: (err) => toast.error("Couldn't create the campaign", err instanceof Error ? err.message : undefined) })}
        />
      )}
      {campaigns.isPending ? (
        <LoadingBlock lines={4} />
      ) : campaigns.isError ? (
        <ErrorState body={campaigns.error instanceof Error ? campaigns.error.message : undefined} onRetry={() => void campaigns.refetch()} />
      ) : campaigns.data.campaigns.length === 0 ? (
        !creating && <EmptyState icon={<Megaphone className="h-5 w-5" />} title="No campaigns yet" body="Create a campaign, then add creators from Search, a list or a creator's profile." action={<button onClick={() => setCreating(true)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>New campaign</button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.data.campaigns.map((c) => <CampaignCard key={c.id} c={c} onOpen={() => onOpen(c.id)} />)}
        </div>
      )}
    </div>
  );
}
