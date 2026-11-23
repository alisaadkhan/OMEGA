import { normalizeTerms } from "./terminology";
import { SPECIFIC_TOPICS } from "./relevance";

/** How each specific topic is written on a card. */
const LABEL: Record<string, string> = {
  pubg: "PUBG", "free fire": "Free Fire", gta: "GTA", minecraft: "Minecraft", valorant: "Valorant", fortnite: "Fortnite", "call of duty": "Call of Duty",
  tekken: "Tekken", cricket: "Cricket", football: "Football", crypto: "Crypto", stocks: "Stocks", yoga: "Yoga", makeup: "Makeup", skincare: "Skincare",
  cooking: "Cooking", biryani: "Biryani", bbq: "BBQ", "car reviews": "Car reviews", bikes: "Bikes", naat: "Naat", quran: "Quran", poetry: "Poetry",
};
const label = (key: string) => LABEL[key] ?? key.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const pad = (s: string) => ` ${normalizeTerms(s)} `;

/**
 * The specific subjects a creator is known for inside their niches (owner, 23 Nov: "PUBG is in Gaming, but I should see
 * PUBG, not Gaming"), from the same reviewed topic list search uses (relevance.ts). A topic counts only when the
 * creator already has its parent niche and their own words name it: name, handle, content tags or bio. At most two per
 * niche, the most often named first.
 */
export function creatorTopics(c: { niches: string[]; displayName?: string | null; handle?: string | null; tags?: string[]; bios?: (string | null)[] }): Map<string, string[]> {
  const own = pad([c.displayName ?? "", (c.handle ?? "").replace(/[._]/g, " "), ...(c.tags ?? []).map((t) => t.replace(/^#/, ""))].join(" | "));
  const bio = pad((c.bios ?? []).filter(Boolean).join(" | "));
  const out = new Map<string, string[]>();
  for (const niche of c.niches) {
    const hits = SPECIFIC_TOPICS.filter((t) => t.parent === niche)
      .map((t) => {
        let n = 0;
        for (const f of t.forms) {
          const form = normalizeTerms(f);
          if (form === "") continue;
          // Whole words only; lookarounds so back-to-back mentions ("minecraft minecraft") each count.
          // normalizeTerms leaves only letters, digits, marks and single spaces: nothing to escape.
          const re = new RegExp(`(?<= )${form}(?= )`, "gu");
          n += (own.match(re)?.length ?? 0) + (bio.match(re)?.length ?? 0);
        }
        return { key: t.key, n };
      })
      .filter((h) => h.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2);
    if (hits.length) out.set(niche, hits.map((h) => label(h.key)));
  }
  return out;
}

/** The niche line on a card: each niche replaced by its specific topics when the creator has any ("PUBG · Comedy"). */
export function displayNiches(niches: string[], topics: Map<string, string[]>): string[] {
  return [...new Set(niches.flatMap((n) => topics.get(n) ?? [n]))];
}
