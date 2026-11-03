import { inflateSync } from "node:zlib";

/**
 * Text of a PDF as a reader would see its names, for the attachment scan hook (owner decision 2026-11-03). Returns null
 * when the file cannot be checked with confidence, and the caller then refuses it: being strict here only costs a
 * customer re-saving an unusual PDF, being lenient could pass active content.
 *
 * Each stream's own dictionary is read with a small tokenizer (top-level keys only, nested << >>, arrays and strings
 * skipped), never with a fixed window. A stream is refused when its dictionary has a comment, a repeated key, or a
 * /Filter that is not a direct name or an array of direct names (indirect references cannot be checked here). Flate
 * streams are inflated and scanned (object streams can hide dictionaries); a predictor is accepted only where the data
 * is never parsed as objects. Image codecs are accepted only on /Subtype /Image streams. Encrypted files are refused.
 */
const MAX_INFLATED = 25 * 1024 * 1024;
const IMAGE_FILTERS = new Set(["DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode", "FlateDecode"]);
const DELIM = new Set(["/", "[", "]", "<", ">", "(", ")", "%", "{", "}"]);
const isSpace = (ch: string | undefined) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0";

export const unescapeNames = (s: string) => s.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** The dictionary ending right before `at` (the "stream" keyword), from its matching "<<"; null if there is none. */
function dictBefore(text: string, at: number): string | null {
  const close = text.lastIndexOf(">>", at);
  if (close === -1 || text.slice(close + 2, at).trim() !== "") return null;
  let depth = 0;
  for (let i = close + 1; i >= 1; i--) {
    if (text[i] === ">" && text[i - 1] === ">") {
      depth++;
      i--;
    } else if (text[i] === "<" && text[i - 1] === "<") {
      depth--;
      i--;
      if (depth === 0) return text.slice(i, close + 2);
    }
  }
  return null;
}

/** End index (exclusive) of the value starting at i: a name, array, dictionary, string or a run of plain tokens. */
function valueEnd(d: string, i: number): number | null {
  const ch = d[i];
  if (ch === "/") {
    let j = i + 1;
    while (j < d.length && !isSpace(d[j]) && !DELIM.has(d[j] as string)) j++;
    return j;
  }
  if (ch === "(") {
    let depth = 0;
    for (let j = i; j < d.length; j++) {
      if (d[j] === "\\") j++;
      else if (d[j] === "(") depth++;
      else if (d[j] === ")" && --depth === 0) return j + 1;
    }
    return null;
  }
  if (ch === "[" || (ch === "<" && d[i + 1] === "<")) {
    // Arrays and dictionaries nest each other; strings inside may hold brackets.
    let depth = 0;
    for (let j = i; j < d.length; j++) {
      const c = d[j];
      if (c === "(") {
        const e = valueEnd(d, j);
        if (e === null) return null;
        j = e - 1;
      } else if (c === "[" || (c === "<" && d[j + 1] === "<")) {
        depth++;
        if (c === "<") j++;
      } else if (c === "]" || (c === ">" && d[j + 1] === ">")) {
        depth--;
        if (c === ">") j++;
        if (depth === 0) return j + 1;
      }
    }
    return null;
  }
  if (ch === "<") {
    const e = d.indexOf(">", i);
    return e === -1 ? null : e + 1;
  }
  // Numbers, booleans, null and indirect references (3 0 R): plain tokens up to the next key or the end.
  let j = i;
  while (j < d.length && d[j] !== "/" && !(d[j] === ">" && d[j + 1] === ">") && d[j] !== "[" && d[j] !== "(" && d[j] !== "<") j++;
  return j === i ? null : j;
}

/** Top-level keys of a dictionary "<< ... >>" with their raw values; null for a comment, a repeated key or bad syntax. */
export function topLevelDict(dict: string): Map<string, string> | null {
  const d = unescapeNames(dict);
  if (!d.startsWith("<<") || !d.endsWith(">>")) return null;
  const body = d.slice(2, -2);
  const out = new Map<string, string>();
  let i = 0;
  for (;;) {
    while (i < body.length && isSpace(body[i])) i++;
    if (i >= body.length) return out;
    if (body[i] === "%") return null;
    if (body[i] !== "/") return null;
    const keyEnd = valueEnd(body, i);
    if (keyEnd === null) return null;
    const key = body.slice(i + 1, keyEnd);
    i = keyEnd;
    while (i < body.length && isSpace(body[i])) i++;
    const vEnd = valueEnd(body, i);
    if (vEnd === null) return null;
    const value = body.slice(i, vEnd).trim();
    if (value.includes("%")) return null;
    if (out.has(key)) return null;
    out.set(key, value);
    i = vEnd;
  }
}

