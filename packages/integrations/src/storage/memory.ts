import type { ObjectStorage } from "./types";

/** In-memory storage for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly buckets = new Map<string, { public: boolean }>();
  readonly contentTypes = new Map<string, string>();

  async ensureBucket(bucket: string, opts: { public: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Promise<void> {
    this.buckets.set(bucket, opts);
  }
  async put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    this.contentTypes.set(`${bucket}/${key}`, contentType);
    this.objects.set(`${bucket}/${key}`, typeof body === "string" ? new TextEncoder().encode(body) : body);
  }
  async get(bucket: string, key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    const b = this.objects.get(`${bucket}/${key}`) ?? null;
    return b && opts?.maxBytes !== undefined ? b.subarray(0, opts.maxBytes + 1) : b;
  }
  async remove(bucket: string, keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(`${bucket}/${k}`);
  }
  publicUrl(bucket: string, key: string): string {
    return `memory://${bucket}/${key}`;
  }
  async signedUploadUrl(bucket: string, key: string): Promise<string> {
    return `memory://upload/${bucket}/${key}`;
  }
  async signedDownloadUrl(bucket: string, key: string, expiresInSeconds: number, downloadName: string): Promise<string> {
    return `memory://download/${bucket}/${key}?expires=${expiresInSeconds}&download=${encodeURIComponent(downloadName)}`;
  }
}
