import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { importDetailSchema, IMPORT_MAX_BYTES, type ImportDetail } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAddToList, useLists } from "../../api/lists";
import { useToast } from "../../lib/toast";

const STATUS_TEXT: Record<ImportDetail["rows"][number]["status"], string> = {
  matched: "In MUSHIN",
  not_in_catalogue: "Not in MUSHIN yet",
  invalid: "Not usable",
  duplicate: "Duplicate in file",
};

/**
 * Import your own creator list (CSV). Rows are matched to creators already in MUSHIN by profile link; your niche,
 * country and email notes stay private to your workspace and never change MUSHIN's catalogue. Nothing is fetched.
 */
export function ImportCreators({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const lists = useLists();
  const addToList = useAddToList();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [reviewedOn, setReviewedOn] = useState("");
  const [result, setResult] = useState<ImportDetail | null>(null);
  const [listId, setListId] = useState("");
  const [key] = useState(() => crypto.randomUUID());

  const upload = useMutation({
    mutationFn: () => apiRequest("/v1/imports", importDetailSchema, { method: "POST", body: { csv, source, reviewedOn: reviewedOn || null, fileName }, idempotencyKey: key }),
    onSuccess: setResult,
    onError: (err) => toast.error("Import failed", err instanceof Error ? err.message : undefined),
  });

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > IMPORT_MAX_BYTES) {
      toast.error("File too large", "Import a CSV of up to 1 MB.");
      return;
    }
    setFileName(f.name.slice(0, 200));
    setCsv(await f.text());
  };
  const matched = (result?.rows ?? []).filter((r) => r.status === "matched" && r.creatorId).map((r) => r.creatorId as string);
  const field = "mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm";

  return (
    <section aria-label="Import creators" className="rounded-2xl border border-slate-200/80 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Import your creator list (CSV)</h2>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 underline">Close</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Columns: profile_url (required), platform, niche, country, email. Your notes stay private to your workspace; profiles not in MUSHIN are listed, not fetched.</p>
      {!result ? (
        <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (csv && source.trim()) upload.mutate(); }}>
          <label className="text-xs text-slate-600 sm:col-span-2">CSV file
            <input type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} className={field} />
          </label>
          <label className="text-xs text-slate-600">Where the list comes from
            <input value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} className={field} placeholder="e.g. Agency roster, Oct 2026" />
          </label>
          <label className="text-xs text-slate-600">Last checked (optional)
            <input type="date" value={reviewedOn} onChange={(e) => setReviewedOn(e.target.value)} className={field} />
          </label>
          <button type="submit" disabled={!csv || !source.trim() || upload.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 sm:col-span-2" style={{ fontWeight: 600 }}>
            {upload.isPending ? "Importing…" : "Import"}
          </button>
        </form>
      ) : (
        <div className="mt-3 space-y-3 text-xs">
          <p className="text-slate-700">
            {result.counts.total} rows: {result.counts.matched} in MUSHIN, {result.counts.notInCatalogue} not in MUSHIN yet, {result.counts.invalid} not usable, {result.counts.duplicate} duplicates.
          </p>
          {matched.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-slate-600">Add the {matched.length} matched creator(s) to
                <select value={listId} onChange={(e) => setListId(e.target.value)} className={field}>
                  <option value="">Choose a list…</option>
                  {(lists.data?.lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <button type="button" disabled={!listId || addToList.isPending} onClick={() => addToList.mutate({ id: listId, creatorIds: matched }, { onSuccess: () => toast.success("Added to the list", "Creators below MUSHIN's minimum are refused and listed by the list."), onError: (err) => toast.error("Couldn't add them", err instanceof Error ? err.message : undefined) })} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">
                Add to list
              </button>
            </div>
          )}
          <table className="w-full text-left">
            <thead className="text-slate-500"><tr><th className="py-1">Row</th><th>Profile</th><th>Outcome</th><th>Notes</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.rowNo} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-500">{r.rowNo}</td>
                  <td className="max-w-[220px] truncate pr-2" title={r.inputUrl}>{r.inputUrl}</td>
                  <td className="pr-2">{STATUS_TEXT[r.status]}</td>
                  <td className="text-slate-500">{[r.declaredNiche, r.declaredCountry, r.emailStored ? "email saved for your team" : null, r.problem].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
