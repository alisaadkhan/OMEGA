import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
}

/**
 * A key's public id: the first 8 hex characters of its SHA-256 (audit SEC-09). Stored with each value so a rotation
 * knows which key sealed it; it reveals nothing usable about the key.
 */
export function keyId(key: Buffer): string {
  assertKey(key);
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** AES-256-GCM. Format v2: `v2.<key id>.<iv>.<tag>.<ciphertext>` (v1 had no key id and is still read). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v2", keyId(key), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function open(key: Buffer, iv: string, tag: string, ciphertext: string): string {
  // Pin the tag length: without it GCM accepts truncated (forgeable) tags.
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Decrypts with the key that sealed the value, chosen from `keys` (one key, or the current key plus previous ones
 * during a rotation). v1 values carry no key id, so each key is tried; GCM authentication rejects every wrong one.
 */
export function decryptSecret(token: string, keys: Buffer | readonly Buffer[]): string {
  const ring = Buffer.isBuffer(keys) ? [keys] : [...keys];
  ring.forEach(assertKey);
  const parts = token.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, kid, iv, tag, ciphertext] = parts as [string, string, string, string, string];
    const key = ring.find((k) => keyId(k) === kid);
    if (!key) throw new Error(`no encryption key with id ${kid} is configured`);
    return open(key, iv, tag, ciphertext);
  }
  if (parts[0] === "v1" && parts.length === 4 && parts[1] && parts[2]) {
    const [, iv, tag, ciphertext] = parts as [string, string, string, string];
    for (const key of ring) {
      try {
        return open(key, iv, tag, ciphertext);
      } catch {
        // wrong key or tampered: try the next key
      }
    }
    throw new Error("encrypted value could not be decrypted with any configured key");
  }
  throw new Error("malformed encrypted value");
}

/** The id of the key that sealed a value, or null for v1 values (no id recorded). */
export function encryptedKeyId(token: string): string | null {
  const parts = token.split(".");
  return parts[0] === "v2" && parts.length === 5 ? (parts[1] ?? null) : null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Sorted-key JSON, so the same search always hashes the same way. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Shortens text to at most `max` characters without cutting an emoji or other astral character in half: String#slice
 * counts UTF-16 units, and a lone surrogate half makes PostgreSQL reject the JSON the text is sent in.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
