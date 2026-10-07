import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  assertKey(key);
  const [version, iv, tag, ciphertext] = token.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("malformed encrypted value");
  // Pin the tag length: without it GCM accepts truncated (forgeable) tags.
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
