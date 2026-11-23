/**
 * Owner exports (directive 2026-11-15 §3): the local catalogue as two spreadsheets, each as .csv and .xlsx.
 *   MUSHIN_QUALIFIED_CREATORS:    every active creator search shows (eligible), with the full profile.
 *   MUSHIN_DISQUALIFIED_ACCOUNTS: every other account (excluded type, location, followers, activity, merged, minor…)
 *                                 with the category and the exact reasons it did not qualify.
 * Read-only. Contacts are decrypted with DATA_ENCRYPTION_KEY, never for a possible minor or a creator on the
 * do-not-re-add list. YouTube figures older than 30 days are withheld (YouTube API retention). The files hold contact
 * details and YouTube API data: they are git-ignored; regenerate them rather than keep old copies.
 *
 *   node --env-file=.env --import tsx scripts/catalog/export-catalogue.ts --db mushin_catalog_v4 [--out docs/completion/inventory]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decryptSecret } from "@mushin/core";
import postgres from "postgres";
import { hasCollabRoute } from "../../apps/api/src/modules/creators/contact-routes";
import { contactAvailability } from "../../apps/api/src/modules/creators/rules";
import { toCsv, toXlsx, type Cell } from "./spreadsheet";

const { values } = parseArgs({ options: { db: { type: "string" }, out: { type: "string", default: "docs/completion/inventory" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName) || /eval/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = resolve(root, values.out ?? "docs/completion/inventory");
const keyText = process.env["DATA_ENCRYPTION_KEY"];
const key = keyText ? Buffer.from(keyText, "base64") : null;
const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 2, onnotice: () => {} });

type Creator = {
  id: string; display_name: string; status: string; merged_into_name: string | null; merged_into_handle: string | null; primary_platform: string; primary_handle: string | null;
  account_type: string | null; account_type_source: string | null; account_type_evidence: string | null; niche_main: string | null; niches: string[]; niche_source: string | null;
  niche_posts_assessed: number | null; country: string | null; country_source: string | null; city: string | null; possible_minor: boolean; eligible: boolean | null; reasons: string[];
  has_contact: boolean | null; assessment_status: string | null; ai_summary: string | null; trash_reason: string | null; trashed_at: Date | null; trash_banned: boolean | null;
};
type Profile = {
  creator_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; canonical_url: string; followers: number | null; engagement_rate: number | null; median_views: number | null;
  verified: boolean; last_scraped_at: Date | null; followers_updated_at: Date | null; last_post_at: Date | null; bio: string | null; yt_expired: boolean;
};
type Contact = { creator_id: string; kind: "email" | "phone"; value_encrypted: string; masked: string; source: string; status: string };

const creators = await sql<Creator[]>`
  select c.id, c.display_name, c.status, m.display_name merged_into_name, m.primary_handle merged_into_handle, c.primary_platform, c.primary_handle,
    c.account_type, c.account_type_source, c.account_type_evidence, c.niche_main, c.niches, c.niche_source, c.niche_posts_assessed, c.country, c.country_source, c.city,
    (c.is_minor and c.minor_override_by_staff_id is null) possible_minor, d.eligible, coalesce(d.eligibility_reasons, '{}') reasons,
    d.has_contact, c.assessment_status, c.ai_summary, c.trash_reason, c.trashed_at, c.trash_banned
  from gcp.creators c left join gcp.creators m on m.id = c.merged_into_id left join gcp.creator_search_documents d on d.creator_id = c.id
  order by lower(c.display_name), c.id`;
const profiles = await sql<Profile[]>`
  select p.creator_id, p.platform, p.handle, p.canonical_url, p.followers::float8 followers, p.engagement_rate::float8 engagement_rate, p.median_views::float8 median_views, p.verified,
    p.last_scraped_at, p.followers_updated_at, p.last_post_at, p.bio,
    (p.platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < now() - interval '30 days') yt_expired
  from gcp.creator_profiles p order by p.creator_id, p.platform`;
const contacts = await sql<Contact[]>`select creator_id, kind, value_encrypted, masked, source, status from gcp.creator_contacts order by creator_id, kind, first_seen_at`;
const suppressed = new Set((await sql<{ creator_id: string }[]>`
  select distinct p.creator_id from gcp.creator_profiles p
  join gcp.creator_suppressions s on s.url_hash = encode(sha256(convert_to(lower(trim(p.canonical_url)), 'UTF8')), 'hex')`).map((r) => r.creator_id));
await sql.end();

const byCreator = <T extends { creator_id: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.creator_id, [...(m.get(r.creator_id) ?? []), r]), new Map<string, T[]>());
const profilesOf = byCreator(profiles);
const contactsOf = byCreator(contacts);

// The frontend's words (frontend/src/app/api/search-mapping.ts CONTACT_AVAILABILITY_TEXT).
const CONTACT_LABEL: Record<string, string> = {
  email_and_phone: "Email & mobile available", email_unverified: "Email available · Unverified", email_verified: "Email available · Verified",
  email_invalid: "Email invalid", phone_unverified: "Mobile available · Unverified", collab_route: "Collab route in bio", none: "Not publicly listed",
};
const SOURCE_LABEL: Record<string, string> = { bio: "bio/About", business_field: "business button", video_description: "video descriptions", post_caption: "post captions" };
const TYPE_LABEL: Record<string, string> = {
  INDIVIDUAL_CREATOR: "INDIVIDUAL_CREATOR", CELEBRITY_PUBLIC_FIGURE: "CELEBRITY_PUBLIC_FIGURE", BRAND_ACCOUNT: "BRAND_ACCOUNT", BUSINESS_STORE: "BUSINESS_STORE",
  MEDIA_PUBLICATION: "MEDIA_PUBLICATION", COMPANY_CORPORATE: "COMPANY_CORPORATE", FAN_PAGE_AGGREGATOR: "FAN_PAGE_AGGREGATOR", UNKNOWN: "UNKNOWN",
};
const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (n: number | null, digits = 0): number | null => (n === null || !Number.isFinite(n) ? null : Number(n.toFixed(digits)));

function classification(c: Creator): string {
  const wiki = /\[Wikipedia: ([^\]]*)\]/.exec(c.account_type_evidence ?? "")?.[1];
  switch (c.account_type_source) {
    case "ai": return wiki && wiki !== "none" ? `AI + Wikipedia (${wiki})` : "AI";
    case "staff": return "staff";
    case "rules": return "rules";
    case "platform_category": return "platform category";
    default: return "not classified";
  }
}
const nicheBasis = (c: Creator) => (!c.niche_main ? null : c.niche_source === "post_estimated" && c.niche_posts_assessed === 0 ? "AI estimate" : c.niche_source === "bio_identified" ? "bio" : c.niche_source === "post_estimated" ? "recent posts" : "earlier evidence");

/** Contact columns; withheld for possible minors and do-not-re-add creators. */
function contactCells(c: Creator, ps: Profile[]): { status: string; emails: string | null; phones: string | null; sources: string | null; collab: string } {
  const list = contactsOf.get(c.id) ?? [];
  const collab = hasCollabRoute(ps.map((p) => p.bio ?? ""));
  const status = CONTACT_LABEL[contactAvailability(list.map((k) => ({ kind: k.kind, status: k.status })), { collabRoute: collab })] ?? "Not publicly listed";
  if (c.possible_minor) return { status: "Withheld: possible minor (staff review)", emails: null, phones: null, sources: null, collab: "—" };
  if (suppressed.has(c.id)) return { status: "Withheld: removal requested (do-not-re-add list)", emails: null, phones: null, sources: null, collab: "—" };
  const value = (k: Contact) => {
    if (!key) return `${k.masked} (no key to decrypt)`;
    try {
      return decryptSecret(k.value_encrypted, key);
    } catch {
      return `${k.masked} (could not decrypt)`;
    }
  };
  const join = (kind: "email" | "phone") => list.filter((k) => k.kind === kind).map((k) => `${value(k)}${k.status === "invalid" ? " (invalid)" : ""}`).join("; ") || null;
  const sources = [...new Set(list.map((k) => `${k.kind}: ${SOURCE_LABEL[k.source] ?? k.source}`))].join("; ") || null;
  return { status, emails: join("email"), phones: join("phone"), sources, collab: collab ? "Yes" : "No" };
}

