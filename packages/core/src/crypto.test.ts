import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "./crypto";

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
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("other").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(token, Buffer.alloc(32, 2))).toThrow();
    expect(() => decryptSecret("garbage", key)).toThrow(/malformed/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("hashes and generates tokens", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
