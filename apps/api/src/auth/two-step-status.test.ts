import { describe, expect, it } from "vitest";
import { createSupabaseTwoStepStatus } from "./auth-admin";

const id = "8f0c6a3e-1b2c-4d5e-8f90-123456789abc";
const status = (body: unknown, code = 200) =>
  createSupabaseTwoStepStatus({ url: "https://auth.test", serviceKey: "k", fetch: (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: code })) as typeof fetch })(id);

describe("two-step status from the Auth server (fails closed)", () => {
  it("reads a verified authenticator from a well-formed record", async () => {
    await expect(status({ id, factors: [{ factor_type: "totp", status: "verified" }] })).resolves.toBe(true);
    await expect(status({ id, factors: [{ factor_type: "totp", status: "unverified" }] })).resolves.toBe(false);
    await expect(status({ id, factors: null })).resolves.toBe(false);
    await expect(status({ id })).resolves.toBe(false);
  });

  it("never reads a garbled, partial or foreign answer as 'off'", async () => {
    await expect(status("not json")).rejects.toThrow();
    await expect(status({})).rejects.toThrow();
    await expect(status({ id: "someone-else", factors: [] })).rejects.toThrow();
    await expect(status({ id, factors: "x" })).rejects.toThrow();
    await expect(status({ id, factors: [] }, 500)).rejects.toThrow();
  });
});
