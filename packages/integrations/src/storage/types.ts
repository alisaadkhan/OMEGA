export const RAW_PAYLOAD_BUCKET = "raw-payloads";
export const AVATAR_BUCKET = "creator-avatars";

/** File storage behind an adapter: Supabase Storage now, Cloudflare R2 later (architecture Q7). */
export interface ObjectStorage {
  /** Limits, when given, are enforced by the storage service itself on every upload (also on an existing bucket). */
  ensureBucket(bucket: string, opts: { public: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Promise<void>;
  put(bucket: string, key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  /**
   * Null when the object does not exist. With maxBytes, at most maxBytes + 1 bytes are read (a declared larger size is
   * not downloaded at all), so a caller comparing the length with maxBytes can refuse an oversized object cheaply.
   */
  get(bucket: string, key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null>;
  remove(bucket: string, keys: string[]): Promise<void>;
  publicUrl(bucket: string, key: string): string;
  /** A short-lived URL the browser PUTs one object to (private buckets; support attachments). */
  signedUploadUrl(bucket: string, key: string): Promise<string>;
  /** A short-lived URL that downloads the object as a file (Content-Disposition: attachment). */
  signedDownloadUrl(bucket: string, key: string, expiresInSeconds: number, downloadName: string): Promise<string>;
}
