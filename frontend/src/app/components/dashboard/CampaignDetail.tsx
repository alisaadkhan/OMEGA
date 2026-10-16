import { useRef, useState } from "react";
import { ineligibleText } from "../../lib/eligibility";
import { ArrowLeft, CalendarClock, MessageSquareText, Pencil, Trash2, Undo2, UserMinus, Users, XCircle } from "lucide-react";
import type { CampaignCreator, PipelineStage, UpdateCampaignCreator } from "@mushin/contracts";
import { rupees, toMinor, useCampaign, useDeleteCampaign, useRemoveFromCampaign, useUpdateCampaign, useUpdateCampaignCreator } from "../../api/campaigns";
import { toCreator } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { CampaignForm, STAGE_LABEL, STATUS_LABEL, STATUS_TONE } from "./Campaigns";
import { OutreachPanel, OUTCOME_LABEL } from "./CampaignOutreach";
import type { Creator } from "./CreatorProfilePanel";
import { EmptyState, ErrorState, LoadingBlock } from "./states";

const STAGES: PipelineStage[] = ["identified", "contacted", "negotiating", "confirmed"];
const FEE_LABEL = { estimated: "Estimated", quoted: "Quoted", agreed: "Agreed" } as const;
const CONTENT_LABEL = { none: "No content yet", content_pending: "Content pending", posted: "Posted", completed: "Completed" } as const;

export function CampaignDetail({ id, onBack, onOpenCreator, onGoToSearch }: { id: string; onBack: () => void; onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const campaign = useCampaign(id);
  const update = useUpdateCampaign();
  const del = useDeleteCampaign();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [outreachFor, setOutreachFor] = useState<CampaignCreator | null>(null);

  if (campaign.isPending) return <LoadingBlock lines={6} />;
  if (campaign.isError) return <ErrorState body={campaign.error instanceof Error ? campaign.error.message : undefined} onRetry={() => void campaign.refetch()} />;
  const c = campaign.data;
  const open = c.creators.filter((x) => x.outcome === "open");
  const declined = c.creators.filter((x) => x.outcome === "declined");

  async function onDelete() {
    if (!(await confirm({ title: `Delete ${c.name}?`, body: "The campaign, its pipeline and its outreach log are deleted for everyone in your workspace. Creators stay in MUSHIN.", confirmLabel: "Delete campaign", cancelLabel: "Keep", destructive: true }))) return;
    del.mutate(id, { onSuccess: () => { toast.success(`Deleted ${c.name}`); onBack(); }, onError: (err) => toast.error("Couldn't delete the campaign", err instanceof Error ? err.message : undefined) });
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> All campaigns</button>
      {editing ? (
        <CampaignForm
          initial={c}
          submitLabel="Save changes"
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate({ id, patch: v }, { onSuccess: () => setEditing(false), onError: (err) => toast.error("Couldn't save the campaign", err instanceof Error ? err.message : undefined) })}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-slate-900" style={{ fontSize: 24, fontWeight: 700 }}>{c.name}</h1>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status]}`} style={{ fontWeight: 600 }}>{STATUS_LABEL[c.status]}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {c.client || "No client"} · {c.startDate ?? "no start date"} → {c.endDate ?? "no end date"} · {rupees(c.agreedFeesMinor)} agreed{c.budgetMinor !== null ? ` of ${rupees(c.budgetMinor)} budget` : ""}
            </p>
            {c.objective && <p className="mt-1 max-w-2xl text-sm text-slate-600">{c.objective}</p>}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            {c.status === "archived" ? (
              <button onClick={() => update.mutate({ id, patch: { status: "paused" } }, { onSuccess: () => toast.success(`Restored ${c.name}`), onError: (err) => toast.error("Couldn't restore the campaign", err instanceof Error ? err.message : undefined) })} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Restore</button>
            ) : (
              <button onClick={() => update.mutate({ id, patch: { status: "archived" } }, { onSuccess: () => toast.success(`Archived ${c.name}. It no longer counts towards your plan's campaign limit.`), onError: (err) => toast.error("Couldn't archive the campaign", err instanceof Error ? err.message : undefined) })} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Archive</button>
            )}
            <button onClick={() => void onDelete()} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-500">Tasks and reminders are planned and not available yet. MUSHIN doesn't send messages: log outreach you did yourself.</p>

      {c.creators.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No creators in this campaign yet" body="Add creators from Search, a list or a creator's profile with Add to campaign." action={<button onClick={onGoToSearch} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Search creators</button>} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((s) => (
            <Column key={s} title={STAGE_LABEL[s]} items={open.filter((x) => x.stage === s)} campaignId={id} onOutreach={setOutreachFor} onOpenCreator={onOpenCreator} />
          ))}
          <Column title="Declined" items={declined} campaignId={id} onOutreach={setOutreachFor} onOpenCreator={onOpenCreator} muted />
        </div>
      )}
      {outreachFor && <OutreachPanel campaignId={id} member={outreachFor} onClose={() => setOutreachFor(null)} />}
    </div>
  );
}

