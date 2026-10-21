import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { outreachEmailListSchema, outreachEmailSchema, outreachUsageSchema, type OutreachEmail } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useCreatorProfile } from "../../api/search";
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

/**
 * One email, written and confirmed by a person, to a creator's revealed address (owner decision 2026-10-16). The
 * server decides everything: whether sending is on, the plan allowance, the address, suppression and limits.
 */
export function SendEmailSection({ campaignId, creatorId, creatorName }: { campaignId: string; creatorId: string; creatorName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const usage = useQuery({ queryKey: ["outreach", "usage"], queryFn: () => apiRequest("/v1/outreach/usage", outreachUsageSchema) });
  const sent = useQuery({ queryKey: ["outreach", "emails", campaignId], queryFn: () => apiRequest(`/v1/campaigns/${campaignId}/emails`, outreachEmailListSchema) });
  const profile = useCreatorProfile(creatorId);
  const emails = (profile.data?.contacts ?? []).filter((c) => c.kind === "email");
  const usable = emails.filter((c) => c.value !== null && c.status !== "invalid");
  const [contactId, setContactId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const chosen = usable.find((c) => c.id === contactId) ?? usable[0] ?? null;

  const send = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/campaigns/${campaignId}/creators/${creatorId}/emails`, outreachEmailSchema, {
        method: "POST",
        body: { contactId: chosen?.id ?? "", subject, body, confirm: true },
        idempotencyKey: key,
      }),
    onSuccess: (e) => {
      // Test mode records the email but no email service sees it: never word that as accepted for delivery.
      toast.success(
        e.status === "failed" ? "The email service refused this email" : e.mode === "test" ? `Email to ${creatorName} recorded in test mode: not delivered` : `Email to ${creatorName} accepted by the email service`,
        e.status === "failed" ? (e.failureReason ?? undefined) : undefined,
      );
      setSubject("");
      setBody("");
      setConfirmed(false);
      setKey(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: ["outreach"] });
    },
    onError: (err) => toast.error("Email not sent", err instanceof Error ? err.message : undefined),
  });

  const u = usage.data;
  const mine = (sent.data?.emails ?? []).filter((e) => e.creatorId === creatorId);
  const heading = <div className="mb-2 text-xs text-slate-900" style={{ fontWeight: 600 }}>Send an email through MUSHIN</div>;
  let content: React.ReactNode;
  if (!u) content = <p className="text-xs text-slate-500">Checking whether email sending is available…</p>;
  else if (u.mode === "off") content = <p className="text-xs text-slate-600">Sending email through MUSHIN is not available yet. Use a template below in your own email, then log what happened.</p>;
  else if (u.limit === 0) content = <p className="text-xs text-slate-600">Your plan does not include outreach emails. Growth includes 500 and Scale 2,000 per billing period.</p>;
  else if (emails.length === 0) content = <p className="text-xs text-slate-600">MUSHIN has no email address for this creator. Contact them another way and log it below.</p>;
  else if (usable.length === 0) content = <p className="text-xs text-slate-600">{emails.every((c) => c.status === "invalid") ? "This creator's email address is known to be invalid." : "Reveal this creator's contact details on their profile first."}</p>;
  else {
    content = (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (confirmed && chosen) send.mutate(); }}>
        {u.mode === "test" && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" role="note">Test mode: this email is recorded but not delivered to anyone.</p>}
        <p className="text-[11px] text-slate-500">{u.limit === null ? `${u.used} sent this billing period.` : `${u.used} of ${u.limit} emails used this billing period.`}</p>
        <label className="block text-[11px] text-slate-600">To
          <select value={chosen?.id ?? ""} onChange={(e) => setContactId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs">
            {usable.map((c) => <option key={c.id} value={c.id}>{c.value} · {c.status === "unverified" ? "Unverified" : c.status === "domain_ok" ? "Domain accepts mail (inbox not confirmed)" : "Verified"}</option>)}
          </select>
        </label>
        <label className="block text-[11px] text-slate-600">Subject
          <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
        </label>
        <label className="block text-[11px] text-slate-600">Message
          <textarea value={body} maxLength={10000} rows={5} onChange={(e) => setBody(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
        </label>
        <label className="flex items-start gap-2 text-[11px] text-slate-700">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          <span>Send this email to {chosen?.value ?? "this address"}. MUSHIN adds an unsubscribe link.</span>
        </label>
        <button type="submit" disabled={!confirmed || !subject.trim() || !body.trim() || send.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>
          {send.isPending ? "Sending…" : "Send email"}
        </button>
      </form>
    );
  }
  return (
    <section aria-label="Send an email">
      {heading}
      {content}
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
