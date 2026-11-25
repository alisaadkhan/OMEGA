import { describe, expect, it } from "vitest";
import { bareMentions, prefixedHandleUrls } from "./bio-mentions";

describe("bio @handles (owner, 25 Nov)", () => {
  it("links a handle only when the platform is named right before it", () => {
    expect(prefixedHandleUrls("IG: @ali.eats | TikTok - ali_eats_pk | YT @AliEatsTV")).toEqual([
      "https://www.instagram.com/ali.eats",
      "https://www.tiktok.com/@ali_eats_pk",
      "https://www.youtube.com/@AliEatsTV",
    ]);
    expect(prefixedHandleUrls("insta→ali.eats.")).toEqual(["https://www.instagram.com/ali.eats"]);
  });

  it("never guesses the platform of a bare @handle or reads ordinary words as a prefix", () => {
    expect(prefixedHandleUrls("Managed by @talentdesk. Instagram influencer from Lahore")).toEqual([]);
    expect(prefixedHandleUrls("tiktoker and youtuber")).toEqual([]);
    expect(prefixedHandleUrls("IG: alieats.com")).toEqual([]);
  });

  it("lists bare @mentions for the catalogue lookup, but not email addresses or URLs", () => {
    expect(bareMentions("Also @watchbykunal & @MakeBetterVideos. 📩 kunal@gmail.com https://x.com/@nope")).toEqual(["watchbykunal", "makebettervideos"]);
  });
});
