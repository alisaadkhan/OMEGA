import { describe, expect, it } from "vitest";
import { requestHash, storableBody } from "./idempotency";

describe("requestHash", () => {
  const base = { userId: "u1", method: "POST", route: "/v1/spend", body: { amount: 5 } };

  it("is stable for the same request from the same user", () => {
    expect(requestHash(base)).toBe(requestHash({ ...base }));
  });

  it("differs per user, so a shared workspace never replays one member's response to another", () => {
    expect(requestHash({ ...base, userId: "u2" })).not.toBe(requestHash(base));
  });

  it("differs per body and route", () => {
    expect(requestHash({ ...base, body: { amount: 6 } })).not.toBe(requestHash(base));
    expect(requestHash({ ...base, route: "/v1/other" })).not.toBe(requestHash(base));
  });
});

describe("storableBody", () => {
  it("stores JSON responses and empty bodies", () => {
    expect(storableBody('{"execution":1}')).toEqual({ ok: true, body: { execution: 1 } });
    expect(storableBody("")).toEqual({ ok: true, body: null });
    expect(storableBody(null)).toEqual({ ok: true, body: null });
  });

  it("refuses bodies it cannot replay faithfully instead of throwing after the handler ran", () => {
    expect(storableBody("plain text, not JSON")).toEqual({ ok: false });
    expect(storableBody(Buffer.from("binary"))).toEqual({ ok: false });
  });
});
