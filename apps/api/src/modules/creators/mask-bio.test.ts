import { describe, expect, it } from "vitest";
import { CONTACT_HIDDEN, maskBioContacts } from "./rules";

// Security hardening 2026-11-03: emails and phone numbers are paid contacts; unrevealed bios and the search index hide them.
describe("maskBioContacts", () => {
  it("hides emails, spelled-out emails and phone numbers, keeps links and ordinary numbers", () => {
    const bio = "Lahore 📍 | 1.2M family | collab: sana.bridal@gmail.com | WhatsApp +92 300 1234567 | sana dot bridal at gmail dot com | linktr.ee/sana";
    const out = maskBioContacts(bio);
    expect(out).not.toMatch(/gmail|1234567/);
    expect(out).toContain(CONTACT_HIDDEN);
    expect(out).toContain("linktr.ee/sana");
    expect(out).toContain("1.2M family");
    expect(out).toContain("Lahore");
    expect(maskBioContacts(null)).toBeNull();
    expect(maskBioContacts("Bridal makeup artist, Karachi")).toBe("Bridal makeup artist, Karachi");
  });

  it("hides local 03xx numbers", () => {
    expect(maskBioContacts("Bookings 0300-1234567")).not.toContain("1234567");
  });
});
