import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import { z } from "zod";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { errText } from "./kit";

const avatarSchema = z.object({ avatar: z.string().nullable() });
const KEY = ["admin", "my-avatar"] as const;
const initialsOf = (name: string) => name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export function useMyAvatar() {
  return useQuery({ queryKey: KEY, queryFn: () => adminRequest("/admin/v1/me/avatar", avatarSchema), staleTime: 5 * 60_000 }).data?.avatar ?? null;
}

/** The signed-in staff member's photo, or their initials. */
export function StaffAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const src = useMyAvatar();
  const style = { width: size, height: size };
  return src ? (
    <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <div style={style} className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">{initialsOf(name)}</div>
  );
}

/** Resize to a 160 px square (centre crop) in the browser, so the upload is small whatever the camera made. */
async function toSquare(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  canvas.getContext("2d")?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 160, 160);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

/** Settings: upload or remove your profile photo (owner, 25 Nov). */
export function AvatarUpload({ name }: { name: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = useMyAvatar() !== null;
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  const remove = useMutation({ mutationFn: () => adminRequest("/admin/v1/me/avatar", null, { method: "DELETE" }), onSuccess: () => { done(); toast.success("Photo removed"); }, onError: (e) => toast.error("Photo not removed", errText(e)) });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error("Use a PNG, JPEG or WebP image");
    setBusy(true);
    try {
      await adminRequest("/admin/v1/me/avatar", null, { method: "PUT", body: { avatar: await toSquare(file) } });
      done();
      toast.success("Photo updated");
    } catch (e) {
      toast.error("Photo not saved", errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex items-center gap-4">
      <StaffAvatar name={name} size={64} />
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a profile photo" onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn btn-primary btn-sm"><Camera className="h-3.5 w-3.5" />{busy ? "Uploading…" : has ? "Change photo" : "Upload photo"}</button>
        {has && <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="btn btn-outline btn-sm"><Trash2 className="h-3.5 w-3.5" />Remove</button>}
      </div>
    </div>
  );
}
