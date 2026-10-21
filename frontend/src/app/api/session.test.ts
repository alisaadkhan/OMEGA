import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionNotice, markSessionExpired, rememberCurrentView, takeReturnView, takeSessionExpired } from "./session";

// A minimal sessionStorage for the node test environment.
beforeEach(() => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
});

const VIEWS = ["overview", "search", "lists", "billing"] as const;

describe("session expiry notice", () => {
  it("shows the notice once and returns to the page that was open", () => {
    rememberCurrentView("lists");
    markSessionExpired();
    expect(takeSessionExpired()).toBe(true);
    expect(takeSessionExpired()).toBe(false);
    expect(takeReturnView(VIEWS)).toBe("lists");
    expect(takeReturnView(VIEWS)).toBeNull();
  });

  it("says nothing after a sign-out the person asked for", () => {
    rememberCurrentView("search");
    markSessionExpired();
    clearSessionNotice();
    expect(takeSessionExpired()).toBe(false);
    expect(takeReturnView(VIEWS)).toBeNull();
  });

  it("ignores a stored page that is not a dashboard page", () => {
    rememberCurrentView("admin");
    markSessionExpired();
    expect(takeReturnView(VIEWS)).toBeNull();
  });

  it("works without storage (blocked): no notice, no error", () => {
    (globalThis as { window?: unknown }).window = {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    };
    expect(() => markSessionExpired()).not.toThrow();
    expect(takeSessionExpired()).toBe(false);
  });
});