const profileOn = (ps: Profile[], platform: string) => ps.find((p) => p.platform === platform) ?? null;
const metric = (p: Profile | null, v: (p: Profile) => number | null, digits = 0): Cell => (!p ? null : p.yt_expired ? "withheld (YouTube data past 30 days)" : num(v(p), digits));
const fetched = (ps: Profile[]) => ps.map((p) => `${p.platform} ${day(p.last_scraped_at) ?? "never"}${p.yt_expired ? " (past 30 days)" : ""}`).join("; ") || null;
const maxFollowers = (ps: Profile[]) => {
  const counts = ps.filter((p) => !p.yt_expired && p.followers !== null).map((p) => p.followers as number);
  return counts.length ? Math.max(...counts) : null;
};

// The Creator Checks sub-page each account is on (owner, 23 Nov).
const page = (c: Creator): string =>
  c.status === "trashed" ? (c.trash_banned ? "Trash (banned)" : "Trash")
  : c.status === "merged" ? "Merged duplicate"
  : c.status !== "active" ? "Removed / Hidden"
  : c.eligible === true ? (c.has_contact ? "Qualifies" : "Not reachable")
  : "Doesn't qualify";
const ASSESSMENT_LABEL: Record<string, string> = { assessed: "Assessed", pending: "Pending", insufficient_data: "Not enough data" };
const assessment = (c: Creator): string => (c.assessment_status ? (ASSESSMENT_LABEL[c.assessment_status] ?? c.assessment_status) : "Not assessed");
const erasedOn = (c: Creator): string | null => (c.trashed_at ? day(new Date(c.trashed_at.getTime() + 45 * 86_400_000)) : null);

