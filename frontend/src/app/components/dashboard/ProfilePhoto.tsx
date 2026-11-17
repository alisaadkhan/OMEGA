import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Camera, Trash2 } from "lucide-react";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useToast } from "../../lib/toast";

const SIZE = 256;

/** Crops the picked image to a centred square and resizes it to 256 px JPEG, so the upload is small (about 20–40 KB). */
async function squareJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the photo.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Profile photo (owner, 17 Nov): upload, replace or remove; stored on your own account and shown in the app header. */
export function ProfilePhoto({ initials, shown, avatar }: { initials: string; shown: string; avatar: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Only an uploaded photo counts: the generated initials picture is not a photo to remove.
  const photo = avatar?.startsWith("data:image/") ? avatar : null;

  async function save(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error("Choose a PNG, JPEG or WebP image");
    if (file.size > 10_000_000) return toast.error("That image is too large", "Choose one under 10 MB.");
    setBusy(true);
    try {
      const image = await squareJpeg(file);
      qc.setQueryData(["me"], await apiRequest("/v1/me/avatar", meResponseSchema, { method: "PUT", body: { image } }));
      toast.success("Profile photo saved");
    } catch (e) {
      toast.error("Couldn't save the photo", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      qc.setQueryData(["me"], await apiRequest("/v1/me/avatar", meResponseSchema, { method: "DELETE" }));
      toast.success("Profile photo removed");
    } catch (e) {
      toast.error("Couldn't remove the photo", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 flex flex-col items-start gap-5 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center">
      <span className="relative shrink-0">
        {photo ? (
          <img src={photo} alt="" className="h-20 w-20 rounded-full object-cover shadow-sm ring-4 ring-white" />
        ) : (
          <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-full bg-[#0A0F24] text-2xl font-semibold text-white shadow-sm ring-4 ring-white">{initials}</span>
        )}
        <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-100 text-cyan-800 shadow-sm">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
        </span>
      </span>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold text-slate-900">{shown}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a profile photo"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void save(f); }} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-50">
            <Camera className="h-3.5 w-3.5" aria-hidden /> {busy ? "Saving…" : photo ? "Change photo" : "Upload photo"}
          </button>
          {photo && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">PNG, JPEG or WebP. It's cropped to a square.</p>
      </div>
    </div>
  );
}
