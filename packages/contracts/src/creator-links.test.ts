import { describe, expect, it } from "vitest";
import { bioLinksFrom, classifyLink } from "./creator-links";

describe("creator bio links (owner, 24 Nov)", () => {
  it.each([
    ["https://www.instagram.com/ali.food/", "instagram", "ali.food", "Instagram · @ali.food"],
    ["youtube.com/@AliFoodPK", "youtube", "AliFoodPK", "YouTube · @AliFoodPK"],
    ["https://www.youtube.com/channel/UC123", "youtube", null, "YouTube"],
    ["https://www.tiktok.com/@ali_eats?lang=en", "tiktok", "ali_eats", "TikTok · @ali_eats"],
    ["https://linktr.ee/alieats", "linktree", "alieats", "Linktree · @alieats"],
    ["beacons.ai/ali", "beacons", "ali", "Beacons · @ali"],
    ["https://taplink.cc/ali", "taplink", "ali", "Taplink · @ali"],
    ["https://hoo.be/ali", "hoobe", "ali", "hoo.be · @ali"],
    ["https://bio.site/ali", "biosite", "ali", "Bio.site · @ali"],
    ["https://campsite.bio/ali", "campsite", "ali", "Campsite · @ali"],
    ["https://wa.me/923001234567", "whatsapp", null, "WhatsApp"],
    ["https://api.whatsapp.com/send?phone=923001234567", "whatsapp", null, "WhatsApp"],
    ["https://wa.link/abc123", "whatsapp", null, "WhatsApp"],
    ["https://facebook.com/alieats", "facebook", "alieats", "Facebook · @alieats"],
    ["https://twitter.com/alieats", "x", "alieats", "X · @alieats"],
    ["https://x.com/alieats", "x", "alieats", "X · @alieats"],
    ["https://www.snapchat.com/add/alieats", "snapchat", null, "Snapchat"],
    ["https://www.linkedin.com/in/ali-raza", "linkedin", null, "LinkedIn"],
    ["https://www.threads.net/@alieats", "threads", "alieats", "Threads · @alieats"],
    ["https://twitch.tv/alieats", "twitch", "alieats", "Twitch · @alieats"],
    ["https://discord.gg/abcd", "discord", null, "Discord"],
    ["https://open.spotify.com/show/xyz", "spotify", null, "Spotify"],
    ["https://alieats.pk/shop", "website", null, "alieats.pk"],
  ])("%s → %s", (raw, kind, handle, label) => {
    expect(classifyLink(raw)).toMatchObject({ kind, handle, label });
  });

  it("returns clean https URLs and refuses junk", () => {
    expect(classifyLink("http://alieats.pk/")?.url).toBe("https://alieats.pk");
    expect(classifyLink("https://instagram.com/p/Cabc123")).toMatchObject({ kind: "instagram", handle: null });
    for (const junk of ["", "not a link", "javascript:alert(1)", "mailto:a@b.co", "https://localhost/x", "ftp://files.example.com"]) expect(classifyLink(junk)).toBeNull();
  });

  it("never throws on a creator-written link with broken percent-encoding (one bad link must not fail a search page)", () => {
    expect(() => classifyLink("https://x.com/%E0%A4%A")).not.toThrow();
    expect(() => bioLinksFrom(["https://instagram.com/%E0%A4%A", "https://alieats.pk"])).not.toThrow();
    expect(bioLinksFrom(["https://instagram.com/%E0%A4%A", "https://alieats.pk"]).map((l) => l.url)).toContain("https://alieats.pk");
  });

  it("keeps one entry per destination across platforms and spellings", () => {
    const links = bioLinksFrom(["https://www.instagram.com/ali/", "http://instagram.com/ali", "linktr.ee/ali", "https://LINKTR.EE/ali/", "https://wa.me/923001234567", "https://alieats.pk"]);
    expect(links.map((l) => l.kind)).toEqual(["instagram", "linktree", "whatsapp", "website"]);
  });
});
