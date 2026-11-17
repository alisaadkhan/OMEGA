import { describe, expect, it } from "vitest";
import { PASSWORD_HINT, friendlyPasswordError, passwordMeetsRules } from "./password-rules";

describe("password rules", () => {
  it("accepts 8+ characters with both cases, a number and a symbol", () => {
    expect(passwordMeetsRules("Mushin#2026")).toBe(true);
    expect(passwordMeetsRules("Ab1!efgh")).toBe(true);
  });

  it("rejects a password missing any one rule", () => {
    expect(passwordMeetsRules("Ab1!efg")).toBe(false); // 7 characters
    expect(passwordMeetsRules("ab1!efgh")).toBe(false); // no uppercase
    expect(passwordMeetsRules("AB1!EFGH")).toBe(false); // no lowercase
    expect(passwordMeetsRules("Abc!efgh")).toBe(false); // no number
    expect(passwordMeetsRules("Ab1 efgh")).toBe(false); // a space is not a special character for the Auth server
  });

  it("turns the Auth server's character list into the plain hint", () => {
    const raw = "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~.";
    expect(friendlyPasswordError({ message: raw })).toBe(PASSWORD_HINT);
    expect(friendlyPasswordError({ message: "x", code: "weak_password" })).toBe(PASSWORD_HINT);
    expect(friendlyPasswordError({ message: "Password should be at least 8 characters." })).toBe(PASSWORD_HINT);
    expect(friendlyPasswordError({ message: "Email not confirmed" })).toBeNull();
  });
});
