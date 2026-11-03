import { inflateSync } from "node:zlib";

/**
 * Text of a PDF as a reader would see it, for the attachment scan hook (owner decision 2026-11-03). When the file cannot
 * be checked with confidence the answer is "not ok" and the caller refuses it: strictness only costs a customer
 * re-saving an unusual PDF; leniency could pass active content.
 *
 *  - Each stream's dictionary is tokenized from the raw bytes (top-level keys only; nested dictionaries, arrays and
 *    strings skipped). #xx escapes are decoded per name token after it is split off, and a name whose decoded form holds
 *    whitespace or a delimiter is refused. Comments, repeated keys and syntax errors are refused.
 *  - /Filter must be a direct name or an array of direct names; /DecodeParms absent, null, a direct dictionary or an
 *    array of those. Indirect references (5 0 R) cannot be checked here and are refused.
 *  - Every stream whose filters can be decoded (Flate, ASCII85, ASCIIHex, chained, at most 3) is decoded and scanned,
 *    whatever its /Type says, except image pixels (/Subtype /Image without /N or /First: a reader needs those two keys
 *    to take objects out of a stream). Data with a PNG/TIFF predictor is not decoded; it is only accepted on a stream
 *    that cannot be an object stream (no /N, no /First, and /Type /XRef or /Subtype /Image).
 *  - Image codecs (DCT, JPX, CCITT, JBIG2) are accepted only on /Subtype /Image streams without /N or /First.
 *  - Every decoder writes within one shared output budget; encrypted files are refused.
 */
const MAX_DECODED = 25 * 1024 * 1024;
const MAX_CHAIN = 3;
const MAX_DECODED_STREAMS = 5_000;
const IMAGE_CODECS = new Set(["DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode"]);
const TEXT_FILTERS = new Set(["FlateDecode", "ASCII85Decode", "ASCIIHexDecode"]);
const DELIMS = "/[]<>(){}%";
const isSpace = (ch: string | undefined) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0";
const isDelim = (ch: string | undefined) => ch !== undefined && DELIMS.includes(ch);

export const unescapeNames = (s: string) => s.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** A name token's decoded text (without the slash), or null when the decoded form holds whitespace or a delimiter. */
function decodeName(raw: string): string | null {
  const n = unescapeNames(raw);
  for (const ch of n) if (isSpace(ch) || isDelim(ch)) return null;
  return n;
}

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
    while (j < d.length && !isSpace(d[j]) && !isDelim(d[j])) j++;
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
    let depth = 0;
    for (let j = i; j < d.length; j++) {
      const c = d[j];
      if (c === "%") return null;
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
  let j = i;
  while (j < d.length && d[j] !== "/" && !(d[j] === ">" && d[j + 1] === ">") && d[j] !== "[" && d[j] !== "(" && d[j] !== "<" && d[j] !== "%") j++;
  return j === i ? null : j;
}

/**
 * Top-level keys of a raw dictionary "<< ... >>" (decoded key -> raw value text); null for a comment, a repeated key, a
 * name that decodes to whitespace or a delimiter, or bad syntax.
 */
export function topLevelDict(dict: string): Map<string, string> | null {
  if (!dict.startsWith("<<") || !dict.endsWith(">>")) return null;
  const body = dict.slice(2, -2);
  const out = new Map<string, string>();
  let i = 0;
  for (;;) {
    while (i < body.length && isSpace(body[i])) i++;
    if (i >= body.length) return out;
    if (body[i] !== "/") return null;
    const keyEnd = valueEnd(body, i);
    if (keyEnd === null) return null;
    const key = decodeName(body.slice(i + 1, keyEnd));
    if (key === null || out.has(key)) return null;
    i = keyEnd;
    while (i < body.length && isSpace(body[i])) i++;
    const vEnd = valueEnd(body, i);
    if (vEnd === null) return null;
    const value = body.slice(i, vEnd).trim();
    if (value.includes("%") && !value.startsWith("(")) return null;
    out.set(key, value);
    i = vEnd;
  }
}

/** A direct name value, decoded; null when the value is not a single name. */
function nameValue(v: string | undefined): string | null {
  if (v === undefined || !/^\/\S+$/.test(v)) return null;
  return decodeName(v.slice(1));
}

/** Filter names when /Filter is absent, a direct name, or an array of direct names; null otherwise (e.g. "5 0 R"). */
function filtersOf(value: string | undefined): string[] | null {
  if (value === undefined) return [];
  const v = value.trim();
  const single = nameValue(v);
  if (single !== null) return [single];
  if (!v.startsWith("[") || !v.endsWith("]")) return null;
  const items = v.slice(1, -1).trim().split(/(?=\/)/).map((s) => s.trim()).filter(Boolean);
  const names = items.map(nameValue);
  return names.every((n): n is string => n !== null) ? names : null;
}

