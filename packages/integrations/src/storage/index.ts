import type { Logger, StorageConfig } from "@mushin/core";
import { SupabaseStorage } from "./supabase";
import type { ObjectStorage } from "./types";

export * from "./types";
export { SupabaseStorage } from "./supabase";
export { MemoryStorage } from "./memory";

export function createObjectStorage(config: StorageConfig, logger: Logger): ObjectStorage | null {
  if (!config) {
    logger.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: creator data jobs cannot archive and will fail");
    return null;
  }
  return new SupabaseStorage({ url: config.url, serviceKey: config.serviceKey });
}
