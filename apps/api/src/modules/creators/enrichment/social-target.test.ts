import { describe, expect, it } from "vitest";
import { socialTarget } from "./repository";

describe("cross-platform links: which profile a URL points at", () => {
  it("LINK-01 reads Instagram, TikTok and YouTube profile URLs in their common shapes", () => {
    expect(socialTarget("https://youtube.com/@duckybhai")).toEqual({ platform: "youtube", handle: "duckybhai" });
    expect(socialTarget("https://www.youtube.com/wildlensbyabrar")).toEqual({ platform: "youtube", handle: "wildlensbyabrar" });
    expect(socialTarget("https://m.youtube.com/c/SomeChannel")).toEqual({ platform: "youtube", handle: "somechannel" });
    expect(socialTarget("instagram.com/Hiraa_Faisal/?igsh=abc")).toEqual({ platform: "instagram", handle: "hiraa_faisal" });
    expect(socialTarget("https://www.tiktok.com/@jannatmirza")).toEqual({ platform: "tiktok", handle: "jannatmirza" });
  });
  it("LINK-02 ignores posts, videos and other sites", () => {
    expect(socialTarget("https://www.instagram.com/p/ABC123/")).toBeNull();
    expect(socialTarget("https://www.youtube.com/watch?v=x")).toBeNull();
    expect(socialTarget("https://whatsapp.com/channel/1")).toBeNull();
    expect(socialTarget("not a url")).toBeNull();
  });
});
