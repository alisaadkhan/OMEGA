/**
 * Bio-link crawler (owner, 22 Nov, step 3): reads the website or link page each creator links from their own profile
 * (creator_links, platform "website") and stores the emails and phone numbers published there (enrichment/link-page.ts)
 * as contacts with source "bio_link_page", trust "unverified". When the linked page shows no email, up to two contact
 * pages of the same site it links to are read too (/contact, /pages/contact, /about…).
 *
 * Polite and safe by construction: robots.txt is honoured; one request at a time per site, a few sites at once; a
 * generic user agent; 10 s and 1.5 MB per page; http(s) only, at most 3 redirects, and every hop must resolve to a public
 * address (no private, loopback or link-local networks). A page several unrelated creators link to (a marketplace, a
 * brand, a builder's home page) is not attributed to any of them. Results are cached per URL under .catalog-storage, so
 * --apply does not fetch again. Only counts are printed. Dry run by default; --apply writes the new contacts.
 *
 *   node --env-file=.env --import tsx scripts/catalog/bio-link-crawl.ts --db mushin_catalog_v4 [--apply] [--limit 50]
 */
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { encryptSecret, sha256Hex } from "@mushin/core";
import postgres from "postgres";
import { contactsFromPage, type PageContacts } from "../../apps/api/src/modules/creators/enrichment/link-page";
import { whatsappNumber } from "../../apps/api/src/modules/creators/enrichment/links";
import { maskContact } from "../../apps/api/src/modules/creators/rules";

const { values } = parseArgs({ options: { db: { type: "string" }, apply: { type: "boolean", default: false }, limit: { type: "string" }, concurrency: { type: "string", default: "8" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local operational catalogue (mushin_catalog_*)");
const key = Buffer.from(process.env["DATA_ENCRYPTION_KEY"] ?? "", "base64");
if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be set (32 bytes, base64)");
const cacheDir = path.resolve(import.meta.dirname, "../../.catalog-storage", dbName);
const cacheFile = path.join(cacheDir, "bio-link-pages.json");
mkdirSync(cacheDir, { recursive: true });
type Cached = { ok: boolean; reason?: string; contacts?: PageContacts; pages?: number };
const cache: Record<string, Cached> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const UA = "Mozilla/5.0 (compatible; MUSHIN-contact-reader/1.0; reads public contact details a creator links from their profile)";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_500_000;

/** Private, loopback, link-local, CGNAT and other non-public ranges (IPv4 and IPv6). */
function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return publicAddress(v.slice(7));
  return !(v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff"));
}

async function safeUrl(u: URL): Promise<boolean> {
  if (!/^https?:$/.test(u.protocol) || (u.port && !["80", "443"].includes(u.port))) return false;
  if (isIP(u.hostname)) return publicAddress(u.hostname);
  try {
    const addrs = await lookup(u.hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => publicAddress(a.address));
  } catch {
    return false;
  }
}

/** GET with manual redirects (each hop re-checked), a timeout and a size cap. Returns the final URL and the body. */
async function get(start: string): Promise<{ url: string; body: string; type: string } | { error: string }> {
  let u: URL;
  try {
    u = new URL(start);
  } catch {
    return { error: "bad_url" };
  }
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!(await safeUrl(u))) return { error: "not_public" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(u, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) return { error: "redirect_without_location" };
        u = new URL(loc, u);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { error: `http_${res.status}` };
      }
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
        await res.body?.cancel();
        return { error: "not_html" };
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      return { url: u.toString(), body: Buffer.concat(chunks).toString("utf8"), type };
    } catch (err) {
      return { error: (err as Error).name === "AbortError" ? "timeout" : "fetch_failed" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "too_many_redirects" };
}

/** A robots.txt path pattern: "*" matches anything, a trailing "$" anchors the end (RFC 9309). */
function pattern(p: string): { test: (path: string) => boolean } {
  const anchored = p.endsWith("$");
  const parts = (anchored ? p.slice(0, -1) : p).split("*");
  return {
    test(path: string) {
      // Each literal part in order; the first at the start, the last at the end when anchored.
      let at = 0;
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i] as string;
        if (i === 0) {
          if (!path.startsWith(part)) return false;
          at = part.length;
          continue;
        }
        const last = i === parts.length - 1;
        const found = last && anchored ? (path.endsWith(part) && path.length - part.length >= at ? path.length - part.length : -1) : path.indexOf(part, at);
        if (found < 0) return false;
        at = found + part.length;
      }
      return !anchored || parts.length > 1 || at === path.length;
    },
  };
}
type Rule = { allow: boolean; path: string; re: { test: (path: string) => boolean } };
/** robots.txt rules for every agent ("*"), per origin; a missing or unreadable file allows everything. */
const robots = new Map<string, Promise<Rule[]>>();
function disallowed(u: URL): Promise<boolean> {
  if (!robots.has(u.origin)) {
    robots.set(u.origin, get(`${u.origin}/robots.txt`).then((r) => {
      if ("error" in r) return [];
      const rules: Rule[] = [];
      let applies = false;
      let inAgents = false;
      for (const line of r.body.split(/\r?\n/)) {
        const [k = "", ...rest] = line.replace(/#.*/, "").split(":");
        const field = k.trim().toLowerCase();
        const v = rest.join(":").trim();
        if (field === "user-agent") {
          // Consecutive user-agent lines form one group.
          applies = inAgents ? applies || v === "*" : v === "*";
          inAgents = true;
          continue;
        }
        inAgents = false;
        if (applies && (field === "disallow" || field === "allow") && v) rules.push({ allow: field === "allow", path: v, re: pattern(v) });
      }
      return rules;
    }));
  }
  // The longest matching rule decides; Allow wins a tie.
  return (robots.get(u.origin) as Promise<Rule[]>).then((rules) => {
    const target = `${u.pathname}${u.search}`;
    const hit = rules.filter((r) => r.re.test(target)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
    return hit ? !hit.allow : false;
  });
}

/** One site at a time per host. */
const hostQueue = new Map<string, Promise<unknown>>();
function perHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostQueue.get(host) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  hostQueue.set(host, next.catch(() => undefined));
  return next;
}

async function readPage(url: string): Promise<Cached> {
  const cached = cache[url];
  if (cached) return cached;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return (cache[url] = { ok: false, reason: "bad_url" });
  }
  const out = await perHost(u.hostname, async (): Promise<Cached> => {
    if (await disallowed(u)) return { ok: false, reason: "robots" };
    const r = await get(url);
    if ("error" in r) return { ok: false, reason: r.error };
    const first = contactsFromPage(r.body, r.url);
    const all: PageContacts = { emails: [...first.emails], phones: [...first.phones], contactPages: [] };
    let pages = 1;
    if (first.emails.length === 0) {
      for (const next of first.contactPages.slice(0, 2)) {
        if (await disallowed(new URL(next))) continue;
        const p = await get(next);
        if ("error" in p) continue;
        pages += 1;
        const c = contactsFromPage(p.body, p.url);
        all.emails = [...new Set([...all.emails, ...c.emails])].slice(0, 3);
        all.phones = [...new Set([...all.phones, ...c.phones])].slice(0, 3);
      }
    }
    return { ok: true, contacts: all, pages };
  });
  cache[url] = out;
  return out;
}

const sql = postgres(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, onnotice: () => {} });
const links = await sql<{ creator_id: string; url: string }[]>`
  select distinct l.creator_id, l.url from gcp.creator_links l join gcp.creators c on c.id = l.creator_id and c.status = 'active'
  where l.platform = 'website'
  order by l.url`;
