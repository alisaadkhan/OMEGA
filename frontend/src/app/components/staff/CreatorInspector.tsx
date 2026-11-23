import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { BadgeCheck, Ban, EyeOff, ExternalLink, MapPin, RotateCcw, Save, ShieldOff, Trash2, UserCheck } from "lucide-react";
import { adminRequest } from "../../admin/adminApi";
import { useConfirm, useToast } from "../../lib/toast";
import { needsKey, useStepUp } from "../admin/staff-ui";
import { Badge, errText, fmtNum } from "./kit";
import { ACCOUNT_TYPES, HIDDEN, NICHES, REPORT_REASON, TRASH_DAYS, trashDaysLeft, type StaffCreator } from "./creatorTypes";

const field = "w-full rounded-xl border border-slate-200 bg-[#f7f9fb] px-3.5 py-2.5 text-[13px] font-semibold text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-600/20";
const label = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-slate-500";
const okSchema = z.looseObject({});

/**
 * One creator, editable (owner design, 22 Nov): name, niche, city and account type; country only from evidence; clear a
 * minor flag or an organisation mark with a reason; hide from customers or remove for good. Every change needs a reason,
 * is audited, and updates customer search at once.
 */
export function CreatorInspector({ c, canEdit }: { c: StaffCreator; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const step = useStepUp();
  const top = c.profiles[0];
  const [name, setName] = useState(c.displayName);
  const [niche, setNiche] = useState(c.nicheMain ?? "");
  const [city, setCity] = useState(c.city ?? "");
  const [type, setType] = useState(c.accountType ?? "UNKNOWN");
  const [country, setCountry] = useState(c.publicCountry ?? "PK");
  const [evidence, setEvidence] = useState(top?.url ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const why = reason.trim();
  const needWhy = why.length < 12;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      try {
        await fn();
      } catch (err) {
        if (!(needsKey(err) && (await step.confirm()))) throw err;
        await fn();
      }
      toast.success(done);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["admin", "creators"] });
      void qc.invalidateQueries({ queryKey: ["admin", "nav"] });
    } catch (err) {
      toast.error("Not saved", errText(err));
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body: object, method = "POST") => adminRequest(`/admin/v1/catalogue/creators/${c.id}${path}`, okSchema, { method, body });
  const changes = {
    ...(name.trim() !== c.displayName ? { displayName: name.trim() } : {}),
    ...(city.trim() !== (c.city ?? "") ? { city: city.trim() || null } : {}),
    ...(niche !== (c.nicheMain ?? "") ? { nicheMain: niche || null } : {}),
    ...(type !== (c.accountType ?? "UNKNOWN") ? { accountType: type } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  return (
    <section aria-label={`Creator ${c.displayName}`} className="flex-1 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_8px_rgba(0,0,0,0.03)] sm:p-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 xl:flex-row xl:items-center">
        <div className="flex items-center gap-4">
          <img src={c.avatarUrl ?? ""} alt="" className="h-[52px] w-[52px] shrink-0 rounded-full bg-slate-100 object-cover ring-2 ring-cyan-300/50" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[19px] font-bold leading-tight text-slate-900">{c.displayName}</h2>
              {top?.verified && <BadgeCheck className="h-4 w-4 text-sky-500" aria-label="Verified" />}
              {top && <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">{top.platform}</span>}
              {c.status === "hidden" ? <Badge tone="rose" dot>Hidden by staff</Badge> : c.eligible ? <Badge tone="emerald" dot>In customer search</Badge> : <Badge tone="amber" dot>Not in search</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[12.5px] text-slate-600">
              {top && <a href={top.url} target="_blank" rel="noreferrer noopener" className="font-medium text-cyan-700 hover:underline">@{top.handle}</a>}
              {top && <span className="font-semibold text-slate-900">{top.followers === null ? "—" : fmtNum(top.followers)} followers</span>}
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-cyan-700" />{[c.city, c.publicCountry ?? top?.country].filter(Boolean).join(", ") || "Location unknown"}</span>
            </div>
          </div>
        </div>
      </div>

      {(c.reports > 0 || c.hiddenReason || (!c.eligible && c.hiddenBecause.length > 0)) && (
        <div className="mt-4 space-y-2">
          {c.reports > 0 && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900"><strong>{c.reports} open customer report{c.reports === 1 ? "" : "s"}:</strong> {c.reportReasons.map((r) => REPORT_REASON[r] ?? r).join(", ") || "no reason given"}. Decide them under Reported Profiles.</p>}
          {c.hiddenReason && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700"><strong>Hidden by staff:</strong> {c.hiddenReason}</p>}
          {!c.eligible && c.status !== "hidden" && c.hiddenBecause.length > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"><strong>Customers can't find this creator:</strong> {c.hiddenBecause.map((r) => HIDDEN[r] ?? r.replace(/_/g, " ")).join(", ")}.</p>}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block"><span className={label}>Creator name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={field} disabled={!canEdit} /></label>
        <label className="block"><span className={label}>Main niche</span>
          <select value={niche} onChange={(e) => setNiche(e.target.value)} className={field} disabled={!canEdit}>
            <option value="">Not decided</option>
            {NICHES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="block"><span className={label}>City</span><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} placeholder="e.g. Lahore" className={field} disabled={!canEdit} /></label>
        <label className="block"><span className={label}>Account type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={field} disabled={!canEdit}>
            {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[120px_1fr]">
        <label className="block"><span className={label}>Country</span><input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} className={`${field} text-center uppercase`} disabled={!canEdit} aria-label="Country code" /></label>
        <label className="block"><span className={label}>Proof for the country (a link or a note)</span>
          <div className="flex gap-2">
            <input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} className={`${field} font-mono text-[12px] font-normal`} disabled={!canEdit} />
            {/^https?:\/\//.test(evidence) && <a href={evidence} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-[12.5px] font-semibold text-slate-800 hover:bg-slate-50">Open <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">Never from a name, a face or a language: only from a source you can point to.</p>

      {canEdit && c.status === "trashed" ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-900">
          <div className="font-bold">{c.trashBanned ? "Banned and in Trash" : "In Trash"}{trashDaysLeft(c.trashedAt) !== null && ` · erased in ${trashDaysLeft(c.trashedAt)} day${trashDaysLeft(c.trashedAt) === 1 ? "" : "s"}`}</div>
          {c.trashReason && <p className="mt-1 text-xs">Reason: {c.trashReason}</p>}
          {c.trashBanned && <p className="mt-1 text-xs">Its profile links are blocked, so no search or import adds it again. Restoring lifts the block.</p>}
          <label className="mt-3 block"><span className={label}>Reason for restoring</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Reached 10k followers" className={`${field} font-normal`} />
          </label>
          <button type="button" disabled={busy || needWhy} onClick={() => void run(() => post("/restore", { reason: why }), `${c.displayName} restored`)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#131b2e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50"><RotateCcw className="h-4 w-4" />Restore</button>
        </div>
      ) : canEdit ? (
        <>
          <label className="mt-5 block"><span className={label}>Reason for this change (needed for every action)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Checked the bio and recent posts by hand" className={`${field} font-normal`} />
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
            <button type="button" disabled={busy || !dirty || needWhy} onClick={() => void run(() => post("", { ...changes, reason: why }, "PATCH"), `Saved ${c.displayName}`)} className="inline-flex items-center gap-2 rounded-xl bg-[#131b2e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50"><Save className="h-4 w-4" />Save Profile Changes</button>
            <button type="button" disabled={busy || !/^[A-Z]{2}$/.test(country) || evidence.trim().length < 12} onClick={() => void run(() => post("/country", { country, evidence: evidence.trim() }), `Country set for ${c.displayName}`)} className="inline-flex items-center gap-2 rounded-xl bg-[#57dffe] px-4 py-2.5 text-[13px] font-bold text-[#001f26] hover:bg-[#4cd7f6] disabled:opacity-50"><UserCheck className="h-4 w-4" />{country === "PK" ? "Confirm Pakistan" : `Set country ${country}`}</button>
            {c.organisationCategory && <button type="button" disabled={busy || needWhy} onClick={() => void run(() => post("/organisation-override", { reason: why }), `${c.displayName} is back in search`)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">Mark as Person (Return to Search)</button>}
            {c.isMinor && <button type="button" disabled={busy || needWhy} onClick={() => void run(() => post("/minor-override", { reason: why }), "Age flag cleared")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"><ShieldOff className="h-4 w-4" />Clear Age Flag</button>}
            {c.status === "hidden" ? (
              <button type="button" disabled={busy || needWhy} onClick={() => void run(() => post("/unhide", { reason: why }), "Back in customer view")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">Unhide</button>
            ) : (
              <button type="button" disabled={busy || needWhy} onClick={() => void run(() => post("/hide", { reason: why }), "Hidden from customers")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"><EyeOff className="h-4 w-4" />Hide from customers</button>
            )}
            {/* Trash and Ban (owner, 23 Nov): restorable for 45 days, then erased. Ban also stops it ever being added again. */}
            <button
              type="button"
              disabled={busy || needWhy}
              onClick={async () => {
                if (await confirm({ title: `Move ${c.displayName} to Trash?`, body: `They leave every customer view now. You can restore them from Trash for ${TRASH_DAYS} days; after that they are erased for good.`, confirmLabel: "Move to Trash", destructive: true }))
                  void run(() => post("/trash", { reason: why, ban: false }), `${c.displayName} moved to Trash`);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />Move to Trash
            </button>
            <button
              type="button"
              disabled={busy || needWhy}
              onClick={async () => {
                if (await confirm({ title: `Ban ${c.displayName}?`, body: `They go to Trash and their profile links are blocked: no search or import will ever add them again. You can restore them for ${TRASH_DAYS} days; after that they are erased and stay blocked.`, confirmLabel: "Ban", destructive: true }))
                  void run(() => post("/trash", { reason: why, ban: true }), `${c.displayName} banned`);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Ban className="h-4 w-4" />Ban
            </button>
            <button
              type="button"
              disabled={busy || needWhy}
              onClick={async () => {
                if (await confirm({ title: `Erase ${c.displayName} now?`, body: "For data-removal requests: their profiles, contacts and history are erased at once, with no Trash period. This cannot be undone.", confirmLabel: "Erase now", destructive: true }))
                  void run(() => post("/remove", { reason: why }), `${c.displayName} erased`);
              }}
              className="text-[12px] font-semibold text-rose-700 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Erase now (data removal)
            </button>
          </div>
        </>
      ) : <p className="mt-5 text-xs text-slate-500">Support staff can look; Admins make changes.</p>}

      <div className="mt-6 space-y-2">
        <div className={label}>Profiles</div>
        {c.profiles.map((p) => (
          <div key={`${p.platform}:${p.handle}`} className="rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <a href={p.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-cyan-700 hover:underline">{p.platform} @{p.handle} <ExternalLink className="h-3 w-3" /></a>
              <span className="tabular-nums text-slate-600">{p.followers === null ? "—" : fmtNum(p.followers)} followers</span>
              {p.countryStatus && <Badge tone={p.countryStatus === "pakistan" ? "emerald" : p.countryStatus === "foreign" ? "rose" : "amber"}>{p.countryStatus}{p.country ? ` · ${p.country}` : ""}</Badge>}
            </div>
            {p.bio && <p className="mt-1 whitespace-pre-line text-slate-600">{p.bio}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
