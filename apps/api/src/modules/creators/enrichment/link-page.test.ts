import { describe, expect, it } from "vitest";
import { contactsFromPage, decodeCfEmail } from "./link-page";

const url = "https://ayesha.pk/";

describe("contacts on a creator's linked page (owner, 22 Nov)", () => {
  it("reads mailto, written and Cloudflare-protected emails, and tel and WhatsApp links", () => {
    // "ali@ayesha.pk" protected with key 0x42
    const cf = "42" + [..."ali@ayesha.pk"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("");
    const html = `<a href="mailto:Collabs@Ayesha.pk?subject=Hi">Email</a> <p>Bookings: team&#64;ayesha.pk</p>
      <span class="__cf_email__" data-cfemail="${cf}">[email protected]</span>
      <a href="tel:0300-1234567">Call</a> <a href="https://wa.me/923211234567">WhatsApp</a>`;
    expect(contactsFromPage(html, url)).toEqual({
      emails: ["ali@ayesha.pk", "collabs@ayesha.pk", "team@ayesha.pk"],
      phones: ["+923001234567", "+923211234567"],
      contactPages: [],
    });
    expect(decodeCfEmail(cf)).toBe("ali@ayesha.pk");
    // A Karachi UAN written locally is a Pakistani number.
    expect(contactsFromPage(`<a href="tel:021-111-222-333">UAN</a>`, url).phones).toEqual(["+9221111222333"]);
  });

  it("drops page-builder, widget and placeholder addresses, and anything inside scripts", () => {
    const html = `<script>var dsn="https://abc@o1.ingest.sentry.io/1"; var x="dev@vendor.com";</script>
      <p>support@linktr.ee you@example.com name@email.com logo@2x.png info@kemlu.go.id desk@punjab.gov.pk</p>`;
    expect(contactsFromPage(html, url).emails).toEqual([]);
  });

  it("offers same-site contact pages to read next, never another site's", () => {
    const html = `<a href="/pages/contact">Contact</a> <a href="https://ayesha.pk/about-us/">About</a> <a href="https://other.pk/contact">x</a>`;
    expect(contactsFromPage(html, url).contactPages).toEqual(["https://ayesha.pk/pages/contact", "https://ayesha.pk/about-us/"]);
  });
});