function Column({ title, items, campaignId, onOutreach, onOpenCreator, muted }: { title: string; items: CampaignCreator[]; campaignId: string; onOutreach: (m: CampaignCreator) => void; onOpenCreator: (c: Creator) => void; muted?: boolean }) {
  return (
    <section aria-label={`${title}: ${items.length}`} className={`w-60 shrink-0 rounded-xl border p-2.5 ${muted ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-slate-50"}`}>
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-600" style={{ fontWeight: 600 }}>
        <span>{title}</span>
        <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-500">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <div className="px-1 py-3 text-center text-[11px] text-slate-500">None</div>}
        {items.map((m) => <MemberCard key={m.creator.id} m={m} campaignId={campaignId} onOutreach={() => onOutreach(m)} onOpenCreator={onOpenCreator} />)}
      </div>
    </section>
  );
}

function MemberCard({ m, campaignId, onOutreach, onOpenCreator }: { m: CampaignCreator; campaignId: string; onOutreach: () => void; onOpenCreator: (c: Creator) => void }) {
  const save = useUpdateCampaignCreator();
  const remove = useRemoveFromCampaign();
  const confirm = useConfirm();
  const toast = useToast();
  const [fee, setFee] = useState<string | null>(null);
  // The fee editor commits once. Enter blurs the field, and the browser fires blur again when the field is removed; a
  // second save carried the same version and was refused (409), so a following stage change was lost (E2E f78-1).
  const feeOpen = useRef(false);
  const openFee = () => {
    feeOpen.current = true;
    setFee(m.feeMinor === null ? "" : String(Math.round(m.feeMinor / 100)));
  };
  const commitFee = (text: string) => {
    if (!feeOpen.current) return;
    feeOpen.current = false;
    setFee(null);
    const v = toMinor(text);
    if (v !== m.feeMinor) change({ feeMinor: v });
  };
  const card = toCreator(m.creator);

  function change(patch: Omit<UpdateCampaignCreator, "expectedVersion">) {
    save.mutate({ id: campaignId, creatorId: m.creator.id, patch: { expectedVersion: m.version, ...patch } }, {
      onError: (err) => {
        // Checked by code, not class identity: a dev-server reload can load the error class twice.
        if ((err as { code?: unknown }).code === "CONFLICT") toast.warning("Updated by someone else", "We loaded their change. Check it, then try again.");
        else toast.error("Couldn't save the change", err instanceof Error ? err.message : undefined);
      },
    });
  }
  async function onRemove() {
    if (!(await confirm({ title: `Remove ${m.creator.displayName} from the campaign?`, body: "Their stage, fee and outreach log in this campaign are deleted.", confirmLabel: "Remove", cancelLabel: "Keep", destructive: true }))) return;
    remove.mutate({ id: campaignId, creatorId: m.creator.id }, { onError: (err) => toast.error("Couldn't remove the creator", err instanceof Error ? err.message : undefined) });
  }
  const select = "w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700";

  return (
    <article className={`rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm ${save.isPending ? "opacity-70" : ""}`}>
      <button onClick={() => onOpenCreator(card)} className="flex w-full items-center gap-2 text-left">
        <img src={card.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
        <span className="min-w-0">
          <span className="block truncate text-xs text-slate-900" style={{ fontWeight: 600 }}>{m.creator.displayName}</span>
          <span className="block truncate text-[11px] text-slate-500">@{m.creator.handle} · {m.creator.platform}</span>
          {!m.creator.eligibility.eligible && (
            <span className="block text-[11px] text-amber-800" data-testid="member-ineligible">{ineligibleText(m.creator.eligibility)} · kept in this campaign</span>
          )}
        </span>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {m.outcome === "open" ? (
          <select aria-label="Stage" value={m.stage} disabled={save.isPending} onChange={(e) => change({ stage: e.target.value as PipelineStage })} className={select}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        ) : (
          <span className="rounded bg-slate-100 px-1 py-0.5 text-center text-[11px] text-slate-700">Declined at {STAGE_LABEL[m.stage]}</span>
        )}
        <select aria-label="Priority" value={m.priority} disabled={save.isPending} onChange={(e) => change({ priority: e.target.value as CampaignCreator["priority"] })} className={select}>
          <option value="low">Low priority</option>
          <option value="med">Medium priority</option>
          <option value="high">High priority</option>
        </select>
        <select aria-label="Content status" value={m.contentStatus} disabled={save.isPending} onChange={(e) => change({ contentStatus: e.target.value as CampaignCreator["contentStatus"] })} className={`${select} col-span-2`}>
          {Object.entries(CONTENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="mt-1.5 flex flex-col items-start gap-1 text-[11px]">
        {fee !== null ? (
          <input
            autoFocus
            inputMode="numeric"
            aria-label="Fee in rupees"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => commitFee(fee)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFee(fee);
              else if (e.key === "Escape") {
                feeOpen.current = false;
                setFee(null);
              }
            }}
            className="w-24 rounded border border-indigo-300 px-1 py-0.5"
          />
        ) : (
          <button onClick={openFee} className="text-left text-[11px] text-slate-700 hover:text-indigo-700" title="Edit fee">
            {FEE_LABEL[m.feeKind]} fee: <span style={{ fontWeight: 600 }}>{rupees(m.feeMinor)}</span>
          </button>
        )}
        <label className="inline-flex items-center gap-1 text-slate-500">
          <CalendarClock className="h-3 w-3" />
          <input type="date" aria-label="Due date" value={m.dueDate ?? ""} onChange={(e) => change({ dueDate: e.target.value || null })} className="w-[7.5rem] rounded border border-slate-200 px-1 py-0.5 text-[11px]" />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {m.lastOutreach ? `${OUTCOME_LABEL[m.lastOutreach.outcome]} via ${m.lastOutreach.channel} · ${relative(m.lastOutreach.occurredAt)}` : "No outreach logged"}
      </p>
      <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
        <button onClick={onOutreach} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white hover:bg-slate-800"><MessageSquareText className="h-3 w-3" /> Outreach</button>
        {m.outcome === "open" ? (
          <button onClick={() => change({ outcome: "declined" })} title="Mark declined" aria-label="Mark declined" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:text-red-600"><XCircle className="h-3.5 w-3.5" /></button>
        ) : (
          <button onClick={() => change({ outcome: "open" })} title="Reopen" aria-label="Reopen" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:text-emerald-600"><Undo2 className="h-3.5 w-3.5" /></button>
        )}
        <button onClick={() => void onRemove()} title="Remove from campaign" aria-label="Remove from campaign" className="rounded-md border border-slate-200 p-1 text-slate-500 hover:text-red-600"><UserMinus className="h-3.5 w-3.5" /></button>
      </div>
    </article>
  );
}