/** True when /DecodeParms asks for a predictor; null when it cannot be read (indirect, or not dictionaries/null). */
function usesPredictor(value: string | undefined): boolean | null {
  if (value === undefined) return false;
  const v = value.trim();
  const parts = v.startsWith("[") && v.endsWith("]") ? (v.slice(1, -1).match(/<<[\s\S]*?>>|null|\S+/g) ?? []) : [v];
  let predictor = false;
  for (const p of parts) {
    if (p === "null") continue;
    const d = topLevelDict(p);
    if (d === null) return null;
    const pred = d.get("Predictor");
    if (pred === undefined) continue;
    if (!/^\d+$/.test(pred)) return null;
    if (Number(pred) > 1) predictor = true;
  }
  return predictor;
}

/** Decoders writing within `budget` bytes; null when the data is invalid or would exceed the budget. */
function inflate(data: Buffer, budget: number): Buffer | null {
  try {
    return inflateSync(data, { maxOutputLength: Math.max(1, budget) });
  } catch {
    return null;
  }
}

function ascii85(b: Buffer, budget: number): Buffer | null {
  let body = b.toString("latin1").replace(/\s+/g, "");
  if (body.startsWith("<~")) body = body.slice(2);
  const endAt = body.indexOf("~>");
  if (endAt !== -1) body = body.slice(0, endAt);
  const out = Buffer.alloc(Math.min(budget, body.length * 4));
  let n = 0;
  let group: number[] = [];
  const emit = (bytes: number[]) => {
    if (n + bytes.length > out.length) return false;
    for (const x of bytes) out[n++] = x;
    return true;
  };
  for (const ch of body) {
    if (ch === "z" && group.length === 0) {
      if (!emit([0, 0, 0, 0])) return null;
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return null;
    group.push(c);
    if (group.length === 5) {
      const v = group.reduce((a, d) => a * 85 + d, 0);
      if (v > 0xffffffff || !emit([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])) return null;
      group = [];
    }
  }
  if (group.length === 1) return null;
  if (group.length > 1) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    const v = group.reduce((a, d) => a * 85 + d, 0);
    if (!emit([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, k - 1))) return null;
  }
  return out.subarray(0, n);
}

function asciiHex(b: Buffer, budget: number): Buffer | null {
  let s = b.toString("latin1").replace(/\s+/g, "");
  const e = s.indexOf(">");
  if (e !== -1) s = s.slice(0, e);
  if (!/^[0-9A-Fa-f]*$/.test(s) || Math.ceil(s.length / 2) > budget) return null;
  return Buffer.from(s.length % 2 ? `${s}0` : s, "hex");
}

function decode(filter: string, data: Buffer, budget: number): Buffer | null {
  if (filter === "FlateDecode") return inflate(data, budget);
  if (filter === "ASCII85Decode") return ascii85(data, budget);
  if (filter === "ASCIIHexDecode") return asciiHex(data, budget);
  return null;
}

/** The scan text, or why the file cannot be checked. */
export function pdfScan(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = raw.toString("latin1");
  if (/\/Encrypt(?![A-Za-z0-9])/.test(unescapeNames(text))) return no("encrypted");
  const parts = [text];
  let used = 0;
  let decoded = 0;
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
    if (filters.length > MAX_CHAIN) return no("too many chained filters");
    const predictor = usesPredictor(dict.get("DecodeParms"));
    if (predictor === null) return no(`decode parameters cannot be checked: ${dict.get("DecodeParms")}`);
    // Could a reader take objects out of this stream? Only object streams carry /N and /First.
    const mayHoldObjects = dict.has("N") || dict.has("First") || nameValue(dict.get("Type")) === "ObjStm";
    const isImage = nameValue(dict.get("Subtype")) === "Image";
    const isXref = nameValue(dict.get("Type")) === "XRef";

    if (filters.length === 0) {
      // Uncompressed: already scanned as part of the file's text.
    } else if (filters.every((f) => TEXT_FILTERS.has(f))) {
      if (predictor) {
        // Predicted data is not decoded here; it is accepted only where no object can be read from it.
        if (mayHoldObjects || !(isXref || isImage)) return no("predictor on a stream that may hold objects");
      } else if (isImage && !mayHoldObjects) {
        // Pixels: a reader needs /N and /First to take objects out of a stream, so an image without them holds none.
        // Not decoding them keeps ordinary screenshots and scans inside the size budget.
      } else {
        if (++decoded > MAX_DECODED_STREAMS) return no("too many compressed streams");
        let data: Buffer | null = raw.subarray(start, end);
        for (const f of filters) {
          // Every stage of a chain is charged, not only the last one.
          data = decode(f, data, MAX_DECODED - used);
          if (data === null) return no(`a ${f} stream could not be read within the size limit`);
          used += data.length;
          if (used > MAX_DECODED) return no("too much compressed content");
        }
        parts.push(data.toString("latin1"));
      }
    } else if (!(filters.length === 1 && IMAGE_CODECS.has(filters[0] as string) && isImage && !mayHoldObjects)) {
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
