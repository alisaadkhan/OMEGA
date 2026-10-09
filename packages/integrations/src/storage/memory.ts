import type { ObjectStorage } from "./types";

/** In-memory storage for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly buckets = new Map<string, { public: boolean }>();
  readonly contentTypes = new Map<string, string>();

  async ensureBucket(bucket: string, opts: { public: boolean }): Promise<void> {
    this.buckets.set(bucket, opts);
  }
  async put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    this.contentTypes.set(`${bucket}/${key}`, contentType);
    this.objects.set(`${bucket}/${key}`, typeof body === "string" ? new TextEncoder().encode(body) : body);
  }
  async get(bucket: string, key: string): Promise<Uint8Array | null> {
    return this.objects.get(`${bucket}/${key}`) ?? null;
  }
  async remove(bucket: string, keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(`${bucket}/${k}`);
  }
  publicUrl(bucket: string, key: string): string {
    return `memory://${bucket}/${key}`;
  }
}
