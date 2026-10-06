import { useState } from "react";
import { Mail, Send, Clock, CheckCircle2, XCircle, Info, ChevronRight, Ban, Plus } from "lucide-react";
import { useMailbox } from "../../lib/mailbox";
import { useCampaigns } from "../../lib/campaignStore";
import { EmptyState } from "./states";

type SequenceStatus = "scheduled" | "sent" | "replied" | "opted_out";
type StepKind = "initial" | "followup1" | "followup2";

type Sequence = {
  id: string;
  creatorName: string;
  handle: string;
  campaign: string;
  from: string;
  via: "gmail" | "outlook";
  to: string;
  subject: string;
  status: SequenceStatus;
  optedOut: boolean;
  steps: { kind: StepKind; scheduledAt: string; sentAt?: string; status: "pending" | "sent" | "skipped" }[];
};

const STEP_LABEL: Record<StepKind, string> = {
  initial: "Initial",
  followup1: "Follow-up 1",
  followup2: "Follow-up 2",
};

const SEED_SEQUENCES: Sequence[] = [
  {
    id: "seq-1",
    creatorName: "Ayesha Malik",
    handle: "@ayeshamalik",
    campaign: "Eid Sale 2026",
    from: "marketing@brand.pk",
    via: "gmail",
    to: "ayesha@creator.pk",
    subject: "Collaboration for Eid Sale 2026",
    status: "replied",
    optedOut: false,
    steps: [
      { kind: "initial", scheduledAt: "Jun 20", sentAt: "Jun 20", status: "sent" },
      { kind: "followup1", scheduledAt: "Jun 23", sentAt: "Jun 23", status: "skipped" },
      { kind: "followup2", scheduledAt: "Jun 26", status: "skipped" },
    ],
  },
  {
    id: "seq-2",
    creatorName: "Fahad Qureshi",
    handle: "@fahad.q",
    campaign: "Eid Sale 2026",
    from: "marketing@brand.pk",
    via: "gmail",
    to: "fahad.q@mail.com",
    subject: "Partnership opportunity — Eid Sale 2026",
    status: "scheduled",
    optedOut: false,
    steps: [
      { kind: "initial", scheduledAt: "Jun 23", sentAt: "Jun 23", status: "sent" },
      { kind: "followup1", scheduledAt: "Jun 26", status: "pending" },
      { kind: "followup2", scheduledAt: "Jun 29", status: "pending" },
    ],
  },
  {
    id: "seq-3",
    creatorName: "Zainab Iqbal",
    handle: "@zainab.iqbal",
    campaign: "Eid Sale 2026",
    from: "marketing@brand.pk",
    via: "gmail",
    to: "—",
    subject: "—",
    status: "opted_out",
    optedOut: true,
    steps: [],
  },
];

const STATUS_CONFIG: Record<SequenceStatus, { label: string; cls: string; icon: any }> = {
  scheduled: { label: "Scheduled",  cls: "bg-indigo-50 text-indigo-700 border-indigo-100",  icon: Clock },
  sent:      { label: "Sent",       cls: "bg-slate-50  text-slate-600  border-slate-200",   icon: Send },
  replied:   { label: "Replied",    cls: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: CheckCircle2 },
  opted_out: { label: "Opted out",  cls: "bg-rose-50   text-rose-700   border-rose-100",    icon: Ban },
};

