import { describe, expect, it } from "vitest";
import { integrationsOf } from "./integrations";

describe("integrations inventory (owner, 22 Nov)", () => {
  it("reports which services and backup keys are set, and never any part of a key", () => {
    const secret = "sk-live-abcdef123456";
    const r = integrationsOf({ GROQ_API_KEY: secret, GROQ_API_KEY_3: secret, APIFY_TOKEN_2: secret, GEMINI_API_KEY: "  " });
    const by = Object.fromEntries(r.integrations.map((i) => [i.key, i]));
    expect(by["groq-1"]).toMatchObject({ configured: true, role: "primary" });
    expect(by["groq-2"]?.configured).toBe(false);
    expect(by["groq-3"]).toMatchObject({ configured: true, role: "backup" });
    expect(by["apify-2"]?.configured).toBe(true);
    expect(by["gemini"]?.configured).toBe(false);
    expect(JSON.stringify(r)).not.toContain("sk-live");
  });
});
