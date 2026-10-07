import { describe, expect, it } from "vitest";
import { storableBody } from "./idempotency";

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
