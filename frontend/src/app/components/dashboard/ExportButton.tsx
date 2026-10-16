import { useState } from "react";
import { Download } from "lucide-react";
import { dataExportSchema } from "@mushin/contracts";
import { apiDownload, apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../lib/toast";

/**
 * Data export (Scale plan). The server decides: a plan without export gets its upgrade message, a member is refused.
 * The file is a CSV without contact values and is kept for 24 hours.
 */
export function ExportButton({ kind }: { kind: "lists" | "campaigns" }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (user?.role !== "owner" && user?.role !== "admin") return null;
  async function run() {
    setBusy(true);
    try {
      const made = await apiRequest("/v1/exports", dataExportSchema, { method: "POST", body: { kind }, idempotencyKey: crypto.randomUUID() });
      await apiDownload(`/v1/exports/${made.id}/download`, `mushin-${kind}-${made.createdAt.slice(0, 10)}.csv`);
      toast.success(`Exported ${made.rowCount} ${made.rowCount === 1 ? "row" : "rows"}`, "The file stays available for 24 hours.");
    } catch (err) {
      toast.error("Not exported", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={() => void run()} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      <Download className="h-3.5 w-3.5" /> {busy ? "Exporting…" : "Export CSV"}
    </button>
  );
}
