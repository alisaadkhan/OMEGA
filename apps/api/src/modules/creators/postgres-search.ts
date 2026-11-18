import { sql, type SQL } from "drizzle-orm";
import type { SearchFilters } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { SearchHit } from "@mushin/integrations";
import { cityForms, expandQuery, normalizeQuery, type QueryGroup } from "./aliases";
import type { PlanGroup } from "./understand-v2";
import { nameKey as exactNameKey, SEARCH_FLOOR } from "./rules";
import { CREATOR_VISIBLE, HAS_USABLE_EMAIL } from "./visibility";
import type { RelevanceGroup, RelevancePlan } from "./relevance";

/** Any form of a group as a tsquery (multi-word forms as phrases). */
const formsQuery = (forms: string[]) => sql.join(forms.map((form) => sql`phraseto_tsquery('simple', ${form})`), sql` || `);
/** The creator's own words: name (A), handles and name variants (B), niche labels and content tags (C); not the bio (D). */
const ownWords = (q: SQL) => sql`ts_filter(d.search_vector, '{a,b,c}') @@ (${q})`;
const labelsArray = (labels: string[]) => sql`array[${sql.join(labels.map((l) => sql`${l}`), sql`, `)}]::text[]`;

/**
 * Match condition and relevance (0–1) of one relevance group. The relevance tiers put creators whose stored niche and
 * own content both say the subject first, then the stored niche alone, then content evidence without the niche.
 */
export function relevanceSql(g: RelevanceGroup): { match: SQL; score: SQL } {
  const q = formsQuery(g.forms);
  const anywhere = sql`d.search_vector @@ (${q})`;
  if (g.kind === "topic") {
    const parent = labelsArray([g.parent]);
    const hasParent = sql`d.niches && ${parent}`;
    const mainParent = sql`d.niches[1] = ${g.parent}`;
    return {
      // Named in the creator's own words, or in the bio of a creator who has the parent niche.
      match: sql`(${anywhere} and (${ownWords(q)} or ${hasParent}))`,
      score: sql`case when ${mainParent} and ${ownWords(q)} then 1.0 when ${mainParent} then 0.9 when ${hasParent} and ${ownWords(q)} then 0.8 when ${hasParent} then 0.7 else 0.5 end`,
    };
  }
  if (g.kind === "niche") {
    const labels = labelsArray(g.labels);
    const hasNiche = sql`d.niches && ${labels}`;
    const mainNiche = sql`d.niches[1] = any(${labels})`;
    // The stored (evidence-based, reviewed) niche decides: a tag such as "#best gaming phone" on a phone reviewer or
    // "earn money playing games" on a freelancing channel does not make a gaming creator (probe 18 Nov).
    return {
      match: hasNiche,
      score: sql`case when ${mainNiche} and ${anywhere} then 1.0 when ${mainNiche} then 0.9 when ${anywhere} then 0.8 else 0.7 end`,
    };
  }
  if (g.kind === "city") {
    return { match: sql`(${anywhere} or lower(d.city) in (${sql.join(g.forms.map((form) => sql`${form}`), sql`, `)}))`, score: sql`1.0` };
  }
  return { match: anywhere, score: sql`least(ts_rank_cd(d.search_vector, ${q}) * 8, 1)` };
}

/**
 * Consonant skeleton of a name word, so spelling variants of the same name meet: Malik / Malek / Mullick → "mlk",
 * Muhammad / Mohammed → "mhmd", Ayesha / Aysha → "sh". Kept identical to the SQL in nameVariantMatch.
 */
export function nameKey(word: string): string {
  return word.toLowerCase().replace(/ck/g, "k").replace(/[aeiouyw]/g, "").replace(/(.)\1+/g, "$1");
}

/** Query words that may be a person's name: 2–3 plain Latin words, each with a skeleton of at least two letters. */
export function nameKeys(text: string): string[] | null {
  const words = text.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 3 || !words.every((w) => /^[a-z]+$/.test(w))) return null;
  const keys = words.map(nameKey);
  return keys.every((k) => k.length >= 2) ? keys : null;
}

