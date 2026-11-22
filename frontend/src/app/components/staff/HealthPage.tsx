import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { OpsAlerts } from "../admin/OpsControls";
import { Badge, Card, PageHeader, errText, fmtWhen, type Tone } from "./kit";

const healthSchema = z.object({
  checks: z.array(z.object({ key: z.string(), name: z.string(), state: z.enum(["ok", "warning", "down", "not_set"]), detail: z.string() })),
  version: z.string().nullable(),
  environment: z.string().nullable(),
  at: z.string(),
});
const STATE: Record<"ok" | "warning" | "down" | "not_set", { tone: Tone; label: string }> = {
  ok: { tone: "emerald", label: "Working" },
  warning: { tone: "amber", label: "Needs a look" },
  down: { tone: "rose", label: "Down" },
  not_set: { tone: "slate", label: "Not set up" },
};

/** System Health (owner, 22 Nov: "watch over the entire system"): every check measured now, refreshed each minute. */
export function HealthPage({ canTest }: { canTest: boolean }) {
  const q = useQuery({ queryKey: ["admin", "health"], queryFn: () => adminRequest("/admin/v1/ops/health", healthSchema), refetchInterval: 60_000 });
  const down = q.data?.checks.filter((c) => c.state === "down").length ?? 0;
  const warn = q.data?.checks.filter((c) => c.state === "warning").length ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="System Health"
        sub={q.data ? `Checked ${fmtWhen(q.data.at)}${q.data.version ? ` · version ${q.data.version}` : ""}${q.data.environment ? ` · ${q.data.environment}` : ""}` : "Checking…"}
        actions={q.data ? <Badge tone={down ? "rose" : warn ? "amber" : "emerald"} dot>{down ? `${down} down` : warn ? `${warn} to look at` : "Everything measured is working"}</Badge> : undefined}
      />
      {q.isPending ? <LoadingBlock lines={6} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.checks.map((c) => (
            <Card key={c.key}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900">{c.name}</h2>
                <Badge tone={STATE[c.state].tone} dot>{STATE[c.state].label}</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{c.detail}</p>
            </Card>
          ))}
        </div>
      )}
      <OpsAlerts canTest={canTest} />
    </div>
  );
}
