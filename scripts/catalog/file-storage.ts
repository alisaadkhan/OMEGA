import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ObjectStorage } from "@mushin/integrations";

/** Archived provider payloads and avatars of a local catalogue, on local disk (never the staging bucket from .env). */
export function fileStorage(root: string): ObjectStorage {
  const path = (bucket: string, key: string) => join(root, bucket, ...key.split("/"));
  return {
    async ensureBucket(bucket) {
      mkdirSync(join(root, bucket), { recursive: true });
    },
    async put(bucket, key, body) {
      mkdirSync(dirname(path(bucket, key)), { recursive: true });
      writeFileSync(path(bucket, key), body);
    },
    async get(bucket, key) {
      return existsSync(path(bucket, key)) ? new Uint8Array(readFileSync(path(bucket, key))) : null;
    },
    async remove(bucket, keys) {
      for (const k of keys) rmSync(path(bucket, k), { force: true });
    },
    publicUrl(bucket, key) {
      return `file://${path(bucket, key)}`;
    },
    // Catalogue scripts never sign browser uploads or downloads.
    async signedUploadUrl() {
      throw new Error("signed URLs are not used by catalogue builds");
    },
    async signedDownloadUrl() {
      throw new Error("signed URLs are not used by catalogue builds");
    },
  };
}
