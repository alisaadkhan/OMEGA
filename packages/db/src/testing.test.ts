import { describe, expect, it } from "vitest";
import { assertDisposableTestDatabaseUrl } from "./testing";

describe("integration database safety", () => {
  it("accepts a clearly named local disposable database", () => {
    expect(assertDisposableTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/mushin_test")).toContain("mushin_test");
  });

  it("refuses remote databases before migration or truncation", () => {
    expect(() => assertDisposableTestDatabaseUrl("postgres://user:pass@db.example.test:5432/mushin_test")).toThrow(/Refusing integration setup/);
    expect(() => assertDisposableTestDatabaseUrl("postgres://user:pass@localhost:5432/postgres")).toThrow(/Refusing integration setup/);
  });

  it("rejects non-PostgreSQL and malformed URLs", () => {
    expect(() => assertDisposableTestDatabaseUrl("mysql://localhost/mushin_test")).toThrow(/require PostgreSQL/);
    expect(() => assertDisposableTestDatabaseUrl("not a URL")).toThrow(/valid local disposable PostgreSQL URL/);
  });
});