// WhatsApp links are read by the contact extractor already; a URL several creators share is nobody's own page.
const owners = new Map<string, Set<string>>();
for (const l of links) owners.set(l.url, (owners.get(l.url) ?? new Set()).add(l.creator_id));
const shared = new Set([...owners].filter(([, s]) => s.size >= 3).map(([u]) => u));
const targets = [...owners.keys()].filter((u) => !whatsappNumber(u) && !shared.has(u)).slice(0, values.limit ? Number(values.limit) : undefined);

let done = 0;
const queue = [...targets];
const workers = Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  while (queue.length) {
    const url = queue.shift() as string;
    await readPage(url);
    done += 1;
    if (done % 100 === 0) {
      writeFileSync(cacheFile, JSON.stringify(cache));
      console.error(`… ${done}/${targets.length} pages`);
    }
  }
});
await Promise.all(workers);
writeFileSync(cacheFile, JSON.stringify(cache));

const reasons: Record<string, number> = {};
for (const u of targets) {
  const c = cache[u];
  const k = c?.ok ? "read" : (c?.reason ?? "unknown");
  reasons[k] = (reasons[k] ?? 0) + 1;
}

/** Link-in-bio services: the page under the creator's own path is theirs. */
const LINK_IN_BIO = /(?:^|\.)(?:linktr\.ee|beacons\.ai|bio\.site|linkin\.bio|taplink\.cc|taplink\.at|campsite\.bio|hoo\.be|lnk\.bio|msha\.ke|solo\.to|bio\.link|linkr\.bio|allmylinks\.com|direct\.me|tap\.bio|stan\.store|carrd\.co|linkbio\.co|komi\.io|snipfeed\.co|milkshake\.app|withkoji\.com|koji\.to|wa\.link)$/i;
const squash = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, "");
/** The site's own name: the label before the public suffix (shop.ayesha.com.pk → "ayesha"). */
function siteName(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  const suffix2 = /^(?:com|net|org|edu|gov|co|ac)$/.test(labels[labels.length - 2] ?? "") && (labels[labels.length - 1] ?? "").length === 2;
  return labels[labels.length - (suffix2 ? 3 : 2)] ?? "";
}
/** A link-in-bio page, or a site whose name and the creator's handle or name contain one another (4+ letters). */
export function ownPage(url: string, name: string, handles: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (LINK_IN_BIO.test(host)) return true;
  const site = squash(siteName(host));
  if (site.length < 4) return false;
  const keys = [squash(name), ...handles.map(squash), ...name.split(/\s+/).map(squash).filter((w) => w.length >= 4)].filter((k) => k.length >= 4);
  return keys.some((k) => k.includes(site) || site.includes(k));
}