export function Inbox() {
  const mailbox = useMailbox();
  const [sequences] = useState<Sequence[]>(SEED_SEQUENCES);
  const [selected, setSelected] = useState<Sequence | null>(null);

  const connected = mailbox.provider !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Inbox
          </h1>
          <p className="mt-1 text-sm text-slate-500">Outreach sequences sent to creators. Replies stop follow-ups automatically.</p>
        </div>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New sequence
        </button>
      </div>

      {/* Connected mailbox banner */}
      {connected ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" strokeWidth={2} />
          <p className="text-xs text-slate-700" style={{ lineHeight: 1.5 }}>
            Sending from your connected{" "}
            <span className="font-semibold">{mailbox.provider === "gmail" ? "Gmail" : "Outlook"}</span>{" "}
            account: <span className="font-semibold">{mailbox.address}</span>
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" strokeWidth={2} />
          <div>
            <p className="text-xs text-slate-700" style={{ lineHeight: 1.5, fontWeight: 500 }}>
              No mailbox connected
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              Connect Gmail or Outlook in Settings → Integrations to start sending sequences.
            </p>
          </div>
        </div>
      )}

      {sequences.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-5 w-5" strokeWidth={1.75} />}
          title="No sequences yet"
          body="Add creators to a campaign and start an outreach sequence to see them here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {["Creator", "Campaign", "From / Via", "Subject", "Status", "Sequence"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] text-slate-500" style={{ fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sequences.map((seq) => {
                const s = STATUS_CONFIG[seq.status];
                const SIcon = s.icon;
                return (
                  <tr
                    key={seq.id}
                    className="cursor-pointer hover:bg-slate-50/60"
                    onClick={() => setSelected(seq)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-slate-900" style={{ fontWeight: 500 }}>{seq.creatorName}</div>
                      <div className="text-[11px] text-slate-500">{seq.handle}</div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-700">{seq.campaign}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600">
                      <div>{seq.from}</div>
                      <div className="text-[10px] text-slate-400">via {seq.via}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[180px] truncate text-[12px] text-slate-700">
                      {seq.subject === "—" ? <span className="text-slate-400">—</span> : seq.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${s.cls}`} style={{ fontWeight: 500 }}>
                        <SIcon className="h-2.5 w-2.5" strokeWidth={2} />
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {seq.optedOut ? (
                        <span className="text-[11px] text-rose-600">Cannot enroll — opted out</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {seq.steps.map((step, i) => (
                            <div
                              key={i}
                              className={`h-2 w-2 rounded-full ${
                                step.status === "sent" ? "bg-emerald-500"
                                : step.status === "skipped" ? "bg-slate-200"
                                : "bg-slate-300"
                              }`}
                              title={`${STEP_LABEL[step.kind]}: ${step.status}`}
                            />
                          ))}
                          <span className="ml-1 text-[10px] text-slate-400">
                            Stops on reply
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sequence detail drawer */}
      {selected && (
        <SequenceDetail seq={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SequenceDetail({ seq, onClose }: { seq: Sequence; onClose: () => void }) {
  const s = STATUS_CONFIG[seq.status];
  const SIcon = s.icon;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-slate-900" style={{ fontWeight: 600 }}>{seq.creatorName}</div>
            <div className="text-[11px] text-slate-500">{seq.handle} · {seq.campaign}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600">
            <XCircle className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          {seq.optedOut && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3">
              <Ban className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" strokeWidth={2} />
              <p className="text-xs text-rose-700">
                This creator has opted out of outreach. They cannot be enrolled in any sequence.
              </p>
            </div>
          )}
          <Row label="From" value={seq.from} />
          <Row label="Via" value={seq.via === "gmail" ? "Gmail" : "Outlook"} />
          <Row label="To" value={seq.to} />
          <Row label="Subject" value={seq.subject} />
          <Row label="Campaign" value={seq.campaign} />
          <Row
            label="Status"
            value={
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${s.cls}`} style={{ fontWeight: 500 }}>
                <SIcon className="h-2.5 w-2.5" strokeWidth={2} />
                {s.label}
              </span>
            }
          />

          {!seq.optedOut && seq.steps.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] text-slate-500" style={{ fontWeight: 600 }}>
                Sequence · stops on reply
              </div>
              <div className="space-y-2">
                {seq.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                      step.status === "sent" ? "bg-emerald-500"
                      : step.status === "skipped" ? "bg-slate-200"
                      : "bg-slate-300"
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-slate-900" style={{ fontWeight: 500 }}>
                        {STEP_LABEL[step.kind]}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {step.sentAt ? `Sent ${step.sentAt}` : `Scheduled ${step.scheduledAt}`}
                        {step.status === "skipped" && " · Skipped (received reply)"}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 capitalize">{step.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-16 flex-shrink-0 text-[11px] text-slate-500" style={{ fontWeight: 500, paddingTop: 1 }}>
        {label}
      </div>
      <div className="min-w-0 text-[12px] text-slate-800">{value}</div>
    </div>
  );
}
