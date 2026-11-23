/**
 * Moves creators who do not qualify to staff Trash (owner, 23 Nov: "I do not need creators who aren't qualified").
 * Trash is restorable for 45 days in Creator Checks, then the daily job erases them. Dry run by default.
 *
 *   node --import tsx scripts/catalog/trash-unqualified.ts --db mushin_catalog_v4 [--groups under_10k,outside_pakistan,inactive,profile_gone] [--apply]
 *
 * A creator goes to Trash only for a failed rule that is backed by data:
 *   under_10k         no own profile reaches 10,000 followers (elig-1)
 *   brand             the account is a brand or organisation page, not a person
 *   outside_pakistan  its profiles are shown to be outside Pakistan (evidence, never a guess from a name)
 *   inactive          no recent posts
 *   profile_gone      the profile was deleted or made private
 * Never trashed by this script (owner, 23 Nov): a creator whose follower count is unknown (refresh it first), a creator
 * whose only problem is that Pakistan is not proven (staff review it; missing evidence is never a deletion reason),
 * creators without a contact, staff-hidden creators and anything already decided by staff.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createLogger } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const GROUPS = {
  under_10k: { reason: "below_follower_minimum", text: "Does not qualify: no profile reaches 10,000 followers" },
  brand: { reason: "account_not_individual_creator", text: "Does not qualify: a brand or organisation page, not a person" },
  outside_pakistan: { reason: "country_not_pakistan", text: "Does not qualify: profiles shown to be outside Pakistan" },
  inactive: { reason: "inactive", text: "Does not qualify: no recent posts" },
  profile_gone: { reason: "profile_not_found|profile_private", text: "Does not qualify: profile deleted or private" },
} as const;
type Group = keyof typeof GROUPS;

const { values } = parseArgs({ options: { db: { type: "string" }, groups: { type: "string", default: "under_10k,outside_pakistan,inactive,profile_gone" }, apply: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const groups = (values.groups ?? "").split(",").map((g) => g.trim()).filter(Boolean) as Group[];
for (const g of groups) if (!(g in GROUPS)) throw new Error(`unknown group ${g}; use ${Object.keys(GROUPS).join(", ")}`);

const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, applicationName: "trash-unqualified" });
const logger = createLogger({ level: "info", name: "trash-unqualified" });

// One group per creator, in the order of the table shown to the owner, so each creator gets the first reason that applies.
const ORDER: Group[] = ["under_10k", "brand", "outside_pakistan", "inactive", "profile_gone"];
const reasonsOf = (g: Group) => GROUPS[g].reason.split("|");
const rows = await db.withSystem((tx) =>
  tx.execute<{ id: string; reasons: string[] }>(sql`
    select c.id::text, d.eligibility_reasons reasons from gcp.creators c join gcp.creator_search_documents d on d.creator_id = c.id
    where c.status = 'active' and not d.eligible`),
);
const picked = new Map<Group, string[]>();
for (const r of rows) {
  const g = ORDER.find((o) => reasonsOf(o).some((x) => r.reasons.includes(x)));
  if (g && groups.includes(g)) picked.set(g, [...(picked.get(g) ?? []), r.id]);
}
const summary = Object.fromEntries(groups.map((g) => [g, picked.get(g)?.length ?? 0]));
logger.info({ mode: values.apply ? "apply" : "dry-run", groups: summary, total: Object.values(summary).reduce((a, b) => a + b, 0) }, "creators that do not qualify");

if (values.apply) {
  const changed: string[] = [];
  for (const g of groups) {
    const ids = picked.get(g) ?? [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const done = await db.withSystem((tx) =>
        tx.execute<{ id: string }>(sql`update gcp.creators set status = 'trashed', trashed_at = now(), trashed_by_staff_id = null, trash_reason = ${GROUPS[g].text}, trash_banned = false, updated_at = now()
          where status = 'active' and id in (${sql.join(batch.map((id) => sql`${id}::uuid`), sql`, `)}) returning id::text`),
      );
      changed.push(...done.map((d) => d.id));
    }
  }
  await createCreatorIndexer({ db, index: null, logger }).sync(changed);
  logger.info({ trashed: changed.length }, "moved to Trash; restorable in Creator Checks for 45 days");
}
await db.close();