// ---- File 1: qualified (searchable) creators ----
const QUALIFIED_HEADER = [
  "Creator Name", "Creator ID", "Creator Checks Page", "Assessment", "AI Summary", "Account Type", "Classification Source", "Classification Evidence", "Primary Platform", "Connected Platforms",
  "Instagram Handle", "Instagram URL", "TikTok Handle", "TikTok URL", "YouTube Handle", "YouTube URL",
  "Instagram Followers", "TikTok Followers", "YouTube Subscribers", "Max Followers",
  "Instagram ER % (per follower)", "TikTok ER % (per follower)", "YouTube ER % (per follower)",
  "Instagram Typical Views", "TikTok Typical Views", "YouTube Typical Views",
  "Main Niche", "Main Niche Basis", "Secondary Niches", "Country", "Country Source", "City",
  "Instagram Verified", "TikTok Verified", "YouTube Verified",
  "Contact Status", "Emails", "Phones", "Contact Sources", "Collab Route in Bio", "Last Fetched",
];
const qualified = creators.filter((c) => c.status === "active" && c.eligible === true);
const qualifiedRows: Cell[][] = qualified.map((c) => {
  const ps = profilesOf.get(c.id) ?? [];
  const k = contactCells(c, ps);
  const on = (pl: string) => profileOn(ps, pl);
  return [
    c.display_name, c.id, page(c), assessment(c), c.ai_summary, TYPE_LABEL[c.account_type ?? "UNKNOWN"] ?? c.account_type, classification(c), c.account_type_evidence, c.primary_platform, ps.map((p) => p.platform).join(", "),
    ...PLATFORMS.flatMap((pl) => [on(pl)?.handle ?? null, on(pl)?.canonical_url ?? null]),
    ...PLATFORMS.map((pl) => metric(on(pl), (p) => p.followers)), maxFollowers(ps),
    ...PLATFORMS.map((pl) => metric(on(pl), (p) => p.engagement_rate, 4)),
    ...PLATFORMS.map((pl) => metric(on(pl), (p) => p.median_views)),
    c.niche_main, nicheBasis(c), c.niches.filter((n) => n !== c.niche_main).join(", ") || null, c.country, c.country_source, c.city,
    ...PLATFORMS.map((pl) => (on(pl) ? (on(pl)?.verified ? "Yes" : "No") : null)),
    k.status, k.emails, k.phones, k.sources, k.collab, fetched(ps),
  ];
});

