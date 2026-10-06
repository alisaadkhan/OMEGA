import { motion } from "motion/react";
import {
  ArrowUpRight,
  AlertCircle,
  Search,
  Radio,
  Mail,
  RefreshCw,
  Lock,
  Smartphone,
  CreditCard,
  Plus,
  Check,
} from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { CURRENT_PLAN } from "../../lib/credits";
import { COPY } from "../../lib/copy";

/**
 * Credits & billing — spec §13.
 * All money is PKR (Rupees) — the product operates Pakistan-first.
 * Usage is shown as a credit-use log tied to the actual operation that spent
 * credits (bridges ActivityLog semantics), not an abstract bar chart. Reserved
 * credits (§13.2, §22) are held while a live search runs and released on
 * failure or partial completion.
 */

type OpKind = "fast" | "live" | "reveal" | "update";

const OP_META: Record<OpKind, { label: string; icon: any; tone: string }> = {
  fast: { label: COPY.searchExisting, icon: Search, tone: "bg-slate-100 text-slate-600" },
  live: { label: COPY.findNew, icon: Radio, tone: "bg-indigo-50 text-indigo-700" },
  reveal: { label: COPY.revealContact, icon: Mail, tone: "bg-emerald-50 text-emerald-700" },
  update: { label: COPY.refreshData, icon: RefreshCw, tone: "bg-amber-50 text-amber-700" },
};

// Credit-use log — each row is one real operation, with the credits it cost.
const usageLog: { kind: OpKind; detail: string; when: string; credits: number }[] = [
  { kind: "live", detail: "\"bridal Lahore 50k+ 5%+\" · 24 creators enriched", when: "2h ago", credits: 480 },
  { kind: "reveal", detail: "@ayeshamalik email revealed", when: "3h ago", credits: 40 },
  { kind: "update", detail: "@sanaa.k profile refreshed", when: "5h ago", credits: 20 },
  { kind: "reveal", detail: "@usmantariq email revealed", when: "Yesterday", credits: 40 },
  { kind: "live", detail: "\"skincare Karachi micro\" · 18 creators enriched", when: "Yesterday", credits: 360 },
  { kind: "fast", detail: "\"fashion Islamabad\" · database results", when: "2 days ago", credits: 0 },
];

// Spend caps in PKR (§13).
const caps = [
  { label: "Monthly hard cap", value: "Rs. 1,400,000", pct: 56 },
  { label: "Daily soft cap", value: "Rs. 70,000", pct: 32 },
  { label: "Per-search cap", value: "Rs. 14,000 / run", pct: 80 },
];

// Invoices in PKR.
const invoices = [
  { month: "Apr 2026", amount: "Rs. 139,600", status: "Paid" },
  { month: "Mar 2026", amount: "Rs. 139,600", status: "Paid" },
  { month: "Feb 2026", amount: "Rs. 139,600", status: "Paid" },
  { month: "Jan 2026", amount: "Rs. 69,800", status: "Paid" },
];

// Payment methods — Pakistan-first wallets plus card. Dummy saved data.
type PayMethod = {
  id: string;
  kind: "easypaisa" | "jazzcash" | "card";
  label: string;
  detail: string;
  badge: string;
  tone: string;
  primary: boolean;
};

const paymentMethods: PayMethod[] = [
  { id: "pm-1", kind: "easypaisa", label: "EasyPaisa wallet", detail: "0300 •••• 4521", badge: "EP", tone: "bg-emerald-600", primary: true },
  { id: "pm-2", kind: "jazzcash", label: "JazzCash wallet", detail: "0321 •••• 8890", badge: "JC", tone: "bg-red-600", primary: false },
  { id: "pm-3", kind: "card", label: "Visa debit", detail: "•••• •••• •••• 6042", badge: "", tone: "bg-slate-800", primary: false },
];

