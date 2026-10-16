import { useEffect, useState } from "react";
import { Copy, Mail, X } from "lucide-react";
import type { CampaignCreator, LogOutreach } from "@mushin/contracts";
import { useLogOutreach, useOutreachLog } from "../../api/campaigns";
import { useToast } from "../../lib/toast";
import { SendEmailSection } from "./SendEmail";
import { ErrorState, Spinner } from "./states";

export const OUTCOME_LABEL = { attempted: "Reached out", replied: "Replied", no_response: "No response", declined: "Declined", agreed: "Agreed" } as const;
const CHANNEL_LABEL = { email: "Email", phone: "Phone call", whatsapp: "WhatsApp", instagram: "Instagram DM", tiktok: "TikTok DM", youtube: "YouTube", other: "Other" } as const;

/** Manual outreach (canonical spec page 11): templates to copy or open in your own email app, and a log of what happened. */
const TEMPLATES = [
  { id: "intro", title: "Introduction", subject: "Collaboration with {brand}", body: "Hi {name},\n\nI'm reaching out from {brand}. We loved your recent content and think you'd be a great fit for an upcoming campaign. Would you be open to a quick chat about a paid collaboration?\n\nThanks,\n{sender}" },
  { id: "brief", title: "Campaign brief", subject: "Campaign brief: {campaign}", body: "Hi {name},\n\nThanks for your interest. Here's a short brief for {campaign}:\n- Deliverables:\n- Timeline:\n- Fee:\n\nLet me know if this works for you.\n\n{sender}" },
  { id: "follow", title: "Follow-up", subject: "Following up: {campaign}", body: "Hi {name},\n\nJust following up on my earlier message about {campaign}. Happy to answer any questions.\n\n{sender}" },
];

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function OutreachPanel({ campaignId, member, onClose }: { campaignId: string; member: CampaignCreator; onClose: () => void }) {
  const log = useOutreachLog(campaignId, member.creator.id);
  const add = useLogOutreach();
  const toast = useToast();
  const [form, setForm] = useState<{ channel: LogOutreach["channel"]; outcome: LogOutreach["outcome"]; note: string; when: string }>({ channel: "email", outcome: "attempted", note: "", when: localNow() });
  const [template, setTemplate] = useState(TEMPLATES[0] ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=alertdialog]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fill = (s: string) => s.replaceAll("{name}", member.creator.displayName).replaceAll("{campaign}", "our campaign").replaceAll("{brand}", "our brand").replaceAll("{sender}", "");

  async function copy() {
    if (!template) return;
    try {
      await navigator.clipboard.writeText(`${fill(template.subject)}\n\n${fill(template.body)}`);
      toast.success("Template copied", "Paste it into your email or DM, then log it below.");
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access. Select the text and copy it instead.");
    }
  }

  function submit() {
    const at = new Date(form.when);
    add.mutate(
      { id: campaignId, creatorId: member.creator.id, body: { channel: form.channel, outcome: form.outcome, note: form.note.trim(), occurredAt: Number.isNaN(at.getTime()) ? undefined : at.toISOString() } },
      {
        onSuccess: () => { setForm((f) => ({ ...f, note: "", when: localNow() })); toast.success("Outreach logged"); },
        onError: (err) => toast.error("Couldn't log the outreach", err instanceof Error ? err.message : undefined),
      },
    );
  }

  const field = "mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none";
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={`Outreach for ${member.creator.displayName}`} className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Outreach · {member.creator.displayName}</div>
            <div className="text-[11px] text-slate-500">Send an email through MUSHIN where your plan and this server allow it, or use a template in your own email or DM and log what happened.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <SendEmailSection campaignId={campaignId} creatorId={member.creator.id} creatorName={member.creator.displayName} />
          <section>
            <div className="mb-2 flex gap-1">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => setTemplate(t)} aria-pressed={template?.id === t.id} className={`rounded-md px-2 py-1 text-[11px] ${template?.id === t.id ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600"}`}>{t.title}</button>
              ))}
            </div>
            {template && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <div style={{ fontWeight: 600 }}>{fill(template.subject)}</div>
                <pre className="mt-2 whitespace-pre-wrap font-sans">{fill(template.body)}</pre>
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]"><Copy className="h-3 w-3" /> Copy</button>
                  <a href={`mailto:?subject=${encodeURIComponent(fill(template.subject))}&body=${encodeURIComponent(fill(template.body))}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]"><Mail className="h-3 w-3" /> Open in my email app</a>
                </div>
              </div>
            )}
          </section>
          <form className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="col-span-2 text-xs text-slate-700" style={{ fontWeight: 600 }}>Log outreach</div>
            <label className="text-[11px] text-slate-600">Channel
              <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as typeof f.channel }))} className={field}>
                {Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-slate-600">What happened
              <select value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value as typeof f.outcome }))} className={field}>
                {Object.entries(OUTCOME_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-[11px] text-slate-600">When
              <input type="datetime-local" max={localNow()} value={form.when} onChange={(e) => setForm((f) => ({ ...f, when: e.target.value }))} className={field} />
            </label>
            <label className="col-span-2 text-[11px] text-slate-600">Note <span className="text-slate-500">(optional)</span>
              <textarea rows={2} maxLength={2000} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={field} />
            </label>
            <div className="col-span-2 flex justify-end">
              <button type="submit" disabled={add.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{add.isPending ? "Saving…" : "Log outreach"}</button>
            </div>
          </form>
          <section>
            <div className="mb-2 text-xs text-slate-700" style={{ fontWeight: 600 }}>History</div>
            {log.isPending ? <Spinner /> : log.isError ? (
              <ErrorState body={log.error instanceof Error ? log.error.message : undefined} onRetry={() => void log.refetch()} />
            ) : log.data.events.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing logged yet.</p>
            ) : (
              <ol className="space-y-2">
                {log.data.events.map((e) => (
                  <li key={e.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex justify-between text-slate-700"><span style={{ fontWeight: 600 }}>{OUTCOME_LABEL[e.outcome]} · {CHANNEL_LABEL[e.channel]}</span><time dateTime={e.occurredAt} className="text-slate-500">{new Date(e.occurredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time></div>
                    {e.note && <p className="mt-1 text-slate-600">{e.note}</p>}
                    <p className="mt-1 text-[10px] text-slate-500">Logged by {e.loggedBy.name}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
