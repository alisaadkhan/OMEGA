/**
 * Copies the measured posting rate (0097) of Instagram and TikTok profiles from the local catalogue to live, matched by
 * profile link; a live reading that is newer is kept. Nothing else is copied. Dry run by default.
 *
 *   DATABASE_SSL_CA_FILE=prod-ca-2021.crt node --env-file=.env --import tsx scripts/catalog/sync-posting.ts --db mushin_catalog_v4 --expect-ref yknp [--apply]
 */
import { parseArgs } from "node:util";
import postgres from "postgres";
import { readCaFile } from "@mushin/core";

const { values } = parseArgs({ options: { db: { type: "string" }, "expect-ref": { type: "string" }, apply: { type: "boolean", default: false } } });
if (!/^mushin_catalog_[a-z0-9_]+$/.test(values.db ?? "")) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const url = process.env["DIRECT_URL"] ?? "";
const u = new URL(url);
const ref = u.username.split(".")[1] ?? u.hostname.split(".")[0] ?? "";
if (!values["expect-ref"] || !ref.startsWith(values["expect-ref"])) throw new Error("DIRECT_URL is not the expected live project (--expect-ref)");
const ca = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
if (!ca) throw new Error("DATABASE_SSL_CA_FILE is required for the live database");

const local = postgres(`postgres://postgres@127.0.0.1:54330/${values.db}`, { max: 1 });
const live = postgres(url, { max: 1, prepare: false, ssl: { ca, rejectUnauthorized: true }, onnotice: () => {} });
const rows = await local<{ url: string; per_week: number; at: Date }[]>`
  select canonical_url url, posts_per_week per_week, posting_measured_at at from gcp.creator_profiles
  where platform in ('instagram', 'tiktok') and posts_per_week is not null and posting_measured_at is not null`;
const payload = live.json(rows.map((r) => ({ url: r.url, per_week: r.per_week, at: r.at.toISOString() })));
const [m] = await live<{ matched: number; newer: number }[]>`
  select count(*)::int matched, count(*) filter (where p.posting_measured_at > u.at)::int newer
  from jsonb_to_recordset(${payload}) as u(url text, per_week double precision, at timestamptz) join gcp.creator_profiles p on p.canonical_url = u.url`;
let updated = 0;
if (values.apply) {
  const r = await live`update gcp.creator_profiles p set posts_per_week = u.per_week, posting_measured_at = u.at
    from jsonb_to_recordset(${payload}) as u(url text, per_week double precision, at timestamptz)
    where p.canonical_url = u.url and (p.posting_measured_at is null or p.posting_measured_at <= u.at)`;
  updated = r.count;
}
console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", local: rows.length, matchedOnLive: m?.matched, liveNewer: m?.newer, updated }));
await Promise.all([local.end(), live.end()]);
