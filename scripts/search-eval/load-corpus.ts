/**
 * Loads recorded public profiles (real provider responses saved by the 2026-10-13 live evaluation) into a DISPOSABLE
 * evaluation database, so the Brain 1 human panel has a realistic catalogue. Nothing is fetched: the files are read and
 * passed through the product's own standardiser. Profiles keep what was observed (name, handle, bio, counts, country);
 * niches and city stay empty because those come from an AI assessment that is not re-run here.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_eval_disposable TEST_DATABASE_SSL_CA_FILE= \
 *     node --import tsx scripts/search-eval/load-corpus.ts <recordings-dir> <manifest.json>
 *
 * Retention: YouTube API data may be kept 30 days (recorded 2026-10-13 → delete by 2026-11-12). Drop the disposable
 * database after the panel; never load this into a shared or production database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "@mushin/core";
import { createTestDatabase } from "@mushin/db/testing";
import { createCreatorIndexer, insertCreator, profileMetrics } from "../../apps/api/src/modules/creators/index";
import { readRecordedProfiles } from "./recordings";

const [dir, manifestPath] = process.argv.slice(2);
if (!dir || !manifestPath) throw new Error("usage: load-corpus.ts <recordings-dir> <manifest.json> [--keep-ids <original-manifest.json>]");
// Restoring a lost corpus (2026-10-17): reuse each creator's original id from an earlier manifest, so the rating
// packets (which name creators by id) still describe it.
const keepIdsAt = process.argv.indexOf("--keep-ids");
const keep = new Map<string, string>();
if (keepIdsAt > 0) {
  const original = JSON.parse(readFileSync(process.argv[keepIdsAt + 1] ?? "", "utf8")) as { creators: { creatorId: string; platform: string; handle: string; file: string }[] };
  for (const c of original.creators) keep.set(`${c.platform}:${c.handle}:${c.file}`, c.creatorId);
}
const db = createTestDatabase(); // refuses anything but a local database named with test/disposable

const manifest: { creatorId: string; platform: string; handle: string; file: string; fetchedAt: string }[] = [];
const skipped: Record<string, number> = {};
const ids: string[] = [];
const recorded = readRecordedProfiles(dir);
skipped["not_found_or_private"] = recorded.skipped;
for (const { platform, file, fetchedAt, profile: p } of recorded.profiles) {
  try {
    const id = await db.withSystem((tx) =>
      insertCreator(
        tx,
        {
          ...(keep.has(`${platform}:${p.handle}:${file}`) ? { id: keep.get(`${platform}:${p.handle}:${file}`) } : {}),
          displayName: p.displayName || p.handle,
          primaryHandle: p.handle,
          primaryPlatform: platform,
          country: p.country,
          niches: [],
          tags: [],
          verified: p.verified,
          profiles: [{ platform, handle: p.handle, followers: p.followers, following: p.following, posts: p.posts, engagementRate: profileMetrics(p).engagementRate, bio: p.bio, updatedAt: new Date(fetchedAt) }],
        },
        Buffer.alloc(32),
      ),
    );
    ids.push(id);
    manifest.push({ creatorId: id, platform, handle: p.handle, file, fetchedAt });
  } catch (err) {
    const message = err instanceof Error ? String((err.cause as Error | undefined)?.message ?? err.message) : "error";
    const reason = (message.split(/\r?\n/)[0] ?? "error").slice(0, 80);
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  }
}
await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "silent" }) }).sync(ids);
writeFileSync(manifestPath, JSON.stringify({ loadedAt: new Date().toISOString(), source: dir, deleteYoutubeBy: "2026-11-12", creators: manifest }, null, 1));
console.log(`loaded ${ids.length} creators (${["instagram", "tiktok", "youtube"].map((pl) => `${pl} ${manifest.filter((m) => m.platform === pl).length}`).join(", ")}); skipped ${JSON.stringify(skipped)}`);
await db.close();
