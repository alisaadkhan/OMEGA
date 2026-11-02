import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { outreachDraftSchema, outreachEmailListSchema, outreachEmailSchema, outreachPreviewSchema, outreachUsageSchema, type OutreachEmail, type OutreachPreview } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useToast } from "../../lib/toast";

/** What each send status means, stated exactly (owner rule: never claim delivery from acceptance). */
export const EMAIL_STATUS_LABEL: Record<OutreachEmail["status"], string> = {
  requested: "Sending…",
  accepted: "Accepted by the email service (not yet confirmed delivered)",
  delivered: "Delivered",
  bounced: "Bounced (address does not receive email)",
  complained: "Marked as spam by the recipient",
  failed: "Not sent",
};

const STATUS_LABEL = { unverified: "Unverified", domain_ok: "Domain accepts mail (inbox not confirmed)", verified: "Verified", user_provided: "Entered by your team (unverified)" } as const;
const OTHER = "__other__";

/**
 * One email, written and confirmed by a person, to a creator in a campaign (owner decisions 2026-10-16, 2026-10-26). The
 * draft comes from the campaign's real brand and name; the preview is exactly what is sent; sending needs an explicit
 * confirmation. The server decides everything: whether sending is on, the plan allowance, the address, suppression and
 * limits. Without an email, the creator's profile links and a copyable message serve manual outreach.
 */
