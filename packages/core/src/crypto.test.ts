import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptedKeyId, encryptSecret, keyId, randomToken, sha256Hex, truncate } from "./crypto";

const key = Buffer.alloc(32, 1);

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXPJBSWY3DP", key);
    const b = encryptSecret("JBSWY3DPEHPK3PXPJBSWY3DP", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXPJBSWY3DP");
  });

  it("rejects tampering and the wrong key", () => {
    const token = encryptSecret("secret", key);
    const parts = token.split(".");
    const tampered = [...parts.slice(0, 4), Buffer.from("other").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(token, Buffer.alloc(32, 2))).toThrow(/no encryption key with id/);
    // A forged key id pointing at the right key still fails authentication with any other key's ciphertext.
    expect(() => decryptSecret(encryptSecret("x", Buffer.alloc(32, 2)).replace(/^v2\.[0-9a-f]{8}/, `v2.${keyId(key)}`), key)).toThrow();
    expect(() => decryptSecret("garbage", key)).toThrow(/malformed/);
  });

  it("rejects truncated auth tags", () => {
    const [version, kid, iv, tag, ciphertext] = encryptSecret("secret", key).split(".");
    const shortTag = Buffer.from(tag ?? "", "base64url").subarray(0, 4).toString("base64url");
    expect(() => decryptSecret([version, kid, iv, shortTag, ciphertext].join("."), key)).toThrow();
  });

  it("records which key sealed a value and decrypts from a key ring during a rotation (audit SEC-09)", () => {
    const next = Buffer.alloc(32, 9);
    const token = encryptSecret("value", key);
    expect(token).toMatch(/^v2\.[0-9a-f]{8}\./);
    expect(encryptedKeyId(token)).toBe(keyId(key));
    expect(keyId(key)).not.toBe(keyId(next));
    expect(decryptSecret(token, [next, key])).toBe("value");
    expect(() => decryptSecret(token, [next])).toThrow(/no encryption key with id/);
  });

  it("still reads v1 values (no key id) with any key of the ring", () => {
    const iv = Buffer.alloc(12, 3);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update("legacy", "utf8"), c.final()]);
    const v1 = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    expect(decryptSecret(v1, key)).toBe("legacy");
    expect(decryptSecret(v1, [Buffer.alloc(32, 9), key])).toBe("legacy");
    expect(encryptedKeyId(v1)).toBeNull();
    expect(() => decryptSecret(v1, [Buffer.alloc(32, 9)])).toThrow(/any configured key/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("hashes and generates tokens", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("truncate", () => {
  const smile = String.fromCodePoint(0x1f600); // two UTF-16 units
  it("never leaves half of an emoji at the cut", () => {
    const text = "a".repeat(9) + smile + "b";
    expect(truncate(text, 10)).toBe("a".repeat(9)); // slice(0, 10) would end on a lone high surrogate
    expect(truncate(text, 11)).toBe("a".repeat(9) + smile);
    expect(JSON.parse(JSON.stringify(truncate(text, 10)))).toBe("a".repeat(9));
    expect(truncate("short", 10)).toBe("short");
  });
});
