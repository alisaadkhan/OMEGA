import { BarChart3, Info } from "lucide-react";
import type { AudienceDimension, AudienceEstimate as Estimate } from "@mushin/contracts";
import { useAudience, useRequestAudience } from "../../api/audience";
import { audienceView, confidenceText, countryName, percentText, rangeText, sampleText } from "../../api/audience-mapping";
import { useConfirm, useToast } from "../../lib/toast";
import { Spinner } from "./states";

/**
 * Optional, on-demand audience estimate (spec 2026-10-13-audience-estimate-design). Nothing is computed or charged until
 * the user asks and confirms the quote; results are labelled as modeled estimates of sampled commenters.
 */
export function AudienceEstimate({ creatorId, handle }: { creatorId: string; handle: string }) {
  const audience = useAudience(creatorId);
  const request = useRequestAudience(creatorId);
  const confirm = useConfirm();
  const toast = useToast();
  const s = audience.data;
  const view = audience.isError ? "error" : audienceView(s);

  async function onEstimate() {
    if (!s) return;
    const ok = await confirm({
      title: `Estimate @${handle}'s audience for ${s.cost} credits?`,
      body:
        "MUSHIN reads public comments on their recent YouTube videos and counts where the commenters say they are from. You're charged only if an estimate can be produced — if the public evidence is too thin or the check fails, the credits are returned. Age and gender can't be estimated from public data.",
      confirmLabel: `Estimate for ${s.cost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    request.mutate(s.cost, {
      onError: (err) => toast.error("Couldn't start the estimate", err instanceof Error ? err.message : undefined),
    });
  }

  return (
    <div className="mt-3 space-y-3 text-xs">
      {view === "loading" && <p className="flex items-center gap-2 text-[11px] text-slate-500"><Spinner /> Loading…</p>}
      {view === "error" && <p className="text-[11px] text-slate-500">Audience details couldn't be loaded. Please try again.</p>}
      {view === "unavailable" && <p className="text-[11px] text-slate-500">{s?.availabilityMessage}</p>}

      {(view === "idle" || view === "failed") && s && (
        <>
          {view === "failed" && s.job?.error && <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">{s.job.error.message}</p>}
          <p className="text-[11px] text-slate-500">
            Not calculated yet. MUSHIN can estimate where this creator's recent YouTube commenters are from, using the country their public channel states. It runs only when you ask.
          </p>
          <button
            onClick={() => void onEstimate()}
            disabled={request.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 px-3 py-3 text-xs text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-60"
            style={{ fontWeight: 500 }}
          >
            {request.isPending ? <Spinner /> : <BarChart3 className="h-3.5 w-3.5" strokeWidth={2} />}
            Estimate Audience Demographics — {s.cost} credits
          </button>
        </>
      )}

      {view === "running" && (
        <p className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
          <Spinner /> Reading recent public comments and counting stated countries… This usually takes under a minute.
        </p>
      )}

      {view === "result" && s?.estimate && <Result e={s.estimate} charged={s.job?.status === "completed" ? s.job.creditsCharged : null} />}
    </div>
  );
}

function Result({ e, charged }: { e: Estimate; charged: number | null }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-indigo-100 bg-indigo-50/50 px-2.5 py-2 text-[11px] text-indigo-900">
        <div style={{ fontWeight: 600 }}>{e.label}</div>
        <div className="mt-0.5 text-indigo-800">Sampled active commenters — not the creator's whole follower audience.</div>
      </div>

      <Dimension title="Country" d={e.country} />
      {e.age.status === "not_estimable" && e.gender.status === "not_estimable" && e.age.reason === e.gender.reason ? (
        <Dimension title="Age and gender" d={e.age} />
      ) : (
        <>
          <Dimension title="Age" d={e.age} />
          <Dimension title="Gender" d={e.gender} />
        </>
      )}

      <div className="space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <div>{sampleText(e.sample)}</div>
        <div>
          Source: {e.platform === "youtube" ? "YouTube" : e.platform} public data · collected {new Date(e.collectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · reused free until{" "}
          {new Date(e.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </div>
        {charged !== null && <div>{charged > 0 ? `${charged} credits used for this estimate.` : "No credits used."}</div>}
        <div className="text-slate-500">Method {e.methodVersion}</div>
      </div>

      <details className="text-[11px] text-slate-600">
        <summary className="flex cursor-pointer items-center gap-1 text-slate-700"><Info className="h-3 w-3" /> Limitations</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {e.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </div>
  );
}

function Dimension({ title, d }: { title: string; d: AudienceDimension }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-slate-900" style={{ fontWeight: 600 }}>{title}</span>
        {d.status === "estimated" && <span className="text-[10px] text-slate-500">{confidenceText(d.confidence)} · {d.classified} commenters</span>}
      </div>
      {d.status === "estimated" ? (
        <ul className="mt-1.5 space-y-1.5">
          {d.shares.map((sh) => (
            <li key={sh.code}>
              <div className="flex items-baseline justify-between text-slate-700">
                <span>{countryName(sh.code)}</span>
                <span className="tabular-nums">
                  <span style={{ fontWeight: 600 }}>{percentText(sh, d.displayStep)}</span>
                  <span className="ml-1 text-[10px] text-slate-500">likely {rangeText(sh)}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${Math.max(2, Math.round(sh.share * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
          <div style={{ fontWeight: 600 }}>Insufficient public evidence</div>
          <div className="mt-0.5 text-slate-500">{d.reason}</div>
        </div>
      )}
    </div>
  );
}