export function SendEmailSection({ campaignId, creatorId, creatorName }: { campaignId: string; creatorId: string; creatorName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const usage = useQuery({ queryKey: ["outreach", "usage"], queryFn: () => apiRequest("/v1/outreach/usage", outreachUsageSchema) });
  const sent = useQuery({ queryKey: ["outreach", "emails", campaignId], queryFn: () => apiRequest(`/v1/campaigns/${campaignId}/emails`, outreachEmailListSchema) });
  const draft = useQuery({ queryKey: ["outreach", "draft", campaignId, creatorId], queryFn: () => apiRequest(`/v1/campaigns/${campaignId}/creators/${creatorId}/email-draft`, outreachDraftSchema) });
  const [recipient, setRecipient] = useState<string>("");
  const [manualEmail, setManualEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<OutreachPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  // Prefill once from the draft: the first usable address, the campaign's subject and message.
  useEffect(() => {
    if (!draft.data || subject || body) return;
    setSubject(draft.data.subject);
    setBody(draft.data.body);
    setRecipient(draft.data.recipients[0]?.id ?? OTHER);
  }, [draft.data, subject, body]);
  // Any edit invalidates the preview and the confirmation.
  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
  }, [recipient, manualEmail, subject, body]);

  const target = () => (recipient === OTHER ? { manualEmail: manualEmail.trim() } : { contactId: recipient });
  const showPreview = useMutation({
    mutationFn: () => apiRequest(`/v1/campaigns/${campaignId}/creators/${creatorId}/email-preview`, outreachPreviewSchema, { method: "POST", body: { ...target(), subject, body } }),
    onSuccess: setPreview,
    onError: (err) => toast.error("Couldn't prepare the preview", err instanceof Error ? err.message : undefined),
  });
  const send = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/campaigns/${campaignId}/creators/${creatorId}/emails`, outreachEmailSchema, { method: "POST", body: { ...target(), subject, body, confirm: true }, idempotencyKey: key }),
    onSuccess: (e) => {
      // Test mode records the email but no email service sees it: never word that as accepted for delivery.
      toast.success(
        e.status === "failed" ? "The email service refused this email" : e.mode === "test" ? `Email to ${creatorName} recorded in test mode: not delivered` : `Email to ${creatorName} accepted by the email service`,
        e.status === "failed" ? (e.failureReason ?? undefined) : undefined,
      );
      setPreview(null);
      setConfirmed(false);
      setKey(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: ["outreach"] });
    },
    // The same idempotency key is kept, so retrying after a lost response never sends twice.
    onError: (err) => toast.error("Email not sent", err instanceof Error ? err.message : undefined),
  });

  const u = usage.data;
  const d = draft.data;
  const mine = (sent.data?.emails ?? []).filter((e) => e.creatorId === creatorId);
  const field = "mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs";
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied", "Paste it into the creator's DMs or your own email, then log it below.");
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access. Select the text and copy it instead.");
    }
  };

  let content: React.ReactNode;
  if (!u || draft.isLoading) content = <p className="text-xs text-slate-500">Preparing the email…</p>;
  else if (draft.isError || !d) content = <p className="text-xs text-red-600">The draft could not be loaded. Close this panel and try again.</p>;
  else if (u.mode === "off" || u.limit === 0) {
    content = (
      <p className="text-xs text-slate-600">
        {u.mode === "off" ? "Sending email through MUSHIN is not available yet." : "Your plan does not include outreach emails (Growth includes 500 and Scale 2,000 per billing period)."} Use the message below in your own email or DMs, then log what happened.
      </p>
    );
  } else {
    content = (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (preview?.sendable && confirmed) send.mutate(); }}>
        {u.mode === "test" && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" role="note">Test mode: this email is recorded but not delivered to anyone.</p>}
        <p className="text-[11px] text-slate-500">{u.limit === null ? `${u.used} sent this billing period.` : `${u.used} of ${u.limit} emails used this billing period.`}</p>
        {d.revealNeeded && d.recipients.length === 0 && <p className="text-[11px] text-slate-600">MUSHIN has an email for this creator: reveal it on their profile to use it here, or enter an address you have.</p>}
        <label className="block text-[11px] text-slate-600">To
          <select aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className={field}>
            {d.recipients.map((r) => <option key={r.id} value={r.id}>{r.value} · {STATUS_LABEL[r.status]}</option>)}
            <option value={OTHER}>Enter another address…</option>
          </select>
        </label>
        {recipient === OTHER && (
          <label className="block text-[11px] text-slate-600">Email address you have for {creatorName}
            <input type="email" value={manualEmail} maxLength={254} onChange={(e) => setManualEmail(e.target.value)} className={field} placeholder="name@example.com" />
            <span className="mt-0.5 block text-[10px] text-slate-500">Kept for your workspace only, as entered by your team and unverified. It does not change the creator's profile.</span>
          </label>
        )}
        <label className="block text-[11px] text-slate-600">Subject
          <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={field} />
        </label>
        <label className="block text-[11px] text-slate-600">Message
          <textarea value={body} maxLength={10000} rows={7} onChange={(e) => setBody(e.target.value)} className={field} />
        </label>
        <button type="button" onClick={() => showPreview.mutate()} disabled={!subject.trim() || !body.trim() || (recipient === OTHER && !manualEmail.trim()) || showPreview.isPending} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800 disabled:opacity-50">
          {showPreview.isPending ? "Preparing preview…" : "Preview the email"}
        </button>
        {preview && (
          <section aria-label="Email preview" className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
            <div><span className="text-slate-500">From:</span> {preview.from}</div>
            <div><span className="text-slate-500">Reply-to:</span> {preview.replyTo}</div>
            <div><span className="text-slate-500">To:</span> {preview.to}</div>
            <div><span className="text-slate-500">Subject:</span> {preview.subject}</div>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-800">{preview.text}</pre>
            {preview.warnings.map((w) => <p key={w} className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-amber-900" role="note">{w}</p>)}
            {!preview.sendable && <p className="mt-1 rounded bg-red-50 px-1.5 py-1 text-red-800" role="alert">This email can't be sent: {preview.blockedReason}</p>}
          </section>
        )}
        {preview?.sendable && (
          <label className="flex items-start gap-2 text-[11px] text-slate-700">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>Send this exact email to {preview.to}.</span>
          </label>
        )}
        <button type="submit" disabled={!preview?.sendable || !confirmed || send.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>
          {send.isPending ? "Sending…" : "Send email"}
        </button>
      </form>
    );
  }
  return (
    <section aria-label="Send an email">
      <div className="mb-2 text-xs text-slate-900" style={{ fontWeight: 600 }}>Email {creatorName}</div>
      {content}
      {d && (
        <div className="mt-3 rounded-md border border-slate-100 p-2 text-[11px]">
          <div className="text-slate-800" style={{ fontWeight: 600 }}>Contact them yourself</div>
          <p className="text-slate-500">MUSHIN never messages creators on Instagram or TikTok for you. Open their profile, paste the message, then log it below.</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {d.profileLinks.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">Open {l.platform}</a></li>)}
          </ul>
          <button type="button" onClick={() => void copy(d.manualMessage)} className="mt-1 rounded-md border border-slate-200 px-2 py-1 text-slate-700">Copy message</button>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[11px]" aria-label="Emails sent to this creator">
          {mine.map((e) => (
            <li key={e.id} className="rounded-md border border-slate-100 px-2 py-1.5">
              <div className="text-slate-800" style={{ fontWeight: 600 }}>{e.subject}</div>
              <div className="text-slate-500">To {e.recipient} · {new Date(e.createdAt).toLocaleString("en-GB")} · {e.sentBy.name}{e.mode === "test" ? " · test mode" : ""}</div>
              <div className="text-slate-700">{EMAIL_STATUS_LABEL[e.status]}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