class DryRun extends Error {}
const report: Record<string, unknown> = { applied: values.apply, linksOfActiveCreators: links.length, distinctUrls: owners.size, sharedSkipped: shared.size, pagesTried: targets.length, outcome: reasons };
try {
  await sql.begin(async (tx) => {
    const existing = new Set((await tx<{ k: string }[]>`select creator_id || ':' || kind || ':' || value_hash k from gcp.creator_contacts`).map((r) => r.k));
    const hadEmail = new Set((await tx<{ id: string }[]>`select distinct creator_id id from gcp.creator_contacts where kind = 'email' and status <> 'invalid'`).map((r) => r.id));
    const rows: Record<string, unknown>[] = [];
    const gainEmail = new Set<string>();
    const gainPhone = new Set<string>();
    // Whose page is it? Creators also link to a brand they work with, a news story, a marketplace listing or a sponsor's
    // short link; the contacts there are that organisation's. A page counts only when it is a link-in-bio page or its
    // site name matches the creator's handle or name (audit of the first crawl, 22 Nov).
    const who = new Map((await tx<{ id: string; name: string; handles: string[] }[]>`select c.id, c.display_name name,
      coalesce(array_agg(p.handle) filter (where p.handle is not null), '{}') handles
      from gcp.creators c left join gcp.creator_profiles p on p.creator_id = c.id group by c.id`).map((r) => [r.id, r]));
    const skippedNotOwn = new Set<string>();
    for (const [url, ids] of owners) {
      const c = cache[url];
      if (!c?.ok || !c.contacts || shared.has(url)) continue;
      for (const id of ids) {
        const w = who.get(id);
        if (!w || !ownPage(url, w.name, w.handles)) {
          if (c.contacts.emails.length || c.contacts.phones.length) skippedNotOwn.add(`${id} ${url}`);
          continue;
        }
        for (const [kind, list] of [["email", c.contacts.emails], ["phone", c.contacts.phones]] as const) {
          for (const value of list) {
            const hash = sha256Hex(value.trim().toLowerCase());
            if (existing.has(`${id}:${kind}:${hash}`)) continue;
            existing.add(`${id}:${kind}:${hash}`);
            rows.push({ creator_id: id, kind, value_encrypted: encryptSecret(value, key), value_hash: hash, masked: maskContact(kind, value), trust: "unverified", source: "bio_link_page" });
            if (kind === "email" && !hadEmail.has(id)) gainEmail.add(id);
            if (kind === "phone") gainPhone.add(id);
          }
        }
      }
    }
    for (let i = 0; i < rows.length; i += 500) await tx`insert into gcp.creator_contacts ${tx(rows.slice(i, i + 500))} on conflict (creator_id, kind, value_hash) do nothing`;
    const [after] = await tx<{ any: number; email: number; phone: number }[]>`select count(distinct creator_id)::int any,
      count(distinct creator_id) filter (where kind = 'email' and status <> 'invalid')::int email,
      count(distinct creator_id) filter (where kind = 'phone' and status <> 'invalid')::int phone from gcp.creator_contacts`;
    Object.assign(report, {
      newContacts: { emails: rows.filter((r) => r["kind"] === "email").length, phones: rows.filter((r) => r["kind"] === "phone").length },
      pagesWithContactsNotTheCreatorsOwn: skippedNotOwn.size,
      creatorsGainingFirstEmail: gainEmail.size, creatorsGainingPhone: gainPhone.size, catalogueAfter: after,
    });
    if (!values.apply) throw new DryRun("dry run");
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
}
await sql.end();
console.log(JSON.stringify(report, null, 2));
