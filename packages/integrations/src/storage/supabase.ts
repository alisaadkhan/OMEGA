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

  async ensureBucket(bucket: string, opts: { public: boolean }): Promise<void> {
    const res = await this.call("/bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: bucket, name: bucket, public: opts.public }),
    });
    if (res.ok || (await SupabaseStorage.isMissingOrDuplicate(res, "409"))) return;
    throw unavailable(new Error(`bucket ${bucket}: HTTP ${res.status}`));
  }

  async put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    const res = await this.call(`/object/${bucket}/${key}`, {
      method: "POST",
      headers: { "content-type": contentType, "x-upsert": "true" },
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
    if (!res.ok) throw unavailable(new Error(`put ${bucket}/${key}: HTTP ${res.status}`));
  }

  async get(bucket: string, key: string): Promise<Uint8Array | null> {
    const res = await this.call(`/object/${bucket}/${key}`, { method: "GET" });
    if (await SupabaseStorage.isMissingOrDuplicate(res, "404")) return null;
    if (!res.ok) throw unavailable(new Error(`get ${bucket}/${key}: HTTP ${res.status}`));
    return new Uint8Array(await res.arrayBuffer());
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
}
