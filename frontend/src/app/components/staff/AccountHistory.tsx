import type { ReactNode } from "react";
import type { StaffAccount } from "@mushin/contracts";
import { Badge, fmtAgo, fmtNum } from "./kit";

const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
    {children}
  </div>
);
const Row = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <li className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
    <span className="min-w-0 truncate text-slate-800">{left}</span>
    <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{right}</span>
  </li>
);
const None = ({ text }: { text: string }) => <p className="text-slate-500">{text}</p>;
const money = (minor: number, currency: string) => `${currency === "PKR" ? "Rs." : currency} ${fmtNum(Math.round(minor / 100))}`;

/** Everything an account did (owner, 22 Nov), from the staff history read. Search text is never stored. */
export function AccountHistory({ h }: { h: StaffAccount["history"] }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Searches", h.searches.total], ["Last 30 days", h.searches.last30Days], ["Contacts unlocked", h.revealedContacts], ["Emails sent", h.emailsSent]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200/80 bg-white p-2.5"><div className="text-[10px] font-bold uppercase text-slate-500">{k}</div><div className="mt-0.5 text-base font-extrabold tabular-nums text-slate-900">{fmtNum(v)}</div></div>
        ))}
      </div>
      <Block title={`Shortlists (${h.lists.length})`}>
        {h.lists.length === 0 ? <None text="No shortlists." /> : <ul className="space-y-1.5">{h.lists.map((l) => <Row key={l.id} left={<><span className="font-semibold">{l.name}</span> <span className="text-slate-500">· {l.creators} creators</span></>} right={fmtAgo(l.createdAt)} />)}</ul>}
      </Block>
      <Block title={`Campaigns (${h.campaigns.length})`}>
        {h.campaigns.length === 0 ? <None text="No campaigns." /> : <ul className="space-y-1.5">{h.campaigns.map((c) => <Row key={c.id} left={<><span className="font-semibold">{c.name}</span> <Badge tone={c.status === "active" ? "emerald" : "slate"}>{c.status}</Badge> <span className="text-slate-500">· {c.creators} creators</span></>} right={fmtAgo(c.createdAt)} />)}</ul>}
      </Block>
      <Block title={`Searches (${fmtNum(h.searches.charged)} charged)`}>
        {h.searches.recent.length === 0 ? <None text="No searches yet." /> : (
          <ul className="space-y-1.5">{h.searches.recent.map((s) => <Row key={s.at} left={<>{s.hadText ? "Typed search" : "Filter search"} · {fmtNum(s.results)} results{s.filters ? ` · ${s.filters} filter${s.filters === 1 ? "" : "s"}` : ""}{s.charged ? " · charged" : ""}</>} right={fmtAgo(s.at)} />)}</ul>
        )}
        <p className="mt-1 text-[11px] text-slate-500">What was typed is never stored, only that a search ran.</p>
      </Block>
      {h.savedSearches.length > 0 && (
        <Block title="Saved searches">
          <ul className="space-y-1.5">{h.savedSearches.map((s) => <Row key={`${s.name}${s.createdAt}`} left={<><span className="font-semibold">{s.name}</span>{s.queryText ? <span className="text-slate-500"> · “{s.queryText}”</span> : null}</>} right={fmtAgo(s.createdAt)} />)}</ul>
        </Block>
      )}
      <Block title="Live searches and refreshes">
        {h.jobs.length === 0 ? <None text="None." /> : <ul className="space-y-1.5">{h.jobs.map((j) => <Row key={j.id} left={<>{j.kind === "live" ? "Live search" : j.kind === "refresh" ? "Refresh" : "Added by link"}: {j.brief ?? (j.handle ? `@${j.handle}` : "—")} <Badge tone={j.status === "failed" ? "rose" : j.status === "completed" ? "emerald" : "cyan"}>{j.status}</Badge>{j.creditsCharged ? <span className="text-slate-500"> · {fmtNum(j.creditsCharged)} cr</span> : null}</>} right={fmtAgo(j.createdAt)} />)}</ul>}
      </Block>
      <Block title="Payments">
        {h.payments.length === 0 ? <None text="No payments." /> : <ul className="space-y-1.5">{h.payments.map((p) => <Row key={`${p.createdAt}${p.amountMinor}`} left={<>{p.kind === "topup" ? "Credit top-up" : "Subscription"} · {money(p.amountMinor, p.currency)}{p.refundedMinor ? ` (refunded ${money(p.refundedMinor, p.currency)})` : ""} <Badge tone={p.status === "completed" ? "emerald" : "amber"}>{p.status}</Badge></>} right={fmtAgo(p.createdAt)} />)}</ul>}
      </Block>
    </>
  );
}