/** Filters the scan decodes itself (in order, so chains like [/ASCII85Decode /FlateDecode] are read as a reader would). */
const TEXT_FILTERS = new Set(["FlateDecode", "ASCII85Decode", "ASCIIHexDecode"]);

function ascii85(b: Buffer): Buffer | null {
  let body = b.toString("latin1").replace(/\s+/g, "");
  if (body.startsWith("<~")) body = body.slice(2);
  const endAt = body.indexOf("~>");
  if (endAt !== -1) body = body.slice(0, endAt);
  const out: number[] = [];
  let group: number[] = [];
  for (const ch of body) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return null;
    group.push(c);
    if (group.length === 5) {
      const n = group.reduce((a, d) => a * 85 + d, 0);
      if (n > 0xffffffff) return null;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length === 1) return null;
  if (group.length > 1) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    const n = group.reduce((a, d) => a * 85 + d, 0);
    out.push(...[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, k - 1));
  }
  return Buffer.from(out);
}

function asciiHex(b: Buffer): Buffer | null {
  let s = b.toString("latin1").replace(/\s+/g, "");
  const e = s.indexOf(">");
  if (e !== -1) s = s.slice(0, e);
  if (!/^[0-9A-Fa-f]*$/.test(s)) return null;
  return Buffer.from(s.length % 2 ? `${s}0` : s, "hex");
}

function decode(filter: string, data: Buffer): Buffer | null {
  try {
    if (filter === "FlateDecode") return inflateSync(data, { maxOutputLength: MAX_INFLATED });
    if (filter === "ASCII85Decode") return ascii85(data);
    if (filter === "ASCIIHexDecode") return asciiHex(data);
  } catch {
    return null;
  }
  return null;
}

/** Filter names when /Filter is a direct name or an array of direct names; null otherwise (e.g. "5 0 R"). */
function filtersOf(value: string | undefined): string[] | null {
  if (value === undefined) return [];
  const v = value.trim();
  if (/^\/[A-Za-z0-9]+$/.test(v)) return [v.slice(1)];
  const arr = /^\[\s*((?:\/[A-Za-z0-9]+\s*)*)\]$/.exec(v);
  return arr ? [...(arr[1] as string).matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1] as string) : null;
}

/** The scan text, or why the file cannot be checked. */
export function pdfScan(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = raw.toString("latin1");
  if (/\/Encrypt(?![A-Za-z0-9])/.test(unescapeNames(text))) return no("encrypted");
  const parts = [text];
  let total = 0;
  for (let at = text.indexOf("stream"); at !== -1; at = text.indexOf("stream", at + 6)) {
    if (at >= 3 && text.slice(at - 3, at) === "end") continue;
    let start = at + 6;
    if (raw[start] === 0x0d) start++;
    if (raw[start] === 0x0a) start++;
    const end = text.indexOf("endstream", start);
    if (end === -1) return no("stream without an end");
    const rawDict = dictBefore(text, at);
    const dict = rawDict === null ? null : topLevelDict(rawDict);
    if (dict === null) return no(`unreadable stream dictionary: ${rawDict === null ? "none found" : rawDict.slice(0, 160)}`);
    const filters = filtersOf(dict.get("Filter"));
    if (filters === null) return no(`filter cannot be checked: ${dict.get("Filter")}`);
    const type = dict.get("Type");
    const objectStream = type === "/ObjStm";
    const parsedAsObjects = type !== "/XRef" && dict.get("Subtype") !== "/Image";
    const parms = dict.get("DecodeParms") ?? "";
    if (/\/Predictor\s+(?!1(?![0-9]))/.test(parms) && (objectStream || parsedAsObjects)) return no("predictor on a stream read as objects");
    if (filters.length === 0) {
      // Uncompressed: already scanned as part of the file's text.
    } else if (filters.every((f) => TEXT_FILTERS.has(f))) {
      if (parsedAsObjects || objectStream) {
        let data: Buffer | null = raw.subarray(start, end);
        for (const f of filters) {
          data = decode(f, data);
          if (data === null) return no(`a ${f} stream could not be read`);
          if (data.length > MAX_INFLATED) return no("too much compressed content");
        }
        total += data.length;
        if (total > MAX_INFLATED) return no("too much compressed content");
        parts.push(data.toString("latin1"));
      }
    } else if (!(filters.length === 1 && IMAGE_FILTERS.has(filters[0] as string) && dict.get("Subtype") === "/Image")) {
      return no(`filter cannot be checked: ${filters.join(" ")}`);
    }
    at = end;
  }
  return { ok: true, text: unescapeNames(parts.join("\n")) };
}

/** The scan text, or null when the file cannot be checked. */
export function pdfScanText(bytes: Uint8Array): string | null {
  const r = pdfScan(bytes);
  return r.ok ? r.text : null;
}
