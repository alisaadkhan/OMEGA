import { useState } from "react";
import { lookupResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useStartJob } from "../../api/discovery";
import { creatorStub, matchToCreator } from "../../api/search-mapping";
import { useConfirm, useToast } from "../../lib/toast";
import type { Creator } from "./CreatorProfilePanel";

/** SRS REQ-02.07: the add-by-URL fallback, so an empty database is never a dead end. */
export function AddByLinkDialog({ open, onClose, onOpenCreator }: { open: boolean; onClose: () => void; onOpenCreator: (c: Creator) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartJob();
  const confirm = useConfirm();
  const toast = useToast();
  if (!open) return null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const found = await apiRequest(`/v1/creators/lookup?q=${encodeURIComponent(url.trim())}`, lookupResponseSchema);
      const match = found.matches[0];
      if (match) {
        onOpenCreator(matchToCreator(match));
        onClose();
        return;
      }
      const a = found.addable;
      if (!a) {
        setError("Paste a public Instagram, TikTok or YouTube profile link.");
        return;
      }
      const ok = await confirm({
        title: `Add @${a.handle} for ${a.cost} credits?`,
        body: "MUSHIN fetches their public profile and assesses it. If it fails, the credits are returned.",
        confirmLabel: `Add for ${a.cost} credits`,
        cancelLabel: "Not now",
      });
      if (!ok) return;
      const r = await start.mutateAsync({ kind: "add_by_url", url: a.url, confirmedCost: a.cost });
      if (r.status === "known") onOpenCreator(creatorStub(r.creatorId, a.platform, a.handle));
      else toast.info(`Adding @${a.handle}…`, "Follow its progress from the Jobs button in the top bar.");
      setUrl("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>Add a creator by profile link</div>
        <p className="mt-1 text-xs text-slate-500">Paste a public Instagram, TikTok or YouTube profile. If MUSHIN already knows them, their profile opens for free.</p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && void submit()}
          placeholder="https://instagram.com/creator"
          aria-label="Profile link"
          className="mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !url.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
            style={{ fontWeight: 500 }}
          >
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
