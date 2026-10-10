import { inArray } from "drizzle-orm";
import { sha256Hex } from "@mushin/core";
import { creatorSuppressions, type SystemTx, type TenantTx } from "@mushin/db";
import type { CreatorPlatform } from "./rules";

type Tx = TenantTx | SystemTx;

/** Only this hash of an erased profile link is kept (spec D9): it can be matched, never read back. */
export const urlHash = (canonicalUrl: string): string => sha256Hex(canonicalUrl.trim().toLowerCase());

/** Of the given canonical profile URLs, those on the do-not-re-add list. */
export async function suppressedUrls(tx: Tx, canonicalUrls: string[]): Promise<Set<string>> {
  if (canonicalUrls.length === 0) return new Set();
  const byHash = new Map(canonicalUrls.map((u) => [urlHash(u), u]));
  const rows = await tx.select({ h: creatorSuppressions.urlHash }).from(creatorSuppressions).where(inArray(creatorSuppressions.urlHash, [...byHash.keys()]));
  return new Set(rows.map((r) => byHash.get(r.h)).filter((u): u is string => u !== undefined));
}

export async function suppress(tx: SystemTx, entries: { canonicalUrl: string; platform: CreatorPlatform }[], removalRequestId: string | null): Promise<void> {
  if (entries.length === 0) return;
  await tx
    .insert(creatorSuppressions)
    .values(entries.map((e) => ({ urlHash: urlHash(e.canonicalUrl), platform: e.platform, removalRequestId })))
    .onConflictDoNothing();
}
