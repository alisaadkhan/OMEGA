import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { attachmentDownloadSchema, attachmentListSchema, attachmentSchema, attachmentUploadSchema } from "@mushin/contracts";
import { useToast } from "../../lib/toast";

/** Any of the two API clients (customer apiRequest or staff adminRequest). */
type Requester = <S extends z.ZodType>(path: string, schema: S, init?: { method?: string; body?: unknown }) => Promise<z.output<S>>;

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX = 5 * 1024 * 1024;
const size = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Files on a support ticket (owner decision 2026-11-03): JPG, PNG, WebP or PDF up to 5 MB. The file goes straight to
 * private storage through a short-lived upload link; MUSHIN then checks its real type and contents before anyone can
 * download it. Downloads use a one-minute link and always save the file rather than open it in the page.
 */
export function TicketAttachments({ base, request, canUpload, queryKey }: { base: string; request: Requester; canUpload: boolean; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey, queryFn: () => request(base, attachmentListSchema) });

  async function upload(file: File) {
    if (!TYPES.has(file.type)) return toast.error("This file type can't be attached", "Use a JPG, PNG, WebP or PDF file.");
    if (file.size > MAX) return toast.error("This file is too large", "Files can be at most 5 MB.");
    setBusy(true);
    try {
      const { attachment, uploadUrl } = await request(base, attachmentUploadSchema, { method: "POST", body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
      if (!put.ok) throw new Error("The upload didn't finish. Please try again.");
      await request(`${base}/${attachment.id}/complete`, attachmentSchema, { method: "POST" });
      toast.success("File attached", file.name);
    } catch (err) {
      toast.error("Couldn't attach the file", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      void qc.invalidateQueries({ queryKey });
    }
  }

  async function download(id: string) {
    try {
      const { url } = await request(`${base}/${id}/download`, attachmentDownloadSchema);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener noreferrer";
      a.click();
    } catch (err) {
      toast.error("Couldn't download the file", err instanceof Error ? err.message : undefined);
    }
  }

  const files = list.data?.attachments ?? [];
  if (!canUpload && files.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Attachments">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => void download(f.id)} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                {f.contentType === "application/pdf" ? <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                <span className="truncate">{f.fileName}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{size(f.sizeBytes)} · {f.uploadedBy === "staff" ? "Support" : "Customer"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-200/60 ${busy ? "pointer-events-none opacity-50" : ""}`}>
          <Paperclip className="h-3.5 w-3.5" />
          {busy ? "Attaching…" : "Attach a file"}
          <span className="text-[10px] font-normal text-slate-500">JPG, PNG, WebP or PDF · up to 5 MB</span>
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      )}
    </div>
  );
}
