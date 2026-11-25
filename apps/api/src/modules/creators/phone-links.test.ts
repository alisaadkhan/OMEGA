import { describe, expect, it } from "vitest";
import { carriesPhone, withoutPhoneLinks } from "./repository";

describe("links that can carry a phone number stay behind the paid reveal (security review, 25 Nov)", () => {
  it("withholds chat links, phone schemes, long digit runs and redirect-wrapped numbers", () => {
    for (const l of [
      "https://wa.me/923001234567", "wa.me/923001234567", "https://api.whatsapp.com/send?phone=923001234567", "https://WA.LINK/abc",
      "https://t.me/+923001234567", "tel:+923001234567", "sms:03001234567", "whatsapp://send?phone=92300", "viber://chat?number=923001234567",
      "https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F923001234567", "https://linktr.ee/ali?call=0300-1234567", "https://example.pk/contact/0300%201234567",
      "http://[bad", "https://%zz",
    ]) expect(carriesPhone(l), l).toBe(true);
  });

  it("keeps ordinary profile and website links", () => {
    for (const l of ["https://www.instagram.com/ali.eats", "https://linktr.ee/alieats", "https://alieats.pk/menu", "https://youtube.com/@AliEats", "https://www.tiktok.com/@ali_eats"])
      expect(carriesPhone(l), l).toBe(false);
  });

  it("shows everything once the workspace has revealed the contacts", () => {
    const links = [{ url: "https://linktr.ee/a" }, { url: "https://wa.me/923001234567" }];
    expect(withoutPhoneLinks(links, false)).toEqual([{ url: "https://linktr.ee/a" }]);
    expect(withoutPhoneLinks(links, true)).toEqual(links);
  });
});
