import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { staffApiCallsSchema, staffApiKeysSchema, type StaffApiKey } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { Badge, Card, CardTitle, Drawer, Empty, fmtAgo, fmtNum, fmtWhen } from "./kit";

const GROUP_ORDER = ["AI", "Creator data", "Search", "Email", "Payments", "Platform"] as const;

function KeyCard({ k, onOpen }: { k: StaffApiKey; onOpen: () => void }) {
  const state = !k.configured ? { tone: "slate" as const, text: "Not set" } : k.activeNow > 0 ? { tone: "emerald" as const, text: "Running now" } : k.errors24h > 0 && k.errors24h >= k.calls24h ? { tone: "rose" as const, text: "Failing" } : k.errors24h > 0 ? { tone: "amber" as const, text: "Some errors" } : { tone: "cyan" as const, text: "Ready" };
  const errPct = k.calls24h ? Math.round((k.errors24h / k.calls24h) * 100) : 0;
  return (
    <div className={`flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${state.tone === "rose" ? "border-rose-200" : state.tone === "emerald" ? "border-emerald-200" : "border-slate-200/90"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${state.tone === "emerald" ? "animate-pulse bg-emerald-500" : state.tone === "rose" ? "bg-rose-500" : state.tone === "amber" ? "bg-amber-500" : state.tone === "cyan" ? "bg-cyan-500" : "bg-slate-300"}`} />
            <h3 className="truncate text-[13px] font-bold text-slate-900">{k.name}</h3>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{k.purpose}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={state.tone}>{state.text}</Badge>
          {k.role === "backup" && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Backup</span>}
        </div>
      </div>
      {k.metered ? (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 px-2 py-1.5"><dt className="text-[9.5px] font-bold uppercase text-slate-500">24 h</dt><dd className="text-sm font-extrabold tabular-nums text-slate-900">{fmtNum(k.calls24h)}</dd></div>
            <div className={`rounded-xl px-2 py-1.5 ${errPct > 20 ? "bg-rose-50" : "bg-slate-50"}`}><dt className="text-[9.5px] font-bold uppercase text-slate-500">Errors</dt><dd className={`text-sm font-extrabold tabular-nums ${errPct > 20 ? "text-rose-700" : "text-slate-900"}`}>{fmtNum(k.errors24h)}</dd></div>
            <div className="rounded-xl bg-slate-50 px-2 py-1.5"><dt className="text-[9.5px] font-bold uppercase text-slate-500">Month</dt><dd className="text-sm font-extrabold tabular-nums text-slate-900">{fmtNum(k.callsMonth)}</dd></div>
          </dl>
          {k.quota && (
            <div className="mt-2">
              <div className="flex justify-between text-[10.5px] text-slate-500"><span>Quota</span><span className="tabular-nums">{fmtNum(Math.round(k.quota.used))} / {fmtNum(Math.round(k.quota.limit))} {k.quota.unit}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${k.quota.used / k.quota.limit > 0.85 ? "bg-rose-500" : "bg-cyan-500"}`} style={{ width: `${Math.min(100, (k.quota.used / Math.max(1, k.quota.limit)) * 100)}%` }} /></div>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>{k.lastCallAt ? `Last used ${fmtAgo(k.lastCallAt)}` : "Not used this month"}{k.costMonthUsd > 0 ? ` · $${k.costMonthUsd.toFixed(2)}` : ""}</span>
            <button type="button" onClick={onOpen} className="btn btn-primary btn-sm">Open</button>
          </div>
          {k.lastErrorCode && <p className="mt-1.5 truncate text-[10.5px] text-rose-700" title={k.lastErrorCode}>Last error: {k.lastErrorCode}</p>}
        </>
      ) : (
        <p className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">{k.configured ? "Set on this server. Its use is not counted per request." : "Not set on this server."}</p>
      )}
    </div>
  );
}

function CallsDrawer({ k, onClose }: { k: StaffApiKey; onClose: () => void }) {
  const q = useQuery({ queryKey: ["admin", "api-keys", k.key, "calls"], queryFn: () => adminRequest(`/admin/v1/ops/api-keys/${encodeURIComponent(k.key)}/calls?limit=200`, staffApiCallsSchema), refetchInterval: 15_000 });
  const calls = q.data?.calls ?? [];
  return (
    <Drawer eyebrow="API requests" title={k.name} sub={`Newest first · ${fmtNum(k.calls24h)} in the last 24 hours · refreshes every 15 s`} onClose={onClose}>
      {q.isPending ? <p className="text-slate-500">Loading…</p> : q.isError ? <p className="text-rose-700">Couldn't load the requests.</p> : calls.length === 0 ? <Empty title="No requests yet" body="Requests through this key appear here as customers and the catalogue use it." /> : (
        <ul className="space-y-2">
          {calls.map((c, i) => (
            <li key={`${c.at}-${i}`} className={`rounded-xl border p-3 ${c.status === "error" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-bold text-slate-900">{c.account?.name ?? "MUSHIN (catalogue or system)"}</div>
                  <div className="truncate text-[11px] text-slate-500">{c.userEmail ?? "No person (background work)"}</div>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={c.status === "ok" ? "emerald" : "rose"}>{c.status === "ok" ? "OK" : c.errorCode ?? "Error"}</Badge>
                  <div className="mt-1 text-[10.5px] text-slate-500">{fmtWhen(c.at)}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">{c.operation.replaceAll("_", " ")}</span>
                {c.job && <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 font-semibold text-cyan-800">{c.job.kind.replaceAll("_", " ")} · {c.job.status}</span>}
                {c.model && <span className="text-slate-500">{c.model}</span>}
                <span className="text-slate-400">{c.latencyMs} ms{c.costUsd > 0 ? ` · $${c.costUsd.toFixed(4)}` : ""}</span>
              </div>
              {(c.job?.search || c.job?.target) && <p className="mt-1.5 text-[12px] text-slate-700">{c.job.search ? <>Searched: <strong>“{c.job.search}”</strong></> : <>Added: <strong>{c.job.target}</strong></>}</p>}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/** Every API MUSHIN uses, backups included, with what each key is doing (owner, 25 Nov). */
export function ApiKeysPanel() {
  const q = useQuery({ queryKey: ["admin", "api-keys"], queryFn: () => adminRequest("/admin/v1/ops/api-keys", staffApiKeysSchema), refetchInterval: 20_000 });
  const [open, setOpen] = useState<StaffApiKey | null>(null);
  const keys = q.data?.keys ?? [];
  const running = keys.filter((k) => k.activeNow > 0).length;
  return (
    <Card label="Every API">
      <CardTitle title="Every API and key" sub="All services MUSHIN uses, backups included. Open one to see each request: which account and person, and what they searched." right={<Badge tone={running ? "emerald" : "slate"} dot>{running ? `${running} running now` : "Idle"}</Badge>} />
      {q.isPending ? <p className="text-sm text-slate-500">Loading…</p> : q.isError ? <p className="text-sm text-rose-700">Couldn't load the API list.</p> : (
        <div className="space-y-5">
          {GROUP_ORDER.map((g) => {
            const list = keys.filter((k) => k.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{g}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{list.map((k) => <KeyCard key={k.key} k={k} onOpen={() => setOpen(k)} />)}</div>
              </div>
            );
          })}
        </div>
      )}
      {open && <CallsDrawer k={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

