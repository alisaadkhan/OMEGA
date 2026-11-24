import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bioLinksFrom } from "@mushin/contracts";
import { CreatorLinkIcons } from "../components/dashboard/CreatorLinkIcons";

describe("CreatorLinkIcons (owner, 24 Nov)", () => {
  const links = bioLinksFrom([
    "https://www.instagram.com/ali.food/", "https://youtube.com/@AliFoodPK", "https://www.tiktok.com/@ali_eats", "https://linktr.ee/alieats",
    "https://beacons.ai/ali", "https://wa.me/923001234567", "https://x.com/alieats", "https://facebook.com/alieats", "https://snapchat.com/add/ali",
    "https://linkedin.com/in/ali", "https://alieats.pk/shop", "http://instagram.com/ali.food",
  ]);
  const html = renderToStaticMarkup(createElement(CreatorLinkIcons, { links }));

  it("draws one icon link per unique destination, each opening safely in a new tab", () => {
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(11);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
    expect([...html.matchAll(/data-link-kind="([a-z]+)"/g)].map((m) => m[1])).toEqual(["instagram", "youtube", "tiktok", "linktree", "beacons", "whatsapp", "x", "facebook", "snapchat", "linkedin", "website"]);
  });

  it("labels each icon with the platform and handle or domain, and never prints a raw URL as text", () => {
    for (const label of ["Instagram · @ali.food", "YouTube · @AliFoodPK", "TikTok · @ali_eats", "Linktree · @alieats", "WhatsApp", "X · @alieats", "alieats.pk"]) expect(html).toContain(`aria-label="${label}"`);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("renders nothing when there are no links", () => {
    expect(renderToStaticMarkup(createElement(CreatorLinkIcons, { links: [] }))).toBe("");
  });
});
