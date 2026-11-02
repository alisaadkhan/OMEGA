import { truncate } from "@mushin/core";

/** Drops a half emoji (a lone UTF-16 surrogate) at either end; the database would store it as "�". */
export function wholeChars(s: string): string {
  return s.replace(/^[\uDC00-\uDFFF]/, "").replace(/[\uD800-\uDBFF]$/, "");
}

/** A short quote of `raw` around the first occurrence of `needle` (case-insensitive), for evidence rows. */
export function quote(raw: string, needle: string, max = 200): string {
  const i = raw.toLowerCase().indexOf(needle.toLowerCase());
  const s = i < 0 ? raw.slice(0, 160) : raw.slice(Math.max(0, i - 60), i + needle.length + 60);
  return truncate(wholeChars(s).replace(/\s+/g, " ").trim(), max);
}
