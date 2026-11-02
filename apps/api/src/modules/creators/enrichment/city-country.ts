import { CITIES_V2, normalizeTerms } from "../terminology";

/**
 * City → country for explicit residence statements only (owner correction 2026-10-27): "Lives in Lahore", "Based in
 * Karachi" resolve to Pakistan as creator-stated location evidence. A city named any other way (origin "from Lahore",
 * travel, a hashtag, a username, a video topic) never establishes where the creator lives; deriveCountry only consults
 * this map right after a residence verb.
 *
 * Sources, maintained in this repository:
 *   - Pakistani cities: the owner-maintained city concepts (terminology.ts CITIES_V2), the same list search uses, with
 *     their Urdu forms. Short codes (lhr, khi, isb, rwp, fsd) are left out: too short to read as a place on their own.
 *   - Other countries: a curated list of cities that commonly appear in Pakistani creators' bios (Gulf, UK, North
 *     America, Europe, South Asia), each with its ISO country.
 * A name that is a well-known city in more than one country (Hyderabad: PK and IN) is ambiguous: it resolves only when
 * the same statement also names the country ("based in Hyderabad, Pakistan"), otherwise it stays unknown.
 */
export type CityCountry = { city: string; countries: readonly string[] };

const SHORT_CODES = new Set(["lhr", "khi", "isb", "rwp", "fsd"]);
const CITY_NAMES: Record<string, string> = {};
for (const c of CITIES_V2) for (const f of c.forms) if (!SHORT_CODES.has(f)) CITY_NAMES[normalizeTerms(f)] = c.key;

/** Pakistani cities that are also major cities elsewhere. */
const ALSO_ELSEWHERE: Record<string, readonly string[]> = { hyderabad: ["PK", "IN"] };

const FOREIGN: Record<string, readonly string[]> = {
  dubai: ["AE"], "abu dhabi": ["AE"], sharjah: ["AE"], ajman: ["AE"],
  riyadh: ["SA"], jeddah: ["SA"], dammam: ["SA"], makkah: ["SA"], mecca: ["SA"], madinah: ["SA"], medina: ["SA"],
  doha: ["QA"], muscat: ["OM"], "kuwait city": ["KW"], manama: ["BH"],
  london: ["GB"], manchester: ["GB"], bradford: ["GB"], glasgow: ["GB"], leeds: ["GB"], luton: ["GB"], birmingham: ["GB", "US"],
  toronto: ["CA"], mississauga: ["CA"], brampton: ["CA"], vancouver: ["CA"], calgary: ["CA"], montreal: ["CA"],
  "new york": ["US"], "new york city": ["US"], nyc: ["US"], houston: ["US"], chicago: ["US"], "los angeles": ["US"], dallas: ["US"], "new jersey": ["US"],
  delhi: ["IN"], "new delhi": ["IN"], mumbai: ["IN"], bangalore: ["IN"], bengaluru: ["IN"],
  dhaka: ["BD"], kabul: ["AF"], istanbul: ["TR"], "kuala lumpur": ["MY"], singapore: ["SG"],
  sydney: ["AU"], melbourne: ["AU"], perth: ["AU", "GB"], berlin: ["DE"], paris: ["FR"], oslo: ["NO"], stockholm: ["SE"], amsterdam: ["NL"],
};

const MAP = new Map<string, CityCountry>();
for (const [form, key] of Object.entries(CITY_NAMES)) MAP.set(form, { city: key, countries: ALSO_ELSEWHERE[key] ?? ["PK"] });
for (const [name, countries] of Object.entries(FOREIGN)) MAP.set(normalizeTerms(name), { city: name, countries });

/** Longest names first, regex-escaped, for "based in <city>". */
export const CITY_ALT = [...MAP.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

/** The city a normalized name refers to, and every country it could be in; null when it is not a known city. */
export function cityCountry(normalizedName: string): CityCountry | null {
  return MAP.get(normalizedName) ?? null;
}
