import { sql, type SQL } from "drizzle-orm";
import type { SearchFilters } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { SearchHit } from "@mushin/integrations";
import { cityForms, expandQuery, type QueryGroup } from "./aliases";

export type CatalogSearchQuery = { text: string; filters: SearchFilters; freshCurrentDays: number; now: Date; limit: number; /** Words that only raise the rank (never required). */ boost?: string[] };
export type CatalogSearch = { search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">): Promise<{ hits: SearchHit[]; total: number }> };

/** Search the worker-maintained global creator projection. Hydration and visibility checks still run under tenant RLS. */
export function createPostgresCatalogSearch(db: Db): CatalogSearch {
  async function search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">) {
    const limit = Math.max(1, Math.min(1000, Math.trunc(query.limit)));
    const text = query.text.trim();
    const conditions = [sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`];
    // Recognised niche and city words (English, Roman Urdu, Urdu script, city short forms) match any of their reviewed
    // forms; a city also matches the creator's own declared city. Without a recognised word the query is unchanged.
    const groups = expandQuery(text);
    const anyForm = (g: QueryGroup) => sql.join(g.forms.map((form) => sql`plainto_tsquery('simple', ${form})`), sql` || `);
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
    if (f.platform) conditions.push(sql`d.platforms @> array[${f.platform}]::text[]`);
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
    const run = (match: SQL | null, ranked: SQL, order: SQL, take: number) =>
      db.withTenant(ctx, (tx) => tx.execute<Row>(sql`
        select d.creator_id as id, ${ranked}::real as "rankingScore", d.updated_epoch as "updatedEpoch", count(*) over() as "exactTotal"
        from gcp.creator_search_documents d
        join gcp.creators c on c.id = d.creator_id
        where ${sql.join(match ? [...conditions, match] : conditions, sql` and `)}
        order by ${order}
        limit ${take}
      `));

    if (!text) {
      const rows = await run(null, sql`0`, sql`d.engagement_rate desc nulls last, d.authenticity_score desc nulls last, d.followers desc nulls last, d.creator_id`, limit);
      return { hits: rows.map((r) => ({ id: r.id, rankingScore: 0 })), total: Number(rows[0]?.exactTotal ?? 0) };
    }

    // 1. Whole words through full-text search.
    const byScore = sql`"rankingScore" desc, d.updated_epoch desc`;
    // A creator matched only through the city field still scores on the words it did match.
    const words = await run(wordMatch, sql`least(ts_rank_cd(d.search_vector, ${rankQuery}) * 8, 1)`, byScore, limit);
    let total = Number(words[0]?.exactTotal ?? 0);
    let rows: Row[] = words;
    // 2. A typo or partial word ("Ayesah", "Siddiq") through trigram word similarity, which compares the query with the
    //    closest part of the text rather than the whole document. Only while whole words leave room in the pool: on a
    //    common word (thousands of matches) rechecking similarity across them cost ~1 s at 100k creators.
    if (total < limit) {
      const near = await run(sql`${text} <% d.search_text and not (${wordMatch})`, sql`word_similarity(${text}, d.search_text)`, byScore, limit - total);
      total += Number(near[0]?.exactTotal ?? 0);
      rows = [...words, ...near].sort((a, b) => b.rankingScore - a.rankingScore || Number(b.updatedEpoch) - Number(a.updatedEpoch));
    }
    return { hits: rows.map((r) => ({ id: r.id, rankingScore: Number(r.rankingScore) })), total };
  }

  return { search };
}
