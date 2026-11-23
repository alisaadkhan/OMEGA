import { useQuery } from "@tanstack/react-query";
import { staffAuditListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Badge, Card, CardTitle, DataTable, Empty, errText, fmtWhen } from "./kit";

/**
 * Every change made on Data Sources (owner, 23 Nov: "a complete audit that is never deleted"): each pause and resume
 * of a provider, who made it, when and why. Read from the staff audit log, which staff and the app can only add to,
 * and whose hash chain shows any change made to it directly in the database.
 */
export function DataSourceHistory() {
  const q = useQuery({ queryKey: ["admin", "audit", "ops.provider"], queryFn: () => adminRequest("/admin/v1/audit/search?action=ops.provider&limit=200", staffAuditListSchema) });
  return (
    <Card className="mt-6">
      <CardTitle title="Change history" sub="Every provider pause and resume, newest first. Entries can't be edited or removed." />
      {q.isPending ? <LoadingBlock lines={3} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.events.length === 0 ? (
        <Empty title="No changes yet" body="Pausing or resuming a provider is recorded here." />
      ) : (
        <DataTable head={["When", "Who", "Change", "Provider", "Reason"]} minWidth={640}>
          {q.data.events.map((e) => {
            const paused = e.action.endsWith("paused");
            const provider = typeof e.metadata["provider"] === "string" ? e.metadata["provider"] : e.targetId ?? "—";
            const reason = typeof e.metadata["reason"] === "string" ? e.metadata["reason"] : "—";
            return (
              <tr key={e.id} className="hover:bg-slate-50/70">
                <td className="whitespace-nowrap px-4 py-2.5 text-[11.5px] text-slate-500 tabular-nums">{fmtWhen(e.createdAt)}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-900">{e.staffName ?? "System"}</td>
                <td className="px-4 py-2.5"><Badge tone={paused ? "amber" : "emerald"} dot>{paused ? "Paused" : "Resumed"}</Badge></td>
                <td className="px-4 py-2.5 capitalize text-slate-700">{provider}</td>
                <td className="max-w-[280px] px-4 py-2.5 text-slate-600">{reason}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}
