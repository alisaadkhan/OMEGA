/**
 * Arts & Design re-map (owner, 25 Nov): creators filed under Education & How-to or Entertainment (or with no niche) whose
 * own name, handle, tags or bio say they do graphic/UI design, video editing or filmmaking, photography, calligraphy or
 * art move to Arts & Design as their main niche. The old main niche stays as the secondary one (a calligraphy teacher
 * is still Education & How-to second). Other main niches (a Bridal wedding photographer) are left as they are. Dry run by
 * default; --apply writes and re-projects the changed creators. Prints names only, never a contact.
 *
 *   node --env-file=.env --import tsx scripts/catalog/remap-arts.ts --db mushin_catalog_v4 [--apply]
 *   DATABASE_SSL_CA_FILE=prod-ca-2021.crt node --env-file=.env --import tsx scripts/catalog/remap-arts.ts --live --expect-ref yknp [--apply]
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createLogger, readCaFile } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const ARTS = "Arts & Design";
const FROM = ["Education & How-to", "Entertainment"];
/** The Arts & Design forms in terminology.ts, as one case-insensitive pattern (stems: "photograph" ~ photographer). */
export const ARTS_PATTERN = "(graphic design|ui/ux|ui ux|ux design|logo design|photograph|videograph|video edit|filmmak|cinematograph|calligraph|khattati|خطاطی|digital art|illustrat|painting|painter|artwork|fine art|sketching|drawing|مصوری|فوٹوگرافی)";

const { values } = parseArgs({ options: { db: { type: "string" }, live: { type: "boolean", default: false }, "expect-ref": { type: "string" }, apply: { type: "boolean", default: false } } });
let url: string;
let caPem: string | null = null;
if (values.live) {
  url = process.env["DIRECT_URL"] ?? "";
  const u = new URL(url);
  const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
  if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected live project (--expect-ref)");
  caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
  if (!caPem) throw new Error("DATABASE_SSL_CA_FILE is required for the live database");
} else {
  const dbName = values.db ?? "";
  if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*), or pass --live");
  url = `postgres://postgres@127.0.0.1:54330/${dbName}`;
}
const db = createDatabase(url, { max: 2, applicationName: "remap-arts", ...(caPem ? { caPem } : {}) });
const logger = createLogger({ level: "info", name: "remap-arts" });

type Row = { id: string; name: string; main: string | null; niches: string[] };
const rows = await db.withSystem((tx) =>
  tx.execute<Row>(sql`
    select c.id::text, c.display_name as name, c.niche_main as main, coalesce(c.niches, '{}') as niches
    from gcp.creators c
    where c.status <> 'trashed'
      and (c.niche_main in ${FROM} or c.niche_main is null)
      and lower(concat_ws(' ', c.display_name, c.primary_handle, array_to_string(c.tags, ' '),
            (select string_agg(p.bio, ' ') from gcp.creator_profiles p where p.creator_id = c.id))) ~ ${ARTS_PATTERN}
    order by c.display_name`),
);
const changes = rows.map((r) => ({ ...r, next: [ARTS, ...[r.main, ...r.niches].filter((n): n is string => !!n && n !== ARTS)].filter((n, i, a) => a.indexOf(n) === i).slice(0, 3) }));
for (const c of changes) logger.info({ creator: c.name, from: c.main, niches: c.next }, "re-map");
logger.info({ target: values.live ? "live" : values.db, mode: values.apply ? "apply" : "dry-run", creators: changes.length }, "Arts & Design re-map");

if (values.apply && changes.length > 0) {
  await db.withSystem(async (tx) => {
    for (const c of changes)
      await tx.execute(sql`update gcp.creators set niche_main = ${ARTS}, niches = array[${sql.join(c.next.map((n) => sql`${n}`), sql`, `)}]::text[], niche_status = 'classified',
        niche_confidence = coalesce(niche_confidence, 'medium'), niche_source = coalesce(niche_source, 'bio_identified'), niche_assessed_at = now(), updated_at = now()
        where id = ${c.id}::uuid`);
  });
  await createCreatorIndexer({ db, index: null, logger, sourcePolicy: { youtubeDerivedMetrics: process.env["YOUTUBE_DERIVED_METRICS"] === "on" } }).sync(changes.map((c) => c.id));
}
await db.close();
