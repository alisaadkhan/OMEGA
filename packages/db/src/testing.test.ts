import { describe, expect, it } from "vitest";
import { assertDisposableTestDatabaseUrl, assertTruncatableTestDatabaseUrl } from "./testing";

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

/** The integration suite truncates application tables; it must never reach the Search evaluation corpus (2026-10-16). */
describe("test database guards", () => {
  it("accepts local disposable test databases for truncation", () => {
    for (const db of ["mushin_test_claude", "mushin_supabase_test", "mushin_auth_disposable"]) {
      expect(assertTruncatableTestDatabaseUrl(`postgres://postgres@localhost:54330/${db}`)).toContain(db);
    }
  });

  it("refuses the evaluation corpus for truncation, though corpus scripts may still open it", () => {
    const corpus = "postgres://postgres@localhost:54330/mushin_eval_disposable";
    expect(() => assertTruncatableTestDatabaseUrl(corpus)).toThrow(/evaluation corpus/);
    expect(assertDisposableTestDatabaseUrl(corpus)).toBe(corpus);
  });

  it("refuses remote and production-looking databases", () => {
    expect(() => assertTruncatableTestDatabaseUrl("postgres://postgres:x@db.example.supabase.co:5432/postgres")).toThrow();
    expect(() => assertTruncatableTestDatabaseUrl("postgres://postgres@localhost:54330/mushin_local")).toThrow();
  });
});
