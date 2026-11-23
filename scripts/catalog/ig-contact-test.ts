/**
 * Paid test (owner, 22 Nov, step 4; approved up to $1–2): does an Instagram scraper that reads the Contact button find
 * the email and phone our discovery scraper (apify/instagram-profile-scraper) never returns? 20 business accounts
 * (isBusinessAccount in our stored result) that still have no contact after the free steps are read once with
 * memo23/apify-instagram-profile-scraper-ppe (about $0.002 a profile). Apify itself stops the run at --max-usd.
 * The raw result is kept under .catalog-storage for review; only counts and masked values are printed. With --apply the
 * Contact-button email and phone are stored as contacts (source "business_field", trust "likely", as the pipeline does).
 * This is targeted enrichment only: discovery keeps the current, cheaper scraper.
 *
 *   node --env-file=.env --import tsx scripts/catalog/ig-contact-test.ts --db mushin_catalog_v4 [--count 20] [--max-usd 0.5] [--apply]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { encryptSecret, sha256Hex } from "@mushin/core";
import postgres from "postgres";
import { isUsableEmail } from "../../apps/api/src/modules/creators/email-check";
import { normPhone } from "../../apps/api/src/modules/creators/enrichment/links";
import { maskContact } from "../../apps/api/src/modules/creators/rules";

const ACTOR = "memo23~apify-instagram-profile-scraper-ppe";
const { values } = parseArgs({ options: { db: { type: "string" }, count: { type: "string", default: "20" }, "max-usd": { type: "string", default: "0.5" }, apply: { type: "boolean", default: false }, reuse: { type: "boolean", default: false } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const maxUsd = Number(values["max-usd"]);
if (!(maxUsd > 0 && maxUsd <= 2)) throw new Error("--max-usd must be above 0 and at most 2 (owner's approved test budget)");
const token = process.env["APIFY_TOKEN"];
if (!token) throw new Error("APIFY_TOKEN is not set");
const key = Buffer.from(process.env["DATA_ENCRYPTION_KEY"] ?? "", "base64");
if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be set (32 bytes, base64)");
const storage = path.resolve(import.meta.dirname, "../../.catalog-storage", dbName);
const outFile = path.join(storage, "ig-contact-test.json");
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });

// 1. Business accounts without any contact, most-followed first among searchable-looking creators.
const candidates = await sql<{ creator_id: string; handle: string; storage_key: string; followers: number }[]>`
  select distinct on (p.id) p.creator_id, p.handle, r.storage_key, p.followers
  from gcp.creator_profiles p
  join gcp.creators c on c.id = p.creator_id and c.status = 'active' and not c.is_minor and cardinality(c.niches) > 0
  join platform.raw_payloads r on r.canonical_url = p.canonical_url and r.platform = 'instagram'
  where p.platform = 'instagram' and p.followers >= 10000
    and not exists (select 1 from gcp.creator_contacts k where k.creator_id = p.creator_id)
  order by p.id, r.fetched_at desc`;
const business = candidates.filter((c) => {
  try {
    const raw = JSON.parse(readFileSync(path.join(storage, "raw-payloads", c.storage_key), "utf8"));
    return (Array.isArray(raw) ? raw[0] : raw)?.isBusinessAccount === true;
  } catch {
    return false;
  }
}).sort((a, b) => b.followers - a.followers);
const picked = business.slice(0, Number(values.count));
console.error(`business accounts without a contact: ${business.length}; testing ${picked.length}`);

// 2. One run, capped by Apify at maxUsd.
let items: Record<string, unknown>[];
let costUsd: number | null;
if (values.reuse && existsSync(outFile)) {
  ({ items, costUsd } = JSON.parse(readFileSync(outFile, "utf8")));
} else {
  const input = { startUrls: picked.map((p) => ({ url: `https://www.instagram.com/${p.handle}/` })), includePosts: false, maxItems: picked.length };
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const start = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?waitForFinish=60&maxTotalChargeUsd=${maxUsd}`, { method: "POST", headers: auth, body: JSON.stringify(input) });
  if (!start.ok) throw new Error(`Apify refused the run: HTTP ${start.status} ${(await start.text()).slice(0, 200)}`);
  let run = ((await start.json()) as { data: { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number } }).data;
  const deadline = Date.now() + 10 * 60_000;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    if (Date.now() > deadline) {
      await fetch(`https://api.apify.com/v2/actor-runs/${run.id}/abort`, { method: "POST", headers: auth });
      throw new Error("run took over 10 minutes: aborted");
    }
    run = ((await (await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?waitForFinish=60`, { headers: auth })).json()) as { data: typeof run }).data;
  }
  items = (await (await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true`, { headers: auth })).json()) as Record<string, unknown>[];
  costUsd = run.usageTotalUsd ?? null;
  writeFileSync(outFile, JSON.stringify({ actor: ACTOR, runId: run.id, status: run.status, costUsd, picked: picked.map((p) => p.handle), items }));
  console.error(`run ${run.status}; ${items.length} items`);
}

// 3. What the Contact button gave, per profile.
// A free Apify plan returns these fields partly hidden ("w***@brand.com"): a hidden value is never a contact.
const str = (v: unknown) => (typeof v === "string" && v.trim() && !/[*•]/.test(v) ? v.trim() : null);
const byHandle = new Map(items.map((it) => [String(it["username"] ?? "").toLowerCase(), it]));
const rows: Record<string, unknown>[] = [];
const summary = { tested: picked.length, returned: 0, contactButtonEmail: 0, contactButtonPhone: 0, contactButtonEmailHidden: 0, bioOnlyEmail: 0, nothing: 0 };
const toStore: { creatorId: string; kind: "email" | "phone"; value: string }[] = [];
for (const p of picked) {
  const it = byHandle.get(p.handle.toLowerCase());
  if (!it) {
    rows.push({ handle: p.handle, result: "not returned" });
    continue;
  }
  summary.returned += 1;
  const btnEmail = str(it["business_email"]) ?? str(it["public_email"]);
  const btnPhone = str(it["business_phone_number"]) ?? str(it["contact_phone_number"]) ?? str(it["public_phone_number"]);
  const email = btnEmail && isUsableEmail(btnEmail.toLowerCase()) ? btnEmail.toLowerCase() : null;
  const phone = btnPhone ? normPhone(`${str(it["public_phone_country_code"]) ? `+${str(it["public_phone_country_code"])}` : ""}${btnPhone}`) ?? normPhone(btnPhone) : null;
  if (email) {
    summary.contactButtonEmail += 1;
    toStore.push({ creatorId: p.creator_id, kind: "email", value: email });
  }
  if (phone) {
    summary.contactButtonPhone += 1;
    toStore.push({ creatorId: p.creator_id, kind: "phone", value: phone });
  }
  const anyEmail = typeof it["email"] === "string" && it["email"] ? it["email"] : null;
  if (!email && it["emailSource"] === "contact_button") summary.contactButtonEmailHidden += 1;
  if (!email && anyEmail && it["emailSource"] !== "contact_button") summary.bioOnlyEmail += 1;
  if (!email && !phone && !anyEmail) summary.nothing += 1;
  rows.push({ handle: p.handle, followers: p.followers, emailSource: it["emailSource"] ?? null, contactMethod: it["business_contact_method"] ?? null, email: email ? maskContact("email", email) : null, phone: phone ? maskContact("phone", phone) : null });
}
console.table(rows);

if (values.apply && toStore.length) {
  await sql`insert into gcp.creator_contacts ${sql(toStore.map((n) => ({
    creator_id: n.creatorId, kind: n.kind, value_encrypted: encryptSecret(n.value, key), value_hash: sha256Hex(n.value.trim().toLowerCase()),
    masked: maskContact(n.kind, n.value), trust: "likely", source: "business_field",
  })))} on conflict (creator_id, kind, value_hash) do nothing`;
}
await sql.end();
console.log(JSON.stringify({ actor: ACTOR, costUsd, ...summary, stored: values.apply ? toStore.length : 0, businessAccountsWithoutContact: business.length }, null, 2));
