import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ListChecks, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { DiscoveryJob } from "@mushin/contracts";
import { useActiveJobs } from "../../api/discovery";
import { isOpenJob, jobStatusText, jobTitle, newlyFinished } from "../../api/discovery-mapping";
import { creatorStub } from "../../api/search-mapping";
import { useToast } from "../../lib/toast";
import type { Creator } from "./CreatorProfilePanel";

/** Running and recently finished creator data jobs (SRS §3.1: visible progress; the bell takes over in sub-project 7). */
export function JobTray({ onOpenCreator, onViewResults }: { onOpenCreator: (c: Creator) => void; onViewResults: (jobId: string) => void }) {
  const { data } = useActiveJobs();
  const jobs = data?.jobs ?? [];
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const prev = useRef<DiscoveryJob[]>([]);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    for (const j of newlyFinished(prev.current, jobs)) {
      if (j.creatorId) void qc.invalidateQueries({ queryKey: ["creator", j.creatorId] });
      if (j.kind === "live") void qc.invalidateQueries({ queryKey: ["discovery", "results", j.id] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      if (j.status === "completed") toast.success(`${jobTitle(j).replace(/^Adding/, "Added").replace(/^Refreshing/, "Refreshed")}`, jobStatusText(j));
      else toast.error(`Couldn't finish: ${jobTitle(j)}`, jobStatusText(j));
    }
    prev.current = jobs;
  }, [jobs, qc, toast]);

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  if (visible.length === 0) return null;
  const running = visible.filter(isOpenJob).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        style={{ fontWeight: 500 }}
        aria-label="Creator data jobs"
      >
        {running > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" /> : <ListChecks className="h-3.5 w-3.5 text-slate-500" />}
        {running > 0 ? `${running} running` : "Jobs"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {visible.map((j) => (
            <div key={j.id} className="border-b border-slate-100 px-3 py-2.5 last:border-0">
              <div className="flex items-center gap-2 text-xs">
                {isOpenJob(j) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                ) : j.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-600" />
                )}
                <span className="text-slate-900" style={{ fontWeight: 600 }}>{jobTitle(j)}</span>
                {!isOpenJob(j) && (
                  <button onClick={() => setDismissed((d) => new Set(d).add(j.id))} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">
                    Dismiss
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{jobStatusText(j)}</p>
              {j.status === "completed" && j.kind === "live" && j.live && j.live.found > 0 && (
                <button
                  onClick={() => {
                    onViewResults(j.id);
                    setOpen(false);
                  }}
                  className="mt-1.5 text-[11px] text-indigo-600 hover:text-indigo-700"
                  style={{ fontWeight: 600 }}
                >
                  View results
                </button>
              )}
              {j.status === "completed" && j.kind !== "live" && j.creatorId && (
                <button
                  onClick={() => {
                    onOpenCreator(creatorStub(j.creatorId ?? "", j.platform ?? "instagram", j.handle ?? ""));
                    setOpen(false);
                  }}
                  className="mt-1.5 text-[11px] text-indigo-600 hover:text-indigo-700"
                  style={{ fontWeight: 600 }}
                >
                  Open profile
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
