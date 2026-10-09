import { describe, expect, it } from "vitest";
import { fetchAvatar, isAllowedAvatarUrl } from "./avatar";

const jpeg = (bytes = 10, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes).fill(1), { status: 200, headers: { "content-type": "image/jpeg", ...headers } });

describe("avatar copying (scraped URLs are untrusted)", () => {
  it("allows only HTTPS links on the platforms' image hosts", () => {
    for (const ok of [
      "https://scontent-man2-1.cdninstagram.com/v/t51/x.jpg",
      "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt/x.jpeg",
      "https://p16-sign-sg.tiktokcdn.com/x.webp",
      "https://yt3.googleusercontent.com/abc=s800",
      "https://yt3.ggpht.com/abc",
      "https://i.ytimg.com/vi/x/hq720.jpg",
    ]) {
      expect(isAllowedAvatarUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      "http://scontent.cdninstagram.com/x.jpg",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/x.jpg",
      "https://127.0.0.1/x.jpg",
      "https://evil.example/cdninstagram.com/x.jpg",
      "https://cdninstagram.com.evil.example/x.jpg",
      "https://user:pass@scontent.cdninstagram.com/x.jpg",
      "https://scontent.cdninstagram.com:8443/x.jpg",
      "not a url",
    ]) {
      expect(isAllowedAvatarUrl(bad), bad).toBe(false);
    }
  });

  it("never requests a disallowed URL", async () => {
    const calls: string[] = [];
    const out = await fetchAvatar("https://169.254.169.254/latest/meta-data/", async (u) => {
      calls.push(String(u));
      return jpeg();
    });
    expect(out).toBeNull();
    expect(calls).toEqual([]);
  });

  it("accepts JPEG, PNG and WebP, and refuses SVG and other types", async () => {
    const url = "https://scontent.cdninstagram.com/x";
    expect(await fetchAvatar(url, async () => jpeg(10))).toMatchObject({ contentType: "image/jpeg", ext: "jpg" });
    expect(await fetchAvatar(url, async () => new Response("x", { headers: { "content-type": "image/png" } }))).toMatchObject({ ext: "png" });
    expect(await fetchAvatar(url, async () => new Response("<svg onload='x'/>", { headers: { "content-type": "image/svg+xml" } }))).toBeNull();
    expect(await fetchAvatar(url, async () => new Response("<html>", { headers: { "content-type": "text/html" } }))).toBeNull();
  });

  it("does not follow redirects", async () => {
    let init: RequestInit | undefined;
    const out = await fetchAvatar("https://scontent.cdninstagram.com/x", async (_u, i) => {
      init = i;
      return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } });
    });
    expect(out).toBeNull();
    expect(init?.redirect).toBe("manual");
  });

  it("stops reading past the size limit, with or without a declared length", async () => {
    const url = "https://scontent.cdninstagram.com/x";
    expect(await fetchAvatar(url, async () => jpeg(10, { "content-length": "5000000" }), 1000)).toBeNull();
    expect(await fetchAvatar(url, async () => jpeg(2000), 1000)).toBeNull();
    expect(await fetchAvatar(url, async () => jpeg(0), 1000)).toBeNull();
    expect((await fetchAvatar(url, async () => jpeg(500), 1000))?.bytes.length).toBe(500);
  });
});
