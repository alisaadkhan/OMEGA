/**
 * Brain 1 stage diagnosis: for each panel query, shows what query understanding kept, which required term groups it
 * produced, and how many catalogue documents match each group alone and all together. A query whose groups each match
 * but not together is a combination problem; a group matching nothing is missing data (or a missing alias).
 *   TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_eval_disposable TEST_DATABASE_SSL_CA_FILE= \
 *     node --import tsx scripts/search-eval/diagnose-brain1.ts <queries.csv> [out.json]
 * Read-only; no provider calls.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createTestDatabase, ownerQuery } from "@mushin/db/testing";
import { expandQuery, understandQuery } from "../../apps/api/src/modules/creators/index";
import { parseCsv } from "./metrics";

const [queriesPath, out] = process.argv.slice(2);
if (!queriesPath) throw new Error("usage: diagnose-brain1.ts <queries.csv> [out.json]");
const db = createTestDatabase(); // refuses anything but a local test/disposable database
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const groupSql = (forms: string[], city: boolean) => {
  const ts = forms.map((f) => `plainto_tsquery('simple', ${lit(f)})`).join(" || ");
  return city ? `(d.search_vector @@ (${ts}) or lower(d.city) in (${forms.map(lit).join(", ")}))` : `d.search_vector @@ (${ts})`;
};
const count = async (where: string) =>
  Number((await ownerQuery<{ n: number }>(`select count(*)::int n from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id where c.status = 'active' and ${where}`))[0]?.n ?? 0);

const rows = parseCsv(readFileSync(queriesPath, "utf8").replace(new RegExp("^" + String.fromCharCode(0xfeff)), ""));
const [header, ...data] = rows;
const col = (name: string) => header?.indexOf(name) ?? -1;
const report: unknown[] = [];
for (const r of data) {
  const id = r[col("case_id")] ?? "";
  const q = r[col("query_text")] ?? "";
  const u = understandQuery(q);
  const groups = expandQuery(u.text) ?? u.text.split(" ").filter(Boolean).map((w) => ({ kind: "word" as const, canonical: w, forms: [w] }));
  const per = [];
  for (const g of groups) per.push({ group: g.canonical, kind: g.kind, matches: await count(groupSql(g.forms, g.kind === "city")) });
  const all = groups.length ? await count(groups.map((g) => groupSql(g.forms, g.kind === "city")).join(" and ")) : null;
  const line = { id, query: q, kept: u.text, filters: u.filters, groups: per, allGroups: all };
  report.push(line);
  console.log(`${id} kept="${u.text}" ${JSON.stringify(u.filters)} :: ${per.map((p) => `${p.group}(${p.kind})=${p.matches}`).join(" & ")} => ${all}`);
}
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
await db.close();
