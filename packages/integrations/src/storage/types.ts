export const RAW_PAYLOAD_BUCKET = "raw-payloads";
export const AVATAR_BUCKET = "creator-avatars";

/** File storage behind an adapter: Supabase Storage now, Cloudflare R2 later (architecture Q7). */
export interface ObjectStorage {
  ensureBucket(bucket: string, opts: { public: boolean }): Promise<void>;
  put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  /** Null when the object does not exist. */
  get(bucket: string, key: string): Promise<Uint8Array | null>;
  remove(bucket: string, keys: string[]): Promise<void>;
  publicUrl(bucket: string, key: string): string;
}
