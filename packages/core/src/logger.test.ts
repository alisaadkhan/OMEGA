import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, maskEmail, maskIp } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("redacts secrets and masks emails", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info" }, stream);
    log.info({ user: { email: "ahmed@mushin.pk", password: "hunter2" }, auth: { accessToken: "tok" } }, "hello");
    const line = lines[0] as { user: { email: string; password: string }; auth: { accessToken: string } };
    expect(line.user.email).toBe("a***@mushin.pk");
    expect(line.user.password).toBe("[REDACTED]");
    expect(line.auth.accessToken).toBe("[REDACTED]");
  });

  it("redacts the authorization header of logged requests", () => {
    const { lines, stream } = capture();
    createLogger({ level: "info" }, stream).info({ req: { headers: { authorization: "Bearer x", cookie: "a=b" } } });
    // Request lines carry no headers at all since 2026-10-28 (method, path, host, masked address only).
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("Bearer x");
    expect(text).not.toContain("a=b");
  });

  it("masks client addresses and phone numbers", () => {
    const { lines, stream } = capture();
    createLogger({ level: "info" }, stream).info({ req: { method: "GET", url: "/v1/x", ip: "198.51.100.23" }, trial: { phone: "+92 300 1234567", mobile: "03001234567" } });
    const text = JSON.stringify(lines[0]);
    expect(text).toContain("198.51.100.0");
    expect(text).not.toMatch(/198\.51\.100\.23|1234567/);
    expect(maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3::");
    expect(maskIp("::ffff:10.1.2.3")).toBe("10.1.2.0");
  });

  it("redacts secrets nested at any depth without mutating the input", () => {
    const { lines, stream } = capture();
    const input = { data: { user: { email: "sara@mushin.pk", password: "pw" }, items: [{ refreshToken: "r" }] } };
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    createLogger({ level: "info" }, stream).info({ ...input, cyclic });
    const line = lines[0] as { data: { user: { email: string; password: string }; items: { refreshToken: string }[] } };
    expect(line.data.user.email).toBe("s***@mushin.pk");
    expect(line.data.user.password).toBe("[REDACTED]");
    expect(line.data.items[0]?.refreshToken).toBe("[REDACTED]");
    expect(input.data.user.password).toBe("pw");
  });

  it("redacts credential-looking key names in any spelling and URL passwords in text and errors (acceptance SEC-12)", () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: "info" }, stream);
    log.info({ apiKey: "sk_live_1", api_key: "k2", serviceRoleKey: "srk", provider: { webhookSecret: "whs", privateKey: "pk" }, keyword: "food" }, "config");
    log.info({ note: "connecting to postgres://app:pa55word@db.example.org:5432/x" }, "text");
    log.error({ err: new Error("connect failed postgres://app:pa55word@db.example.org:5432/x") }, "db error");
    const out = JSON.stringify(lines);
    for (const secret of ["sk_live_1", "k2", "srk", "whs", "pk\"", "pa55word"]) expect(out).not.toContain(secret);
    expect((lines[0] as { keyword: string }).keyword).toBe("food");
    expect(out).toContain("postgres://app:***@db.example.org");
  });

  it("maskEmail handles odd input", () => {
    expect(maskEmail("no-at-sign")).toBe("[REDACTED]");
  });
});
