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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@mushin/core";
import { createTestDatabase } from "@mushin/db/testing";
import { createCreatorIndexer, insertCreator, standardize, type CreatorPlatform } from "../../apps/api/src/modules/creators/index";

const [dir, manifestPath] = process.argv.slice(2);
if (!dir || !manifestPath) throw new Error("usage: load-corpus.ts <recordings-dir> <manifest.json>");
const db = createTestDatabase(); // refuses anything but a local database named with test/disposable

type Rec = Record<string, unknown>;
const first = (raw: unknown): Rec | undefined => (Array.isArray(raw) ? (raw[0] as Rec | undefined) : undefined);
const HANDLE: Record<CreatorPlatform, (raw: unknown) => string | undefined> = {
  instagram: (raw) => first(raw)?.["username"] as string | undefined,
  tiktok: (raw) => (first(raw)?.["authorMeta"] as Rec | undefined)?.["name"] as string | undefined,
  youtube: (raw) => {
    const items = ((raw as Rec)?.["channel"] as Rec | undefined)?.["items"] as Rec[] | undefined;
    return ((items?.[0]?.["snippet"] as Rec | undefined)?.["customUrl"] as string | undefined)?.replace(/^@/, "");
  },
};

const manifest: { creatorId: string; platform: string; handle: string; file: string; fetchedAt: string }[] = [];
const skipped: Record<string, number> = {};
const ids: string[] = [];
for (const platform of ["instagram", "tiktok", "youtube"] as CreatorPlatform[]) {
  for (const file of readdirSync(join(dir, "raw", platform))) {
    const { raw, fetchedAt } = JSON.parse(readFileSync(join(dir, "raw", platform, file), "utf8")) as { raw: unknown; fetchedAt: string };
    const handle = HANDLE[platform](raw);
    const result = handle ? standardize(platform, handle, raw, { maxPosts: 12 }) : { kind: "not_found" as const };
    if (result.kind !== "ok") {
      skipped[result.kind] = (skipped[result.kind] ?? 0) + 1;
      continue;
    }
    const p = result.profile;
    try {
      const id = await db.withSystem((tx) =>
        insertCreator(
          tx,
          {
            displayName: p.displayName || p.handle,
            primaryHandle: p.handle,
            primaryPlatform: platform,
            country: p.country,
            niches: [],
            tags: [],
            verified: p.verified,
            profiles: [{ platform, handle: p.handle, followers: p.followers, following: p.following, posts: p.posts, engagementRate: null, bio: p.bio, updatedAt: new Date(fetchedAt) }],
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
}
await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "silent" }) }).sync(ids);
writeFileSync(manifestPath, JSON.stringify({ loadedAt: new Date().toISOString(), source: dir, deleteYoutubeBy: "2026-11-12", creators: manifest }, null, 1));
console.log(`loaded ${ids.length} creators (${["instagram", "tiktok", "youtube"].map((pl) => `${pl} ${manifest.filter((m) => m.platform === pl).length}`).join(", ")}); skipped ${JSON.stringify(skipped)}`);
await db.close();
