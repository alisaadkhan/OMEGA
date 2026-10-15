/**
 * Relevance metrics for the human-labelled search panel. Ratings per (query, creator): 2 relevant, 1 partly relevant,
 * 0 not relevant. "Strict" counts only 2 as relevant; "lenient" counts 1 and 2.
 */
export type Rating = 0 | 1 | 2;

export function precisionAt(ratings: Rating[], k: number, strict: boolean): number | null {
  if (ratings.length === 0) return null; // no results: reported as a zero-result query, not precision 0
  const top = ratings.slice(0, k);
  return top.filter((r) => (strict ? r === 2 : r >= 1)).length / Math.min(k, top.length);
}

/** nDCG@k with gains 0/1/2; the ideal ordering uses every judged result for the query (pooled judgements). */
export function ndcgAt(ranked: Rating[], judgedPool: Rating[], k: number): number | null {
  const dcg = (rs: Rating[]) => rs.slice(0, k).reduce<number>((sum, r, i) => sum + (2 ** r - 1) / Math.log2(i + 2), 0);
  const ideal = dcg([...judgedPool].sort((a, b) => b - a));
  if (ideal === 0) return null; // nothing relevant was judged: nDCG is undefined, not 0 or 1
  return dcg(ranked) / ideal;
}

/** Cohen's kappa between two raters on the same items (3 categories). */
export function cohensKappa(a: Rating[], b: Rating[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const n = a.length;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  let expected = 0;
  for (const c of [0, 1, 2] as Rating[]) expected += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

export const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null;
}

/** Minimal CSV for the rating sheets: quotes every field, doubles quotes inside. */
export const toCsv = (rows: (string | number | null)[][]): string =>
  rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/**
 * Acceptance gates (owner, provisional, 2026-10-14): mean strict precision@5, mean nDCG@10 over the pooled judgements and
 * relevant-query coverage, trusted only when the two raters agree (kappa) and every behaviour case passes.
 */
export const ACCEPTANCE_GATES = { kappa: 0.6, precisionAt5: 0.8, ndcgAt10: 0.75, coverage: 0.9, behaviour: 1 } as const;

export type GateResult = { name: string; value: number | null; threshold: number; pass: boolean };
export const gate = (name: string, value: number | null, threshold: number): GateResult => ({ name, value, threshold, pass: value !== null && value >= threshold - 1e-9 });

/**
 * Relevant-query coverage: of the queries with at least one fully relevant creator anywhere in the judged pool (MUSHIN's
 * results plus the pooled candidates), the share whose returned results include one.
 */
export function relevantCoverage(cases: { judged: Rating[]; returned: Rating[] }[]): { answerable: number; covered: number; share: number | null } {
  const answerable = cases.filter((c) => c.judged.includes(2));
  const covered = answerable.filter((c) => c.returned.includes(2)).length;
  return { answerable: answerable.length, covered, share: answerable.length ? covered / answerable.length : null };
}

/** FNV-1a: a stable order for rating sheets that hides each row's rank and whether it was returned or pooled. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export const blindOrder = <T>(items: T[], key: (t: T) => string): T[] => [...items].sort((a, b) => fnv1a(key(a)) - fnv1a(key(b)) || key(a).localeCompare(key(b)));