export type CatalogSearchQuery = {
  text: string;
  filters: SearchFilters;
  freshCurrentDays: number;
  now: Date;
  limit: number;
  /** Words that only raise the rank (never required). */
  boost?: string[];
  /** SEARCH_PROFILE=v2: the required term groups from understandQueryV2 (absent = v1 behaviour, unchanged). */
  plan?: PlanGroup[];
  /**
   * Topic-aware relevance (relevance.ts, 18 Nov). When present it decides what matches and how well, for both search
   * profiles; null or absent keeps the plain behaviour (name and handle searches).
   */
  relevance?: RelevancePlan | null;
  /** Customer catalogue (owner, 18 Nov): only creators with a usable email. Name lookups and internal tools pass false. */
  requireEmail?: boolean;
};
export type CatalogSearch = { search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">): Promise<{ hits: SearchHit[]; total: number }> };

/** Search the worker-maintained global creator projection. Hydration and visibility checks still run under tenant RLS. */
export function createPostgresCatalogSearch(db: Db): CatalogSearch {
  async function search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">) {
    const limit = Math.max(1, Math.min(1000, Math.trunc(query.limit)));
    const text = query.text.trim();
    // Creator eligibility (elig-1) before ranking: eligible documents whose evidence has not expired.
    const conditions = [
      CREATOR_VISIBLE,
      sql`d.eligible and d.eligible_until_epoch > ${Math.floor(query.now.getTime() / 1000)}`,
    ];
    // The same quality floor as the Meilisearch filter (rules.ts SEARCH_FLOOR).
    // Exception (owner, 17 Nov): a search that is exactly a creator's name or handle finds them without a niche too.
    const key = exactNameKey(text);
    const keyOf = (col: ReturnType<typeof sql>) => sql`regexp_replace(lower(normalize(${col}, NFKC)), '[^[:alnum:]]', '', 'g')`;
    if (SEARCH_FLOOR.requireNiche) {
      conditions.push(
        key.length >= 3
          ? sql`(cardinality(d.niches) > 0 or ${keyOf(sql`d.display_name`)} = ${key} or exists (select 1 from unnest(d.handles) h where ${keyOf(sql`h`)} = ${key}))`
          : sql`cardinality(d.niches) > 0`,
      );
    }
    if (SEARCH_FLOOR.minEngagementRate !== null) conditions.push(sql`(d.engagement_rate is null or d.engagement_rate >= ${SEARCH_FLOOR.minEngagementRate})`);
    if (query.requireEmail) conditions.push(HAS_USABLE_EMAIL);
    // Recognised niche and city words (English, Roman Urdu, Urdu script, city short forms) match any of their reviewed
    // forms; a city also matches the creator's own declared city. Without a recognised word the query is unchanged.
    const groups: (QueryGroup | PlanGroup)[] | null = query.plan?.length ? query.plan : expandQuery(text);
    // A multi-word form ("skin care", "home cooking", "اسلام آباد") must appear as that phrase, not as its words
    // anywhere in the text; single-word forms match exactly as before. A v2 word group marked `prefix` also matches the
    // word's inflections ("review" → reviews, reviewing).
    const formQuery = (g: QueryGroup | PlanGroup, form: string) =>
      "prefix" in g && g.prefix && /^[a-z]+$/.test(form) ? sql`to_tsquery('simple', ${`${form}:*`})` : sql`phraseto_tsquery('simple', ${form})`;
    const anyForm = (g: QueryGroup | PlanGroup) => sql.join(g.forms.map((form) => formQuery(g, form)), sql` || `);
    const tsq = groups ? sql.join(groups.map((g) => sql`(${anyForm(g)})`), sql` && `) : sql`websearch_to_tsquery('simple', ${text})`;
    const wordMatch = groups
      ? sql.join(
          groups.map((g) =>
            g.kind === "city" ? sql`(d.search_vector @@ (${anyForm(g)}) or lower(d.city) in (${sql.join(g.forms.map((form) => sql`${form}`), sql`, `)}))` : sql`d.search_vector @@ (${anyForm(g)})`,
          ),
          sql` and `,
        )
      : sql`d.search_vector @@ ${tsq}`;
    const boost = (query.boost ?? []).map((w) => sql`plainto_tsquery('simple', ${w})`);
    const rankQuery = sql.join([groups ? sql.join(groups.map((g) => sql`(${anyForm(g)})`), sql` || `) : tsq, ...boost], sql` || `);

    const f = query.filters;
    // A platform filter matches only platforms where the creator itself qualifies (elig-1 is per profile: a 50,000-subscriber
    // YouTube channel does not make a 2,000-follower Instagram profile eligible for an Instagram search).
    if (f.platform) conditions.push(sql`d.qualifying_platforms @> array[${f.platform}]::text[]`);
    if (f.creatorCountry) conditions.push(sql`d.country = ${f.creatorCountry}`);
    if (f.creatorCity) conditions.push(sql`lower(d.city) in (${sql.join(cityForms(f.creatorCity).map((form) => sql`${form}`), sql`, `)})`);
    if (f.followersMin !== undefined) conditions.push(sql`d.followers >= ${f.followersMin}`);
    if (f.followersMax !== undefined) conditions.push(sql`d.followers <= ${f.followersMax}`);
    if (f.engagementMin !== undefined) conditions.push(sql`d.engagement_rate >= ${f.engagementMin}`);
    if (f.engagementMax !== undefined) conditions.push(sql`d.engagement_rate <= ${f.engagementMax}`);
    if (f.niches.length) conditions.push(sql`d.niches && array[${sql.join(f.niches.map((niche) => sql`${niche}`), sql`, `)}]::text[]`);
    if (f.verifiedOnly) conditions.push(sql`d.verified`);
    if (f.minAuthenticity !== undefined) conditions.push(sql`d.authenticity_score >= ${f.minAuthenticity}`);
    if (f.hasContact) conditions.push(sql`d.has_contact`);
    if (f.freshOnly) conditions.push(sql`d.followers_updated_epoch >= ${Math.floor(query.now.getTime() / 1000) - query.freshCurrentDays * 86_400}`);

    type Row = { id: string; rankingScore: number; updatedEpoch: number | string; exactTotal: number | string };
    // Every stage runs in one transaction: the same queries in the same order, without paying each stage's transaction
    // setup again (a search with no matches runs all three; search audit 2026-10-22).
    return db.withTenant(ctx, async (tx) => {
      const run = (match: SQL | null, ranked: SQL, order: SQL, take: number) =>
        tx.execute<Row>(sql`
          select d.creator_id as id, ${ranked}::real as "rankingScore", d.updated_epoch as "updatedEpoch", count(*) over() as "exactTotal"
          from gcp.creator_search_documents d
          join gcp.creators c on c.id = d.creator_id
          where ${sql.join(match ? [...conditions, match] : conditions, sql` and `)}
          order by ${order}
          limit ${take}
        `);

      if (!text) {
        const rows = await run(null, sql`0`, sql`d.engagement_rate desc nulls last, d.authenticity_score desc nulls last, d.followers desc nulls last, d.creator_id`, limit);
        return { hits: rows.map((r) => ({ id: r.id, rankingScore: 0 })), total: Number(rows[0]?.exactTotal ?? 0) };
      }

      const byScore = sql`"rankingScore" desc, d.updated_epoch desc`;
      // Topic-aware relevance: every group must match; the weakest group decides the tier, and how often the query's
      // words occur only orders creators within a tier (5%). No typo or name-variant widening: a topic search that finds
      // nothing relevant shows nothing rather than near-misses.
      if (query.relevance) {
        const parts = query.relevance.groups.map(relevanceSql);
        const allForms = query.relevance.groups.flatMap((g) => g.forms);
        const rankQ = sql.join([formsQuery(allForms), ...(query.boost ?? []).concat(query.relevance.boost).map((w) => sql`plainto_tsquery('simple', ${w})`)], sql` || `);
        const tier = parts.length === 1 ? (parts[0] as { score: SQL }).score : sql`least(${sql.join(parts.map((p) => p.score), sql`, `)})`;
        const rows = await run(sql.join(parts.map((p) => p.match), sql` and `), sql`(0.95 * ${tier} + 0.05 * least(ts_rank_cd(d.search_vector, ${rankQ}) * 8, 1))`, byScore, limit);
        return { hits: rows.map((r) => ({ id: r.id, rankingScore: Number(r.rankingScore) })), total: Number(rows[0]?.exactTotal ?? 0) };
      }
      // 1. Whole words through full-text search.
      // A creator matched only through the city field still scores on the words it did match.
      const words = await run(wordMatch, sql`least(ts_rank_cd(d.search_vector, ${rankQuery}) * 8, 1)`, byScore, limit);
      let total = Number(words[0]?.exactTotal ?? 0);
      let rows: Row[] = words;
      // 2. A typo or partial word ("Ayesah", "Siddiq") through trigram word similarity, which compares the query with the
      //    closest part of the text rather than the whole document. Only while whole words leave room in the pool: on a
      //    common word (thousands of matches) rechecking similarity across them cost ~1 s at 100k creators.
      //    Measured on the 469-creator panel corpus (2026-10-14): filling a small pool this way added unrelated creators
      //    ("book" → "booking", "urdu history" → gaming channels), so it now runs only when whole words found nothing, and
      //    every query word must be close to a word of the creator's text on its own.
      const nearWords = normalizeQuery(text).split(" ").filter((w) => w.length >= 3);
      if (total === 0 && nearWords.length > 0) {
        const each = sql.join(nearWords.map((w) => sql`${w} <% d.search_text`), sql` and `);
        const near = await run(sql`${each} and not (${wordMatch})`, sql`word_similarity(${text}, d.search_text)`, byScore, limit - total);
        total += Number(near[0]?.exactTotal ?? 0);
        rows = [...words, ...near].sort((a, b) => b.rankingScore - a.rankingScore || Number(b.updatedEpoch) - Number(a.updatedEpoch));
      }
      // 3. Name spelling variants ("Sana Malik" for "Sana Mullick"): only for a name-like query (2–3 plain words, no
      //    recognised topic or city) while the pool still has room; every query word must meet a word of the display name.
      // v2: a plan of plain words only (no topic or city) is name-like too.
      const recognised = query.plan?.length ? query.plan.some((g) => g.kind !== "word") : groups !== null;
      const keys = recognised ? null : nameKeys(normalizeQuery(text));
      if (keys && total < limit) {
        const skeleton = sql`' ' || regexp_replace(regexp_replace(replace(regexp_replace(lower(c.display_name), '[^a-z]+', ' ', 'g'), 'ck', 'k'), '[aeiouyw]', '', 'g'), '(.)\\1+', '\\1', 'g') || ' '`;
        const seen = rows.map((x) => x.id);
        const match = sql.join([
          ...keys.map((k) => sql`${skeleton} like ${"% " + k + " %"}`),
          ...(seen.length ? [sql`d.creator_id not in (${sql.join(seen.map((id) => sql`${id}::uuid`), sql`, `)})`] : []),
        ], sql` and `);
        const variants = await run(match, sql`0.3`, byScore, limit - rows.length);
        total += Number(variants[0]?.exactTotal ?? 0);
        rows = [...rows, ...variants];
      }
      return { hits: rows.map((r) => ({ id: r.id, rankingScore: Number(r.rankingScore) })), total };
    });
  }

  return { search };
}
