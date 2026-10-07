import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema, meResponseSchema, staffLoginRequestSchema, staffTotpRequestSchema } from "./index";

describe("contracts", () => {
  it("accepts a valid error envelope and rejects unknown codes", () => {
    expect(errorEnvelopeSchema.safeParse({ error: { code: "NOT_FOUND", message: "x", requestId: "r1" } }).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { code: "TEAPOT", message: "x", requestId: "r1" } }).success).toBe(false);
  });

  it("normalizes staff login email", () => {
    const parsed = staffLoginRequestSchema.parse({ email: "  Admin@Mushin.PK ", password: "pw" });
    expect(parsed.email).toBe("admin@mushin.pk");
  });

  it("requires a six-digit TOTP code", () => {
    expect(staffTotpRequestSchema.safeParse({ challengeToken: "t", code: "123456" }).success).toBe(true);
    expect(staffTotpRequestSchema.safeParse({ challengeToken: "t", code: "12345a" }).success).toBe(false);
  });

  it("describes the /v1/me response", () => {
    const ok = meResponseSchema.safeParse({
      user: { id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10", email: "a@b.pk", displayName: null, avatarUrl: null },
      workspace: { id: "0b7d7c3e-5d1a-4f7e-8c2b-9a1e3f4d5c6b", name: "A's workspace", role: "owner" },
    });
    expect(ok.success).toBe(true);
  });
});
