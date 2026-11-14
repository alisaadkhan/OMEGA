import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import { socialTarget } from "./enrichment/repository";

/**
 * Which creators are one person across platforms (addendum 3; owner directive 2026-11-04 §3 item 5). A pair is merged
 * only on strong evidence; a one-way mention alone ("collab with @x", "my brother's channel") never is:
 *   - the two profiles link to each other;
 *   - one links to the other and their handles match (letters and digits only) or their display names match;
 *   - no link, but the same handle (5+ characters), the same display name, and both profiles confirmed in Pakistan.
 * Pairs join into groups (one person's Instagram, YouTube and TikTok). A group with two profiles on one platform is
 * left alone. The kept creator is the one with the most followers; platform.merge_creator (0085) moves the rest.
 */
type Profile = { creator_id: string; platform: string; handle: string; name: string; country_status: string; followers: number | null };
export type MergeGroup = { keep: string; absorb: string[]; evidence: string[]; handles: string[] };

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function findMergeGroups(db: Db): Promise<MergeGroup[]> {
  const profiles = [
    ...(await db.withSystem((tx) =>
      tx.execute<Profile>(sql`
        select p.creator_id, p.platform, lower(p.handle) handle, lower(regexp_replace(c.display_name, '[^[:alnum:]]', '', 'g')) "name", p.country_status, p.followers
        from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where c.status = 'active'`),
    )),
  ];
  const byTarget = new Map(profiles.map((p) => [`${p.platform}:${p.handle}`, p]));
  const byCreator = new Map<string, Profile[]>();
  for (const p of profiles) byCreator.set(p.creator_id, [...(byCreator.get(p.creator_id) ?? []), p]);
  const links = [...(await db.withSystem((tx) => tx.execute<{ creator_id: string; url: string }>(sql`select l.creator_id, l.url from gcp.creator_links l join gcp.creators c on c.id = l.creator_id where c.status = 'active'`)))];
  const edges = new Set<string>();
  for (const l of links) {
    const t = socialTarget(l.url);
    const o = t ? byTarget.get(`${t.platform}:${t.handle}`) : undefined;
    if (o && o.creator_id !== l.creator_id) edges.add(`${l.creator_id}>${o.creator_id}`);
  }
  const pairEvidence = new Map<string, string>();
  const first = (id: string) => (byCreator.get(id) ?? [])[0] as Profile;
  for (const e of edges) {
    const [a, b] = e.split(">") as [string, string];
    const A = first(a);
    const B = first(b);
    if (!A || !B || A.platform === B.platform) continue;
    const key = [a, b].sort().join("|");
    if (pairEvidence.has(key)) continue;
    const why = edges.has(`${b}>${a}`)
      ? "the profiles link to each other"
      : norm(A.handle) === norm(B.handle)
        ? "one links to the other and the handles match"
        : A.name.length >= 4 && A.name === B.name
          ? "one links to the other and the names match"
          : null;
    if (why) pairEvidence.set(key, why);
  }
  const byHandle = new Map<string, Profile[]>();
  for (const p of profiles) if (norm(p.handle).length >= 5) byHandle.set(norm(p.handle), [...(byHandle.get(norm(p.handle)) ?? []), p]);
  for (const ps of byHandle.values()) {
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const A = ps[i] as Profile;
        const B = ps[j] as Profile;
        if (A.platform === B.platform || A.creator_id === B.creator_id) continue;
        const key = [A.creator_id, B.creator_id].sort().join("|");
        if (!pairEvidence.has(key) && A.country_status === "pakistan" && B.country_status === "pakistan" && A.name.length >= 4 && A.name === B.name) {
          pairEvidence.set(key, "same handle and name, both confirmed in Pakistan");
        }
      }
    }
  }
  // Union-find over the pairs.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const key of pairEvidence.keys()) {
    const [a, b] = key.split("|") as [string, string];
    parent.set(find(a), find(b));
  }
  const groups = new Map<string, string[]>();
  for (const key of pairEvidence.keys()) for (const id of key.split("|")) groups.set(find(id), [...new Set([...(groups.get(find(id)) ?? []), id])]);
  const out: MergeGroup[] = [];
  for (const members of groups.values()) {
    const platforms = members.flatMap((id) => (byCreator.get(id) ?? []).map((p) => p.platform));
    if (new Set(platforms).size !== platforms.length) continue; // two accounts on one platform: not proof of one person
    const total = (id: string) => (byCreator.get(id) ?? []).reduce((s, p) => s + (p.followers ?? 0), 0);
    const sorted = [...members].sort((x, y) => total(y) - total(x) || x.localeCompare(y));
    const keep = sorted[0] as string;
    const evidence = [...pairEvidence.entries()].filter(([k]) => k.split("|").some((id) => members.includes(id))).map(([, v]) => v);
    out.push({ keep, absorb: sorted.slice(1), evidence: [...new Set(evidence)], handles: members.flatMap((id) => (byCreator.get(id) ?? []).map((p) => `${p.platform}/@${p.handle}`)) });
  }
  return out;
}

/** Merges every group (idempotent: merged creators are no longer active, so a second run finds nothing). */
export async function mergeGroups(db: Db, groups: MergeGroup[]): Promise<{ merged: number; refused: { group: string[]; reason: string }[]; touched: string[] }> {
  let merged = 0;
  const refused: { group: string[]; reason: string }[] = [];
  const touched: string[] = [];
  for (const g of groups) {
    for (const absorb of g.absorb) {
      const [r] = await db.withSystem((tx) => tx.execute<{ v: { merged: boolean; reason?: string } }>(sql`select platform.merge_creator(${g.keep}, ${absorb}, ${`Same person across platforms: ${g.evidence.join("; ")}`}) v`));
      if (r?.v.merged) {
        merged++;
        touched.push(absorb);
      } else refused.push({ group: g.handles, reason: r?.v.reason ?? "unknown" });
    }
    touched.push(g.keep);
  }
  return { merged, refused, touched: [...new Set(touched)] };
}
