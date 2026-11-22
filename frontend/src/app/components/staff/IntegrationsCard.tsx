import { useQuery } from "@tanstack/react-query";
import { staffIntegrationsSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Badge, Card, CardTitle, errText } from "./kit";

const GROUPS = ["AI", "Creator data", "Search", "Email", "Payments", "Platform"] as const;

/**
 * Every outside service MUSHIN can use, with its backup keys (owner, 22 Nov), and whether the live server has each set.
 * Keys are never shown; usage and errors for the ones that run are in the tables above.
 */
export function IntegrationsCard() {
  const q = useQuery({ queryKey: ["admin", "integrations"], queryFn: () => adminRequest("/admin/v1/ops/integrations", staffIntegrationsSchema) });
  const all = q.data?.integrations ?? [];
  const set = all.filter((i) => i.configured).length;
  return (
    <Card label="All APIs and backup keys" className="mt-6">
      <CardTitle title="All APIs and backup keys" sub="What this server can use. Backups take over when the key before them runs out or is refused." right={q.data ? <Badge tone="cyan">{set} of {all.length} set</Badge> : undefined} />
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {GROUPS.map((g) => {
            const items = all.filter((i) => i.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g}</div>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
                  {items.map((i) => (
                    <li key={i.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-900">{i.name}{i.role === "backup" && <Badge tone="indigo">Backup</Badge>}</div>
                        <div className="truncate text-[11.5px] text-slate-500">{i.purpose}</div>
                      </div>
                      {i.configured ? <Badge tone="emerald" dot>Set</Badge> : <Badge tone={i.role === "backup" ? "slate" : "amber"} dot>Not set</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