export function Billing({ credits }: { credits: number }) {
  const cap = CURRENT_PLAN.credits;
  const reserved = 0; // No live search running right now → nothing held.
  const available = Math.max(0, credits - reserved);
  const used = cap - credits;
  const pct = Math.min(100, (used / cap) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Credits &amp; billing
        </h1>
        <p className="mt-1 text-sm text-slate-500">Track credit use per operation, manage spend caps, and review invoices.</p>
      </div>

      {/* Balance row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceTile label="Available credits" value={available} accent />
        <BalanceTile label="Reserved (held for running searches)" value={reserved} sub={reserved === 0 ? "Nothing running — no credits held" : "Released automatically on failure or partial completion"} />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider text-slate-400">Current plan</div>
          <div className="mt-1 text-white" style={{ fontSize: "1.25rem", fontWeight: 600 }}>{CURRENT_PLAN.name}</div>
          <div className="mt-4 text-xs text-slate-400">Credits used this period</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
              <AnimatedNumber value={used} />
            </span>
            <span className="text-sm text-slate-400">of {cap.toLocaleString()} credits</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-300"
            />
          </div>
          <button className="mt-6 w-full rounded-md bg-white px-3 py-2 text-sm text-slate-900 transition-all hover:-translate-y-px hover:shadow-md">
            Upgrade plan
          </button>
        </motion.div>
      </div>

      {/* Reservation model explainer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-xs text-indigo-900">
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500" strokeWidth={2} />
        <div style={{ lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>How live discovery is billed.</span>{" "}
          When you start a live search we reserve the estimated credits up front. You're only charged
          for creators actually enriched — if a search fails or completes partially, the unused reserve
          is released back to your balance automatically.
        </div>
      </div>

      {/* Credit-use log */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Credit-use log</div>
            <div className="text-xs text-slate-500">Every operation that spent credits</div>
          </div>
          <button className="text-xs text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>Export CSV</button>
        </div>
        <div className="divide-y divide-slate-100">
          {usageLog.map((row, i) => {
            const m = OP_META[row.kind];
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${m.tone}`}>
                  <m.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{m.label}</span>
                    <span className="text-[11px] text-slate-400">{row.when}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">{row.detail}</div>
                </div>
                <span className={`flex-shrink-0 tabular-nums text-sm ${row.credits === 0 ? "text-slate-400" : "text-slate-900"}`} style={{ fontWeight: 600 }}>
                  {row.credits === 0 ? "Free" : `−${row.credits}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Spend caps */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Spend caps</div>
            <button className="text-xs text-indigo-600 hover:text-indigo-700">Edit</button>
          </div>
          {caps.map((c) => (
            <div key={c.label} className="mt-4 border-t border-slate-100 pt-4 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-700">{c.label}</span>
                <span className="tabular-nums text-sm text-slate-900" style={{ fontWeight: 500 }}>{c.value}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${c.pct}%` }}
                  transition={{ duration: 0.8 }}
                  className={`h-full rounded-full ${c.pct > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                />
              </div>
            </div>
          ))}
          <div className="mt-5 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            The per-search cap is approaching its threshold. Review before your next live discovery.
          </div>
        </div>

        {/* Invoices */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Recent invoices</div>
          <div className="mt-4 space-y-3">
            {invoices.map((i) => (
              <div key={i.month} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                <div>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{i.month}</div>
                  <div className="text-xs text-slate-500">Growth plan</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{i.status}</span>
                  <span className="tabular-nums text-sm text-slate-900" style={{ fontWeight: 500 }}>{i.amount}</span>
                  <button className="text-slate-400 hover:text-slate-700">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment methods — EasyPaisa / JazzCash / card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Payment methods</div>
            <div className="text-xs text-slate-500">How you top up credits and pay invoices.</div>
          </div>
          <button className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
            <Plus className="h-3 w-3" strokeWidth={2} /> Add method
          </button>
        </div>
        <div className="mt-4 space-y-2.5">
          {paymentMethods.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white ${m.tone}`}>
                {m.kind === "card" ? (
                  <CreditCard className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <span className="text-[11px]" style={{ fontWeight: 700 }}>{m.badge}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{m.label}</span>
                  {m.primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
                      <Check className="h-2.5 w-2.5" strokeWidth={2.5} /> Primary
                    </span>
                  )}
                </div>
                <div className="tabular-nums text-xs text-slate-500">{m.detail}</div>
              </div>
              {m.kind !== "card" && <Smartphone className="h-4 w-4 flex-shrink-0 text-slate-300" strokeWidth={1.75} />}
              <button className="flex-shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                {m.primary ? "Edit" : "Make primary"}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400" style={{ lineHeight: 1.5 }}>
          Sample data for demonstration. EasyPaisa and JazzCash top-ups settle instantly; card
          payments may take a few minutes to reflect in your balance.
        </p>
      </div>
    </div>
  );
}

function BalanceTile({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 tabular-nums ${accent ? "text-slate-900" : "text-slate-700"}`} style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
        <AnimatedNumber value={value} />
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>{sub}</div>}
    </motion.div>
  );
}
