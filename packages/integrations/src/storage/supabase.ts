import { AppError } from "@mushin/core";
import type { ObjectStorage } from "./types";

type Options = { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number };

const unavailable = (cause?: unknown) =>
  new AppError("PROVIDER_UNAVAILABLE", "File storage is unavailable right now. Please try again shortly.", undefined, cause ? { cause } : undefined);

/** Supabase Storage over REST with the service key (worker only). Flat-fee infrastructure: not written to provider_calls. */
export class SupabaseStorage implements ObjectStorage {
  private readonly doFetch: typeof fetch;
  private readonly base: string;

  constructor(private readonly o: Options) {
    this.doFetch = o.fetch ?? fetch;
    this.base = `${o.url.replace(/\/+$/, "")}/storage/v1`;
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.doFetch(`${this.base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
        headers: { authorization: `Bearer ${this.o.serviceKey}`, apikey: this.o.serviceKey, ...(init.headers as Record<string, string>) },
      });
    } catch (err) {
      throw unavailable(err);
    }
  }

  private static async isMissingOrDuplicate(res: Response, kind: "404" | "409"): Promise<boolean> {
    if (res.ok) return false;
    const text = await res.clone().text();
    return text.includes(`"statusCode":"${kind}"`) || res.status === Number(kind);
  }

  async ensureBucket(bucket: string, opts: { public: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Promise<void> {
    const limits = {
      ...(opts.fileSizeLimit !== undefined ? { file_size_limit: opts.fileSizeLimit } : {}),
      ...(opts.allowedMimeTypes ? { allowed_mime_types: opts.allowedMimeTypes } : {}),
    };
    const body = JSON.stringify({ id: bucket, name: bucket, public: opts.public, ...limits });
    const res = await this.call("/bucket", { method: "POST", headers: { "content-type": "application/json" }, body });
    if (res.ok) return;
    if (!(await SupabaseStorage.isMissingOrDuplicate(res, "409"))) throw unavailable(new Error(`bucket ${bucket}: HTTP ${res.status}`));
    if (Object.keys(limits).length === 0) return;
    // The bucket exists: make sure it carries the limits (an older bucket may have been created without them).
    const upd = await this.call(`/bucket/${bucket}`, { method: "PUT", headers: { "content-type": "application/json" }, body });
    if (!upd.ok) throw unavailable(new Error(`bucket ${bucket} limits: HTTP ${upd.status}`));
  }

  async put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    const res = await this.call(`/object/${bucket}/${key}`, {
      method: "POST",
      headers: { "content-type": contentType, "x-upsert": "true" },
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
    if (!res.ok) throw unavailable(new Error(`put ${bucket}/${key}: HTTP ${res.status}`));
  }

  async get(bucket: string, key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    const res = await this.call(`/object/${bucket}/${key}`, { method: "GET" });
    if (await SupabaseStorage.isMissingOrDuplicate(res, "404")) return null;
    if (!res.ok) throw unavailable(new Error(`get ${bucket}/${key}: HTTP ${res.status}`));
    const max = opts?.maxBytes;
    if (max === undefined) return new Uint8Array(await res.arrayBuffer());
    // Bounded read: a declared larger object is not downloaded; otherwise stop after max + 1 bytes.
    if (Number(res.headers.get("content-length") ?? 0) > max) {
      await res.body?.cancel();
      return new Uint8Array(max + 1);
    }
    const out = new Uint8Array(max + 1);
    let n = 0;
    const reader = res.body?.getReader();
    while (reader && n <= max) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, max + 1 - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
    if (n > max) await reader?.cancel();
    return out.subarray(0, n);
  }

  async remove(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const res = await this.call(`/object/${bucket}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw unavailable(new Error(`remove from ${bucket}: HTTP ${res.status}`));
  }

  publicUrl(bucket: string, key: string): string {
    return `${this.base}/object/public/${bucket}/${key}`;
  }

  /** Supabase signed upload (valid 2 hours, one object, no service key in the browser). */
  async signedUploadUrl(bucket: string, key: string): Promise<string> {
    const res = await this.call(`/object/upload/sign/${bucket}/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw unavailable(new Error(`sign upload ${bucket}/${key}: HTTP ${res.status}`));
    const j = (await res.json()) as { url?: string };
    if (!j.url) throw unavailable(new Error("sign upload: no url"));
    return `${this.base}${j.url}`;
  }

  async signedDownloadUrl(bucket: string, key: string, expiresInSeconds: number, downloadName: string): Promise<string> {
    const res = await this.call(`/object/sign/${bucket}/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresIn: expiresInSeconds }) });
    if (!res.ok) throw unavailable(new Error(`sign download ${bucket}/${key}: HTTP ${res.status}`));
    const j = (await res.json()) as { signedURL?: string };
    if (!j.signedURL) throw unavailable(new Error("sign download: no url"));
    return `${this.base}${j.signedURL}&download=${encodeURIComponent(downloadName)}`;
  }
}