// ---- File 2: every account that did not qualify ----
const CATEGORY: Record<string, string> = {
  below_follower_minimum: "Below 10K Followers", followers_unknown: "Inactive / Stale Data", followers_stale: "Inactive / Stale Data", inactive: "Inactive / Stale Data",
  profile_not_found: "Inactive / Stale Data", profile_private: "Inactive / Stale Data", invalid_profile_url: "Inactive / Stale Data",
  country_unknown: "Location Unknown / Non-Pakistani", country_not_pakistan: "Location Unknown / Non-Pakistani", country_conflicting: "Location Unknown / Non-Pakistani",
};
const typeCategory = (t: string | null) => (t === "CELEBRITY_PUBLIC_FIGURE" ? "Celebrity / Public Figure" : "Brand / Media / Shop");
function disqualification(c: Creator, ps: Profile[]): { categories: string[]; reasons: string[] } {
  const main = profileOn(ps, c.primary_platform) ?? ps[0] ?? null;
  if (c.status === "merged") return { categories: ["Merged Duplicate"], reasons: [`Merged into ${c.merged_into_name ?? "another creator"}${c.merged_into_handle ? ` (@${c.merged_into_handle})` : ""}`] };
  if (c.status === "trashed") return { categories: [c.trash_banned ? "Trash (banned)" : "Trash"], reasons: [`${c.trash_reason ?? "Moved to Trash by staff"}; erased on ${erasedOn(c) ?? "unknown"} unless restored`] };
  if (c.status !== "active") return { categories: ["Removed / Hidden"], reasons: [`Status: ${c.status}`] };
  const categories: string[] = [];
  const reasons: string[] = [];
  if (c.possible_minor) {
    categories.push("Possible Minor (staff review)");
    reasons.push("Flagged as a possible minor; hidden until staff review");
  }
  for (const code of c.reasons) {
    const category = code === "account_not_individual_creator" ? typeCategory(c.account_type) : (CATEGORY[code] ?? "Other");
    if (!categories.includes(category)) categories.push(category);
    if (code === "account_not_individual_creator") reasons.push(`Account type ${c.account_type} (${classification(c)}): ${c.account_type_evidence ?? "no evidence recorded"}`);
    else if (code === "below_follower_minimum") reasons.push(`Followers: ${(maxFollowers(ps) ?? 0).toLocaleString("en-US")} (below the 10,000 minimum)`);
    else if (code === "country_unknown") reasons.push("No Pakistani location stated in the bio, the platform country or recent captions");
    else if (code === "country_not_pakistan") reasons.push(`Country: ${c.country ?? "not Pakistan"}${c.country_source ? ` (${c.country_source})` : ""}`);
    else if (code === "country_conflicting") reasons.push("Location evidence conflicts (bio, platform country and captions disagree)");
    else if (code === "inactive") reasons.push(`No recent post in the activity window (last post ${day(main?.last_post_at ?? null) ?? "unknown"})`);
    else if (code === "followers_stale") reasons.push(`Follower count too old (last counted ${day(main?.followers_updated_at ?? null) ?? "unknown"})`);
    else if (code === "followers_unknown") reasons.push("Follower count unknown");
    else reasons.push(code);
  }
  if (categories.length === 0) {
    categories.push("Not Assessed");
    reasons.push(c.eligible === null ? "No search record yet (not assessed by the eligibility rules)" : "Not eligible (no reason recorded)");
  }
  return { categories, reasons };
}
const DISQUALIFIED_HEADER = [
  "Account / Creator Name", "Creator ID", "Creator Checks Page", "Assessment", "AI Summary", "Primary Platform", "Handle", "URL", "Disqualification Category", "Exact Reason(s)",
  "Account Type", "Classification Source", "Followers / Subscribers (max)", "Engagement Rate % (per follower, main profile)", "Main Niche",
  "Location / Country Status", "Contact Status", "Emails", "Phones", "Contact Sources", "Last Fetched",
];
const disqualified = creators.filter((c) => !(c.status === "active" && c.eligible === true));
const disqualifiedRows: Cell[][] = disqualified.map((c) => {
  const ps = profilesOf.get(c.id) ?? [];
  const main = profileOn(ps, c.primary_platform) ?? ps[0] ?? null;
  const d = disqualification(c, ps);
  const k = contactCells(c, ps);
  const location = c.country ? `${c.country}${c.country_source ? ` (${c.country_source})` : ""}${c.city ? `, ${c.city}` : ""}` : "Unknown";
  return [
    c.display_name, c.id, page(c), assessment(c), c.ai_summary, c.primary_platform, main?.handle ?? c.primary_handle, main?.canonical_url ?? null, d.categories.join("; "), d.reasons.join(" | "),
    TYPE_LABEL[c.account_type ?? "UNKNOWN"] ?? c.account_type, classification(c), maxFollowers(ps), metric(main, (p) => p.engagement_rate, 4), c.niche_main,
    location, k.status, k.emails, k.phones, k.sources, fetched(ps),
  ];
});

mkdirSync(outDir, { recursive: true });
const written: Record<string, number> = {};
for (const [name, sheet, header, rows] of [
  ["MUSHIN_QUALIFIED_CREATORS", "Qualified Creators", QUALIFIED_HEADER, qualifiedRows],
  ["MUSHIN_DISQUALIFIED_ACCOUNTS", "Disqualified Accounts", DISQUALIFIED_HEADER, disqualifiedRows],
] as const) {
  writeFileSync(join(outDir, `${name}.csv`), toCsv([...header], rows));
  writeFileSync(join(outDir, `${name}.xlsx`), toXlsx(sheet, [...header], rows));
  written[name] = rows.length;
}
const tally = (rows: Cell[][], col: number) => rows.reduce<Record<string, number>>((m, r) => {
  for (const c of String(r[col] ?? "").split("; ").filter(Boolean)) m[c] = (m[c] ?? 0) + 1;
  return m;
}, {});
console.log(JSON.stringify({ db: dbName, outDir, accounts: creators.length, rows: written, contactsDecrypted: Boolean(key), disqualifiedByCategory: tally(disqualifiedRows, 8) }, null, 1));
