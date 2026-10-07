import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, maskEmail } from "./logger";

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
    const line = lines[0] as { req: { headers: Record<string, string> } };
    expect(line.req.headers.authorization).toBe("[REDACTED]");
    expect(line.req.headers.cookie).toBe("[REDACTED]");
  });

  it("maskEmail handles odd input", () => {
    expect(maskEmail("no-at-sign")).toBe("[REDACTED]");
  });
});
