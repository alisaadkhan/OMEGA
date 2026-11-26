import { describe, expect, it } from "vitest";
import { checkAvatar } from "./staff-avatar";

const url = (type: string, bytes: number[] | Buffer) => `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];

describe("staff profile photo check (owner, 25 Nov)", () => {
  it("accepts real PNG, JPEG and WebP images", () => {
    for (const [t, b] of [["png", PNG], ["jpeg", JPEG], ["webp", WEBP]] as const) expect(checkAvatar(url(t, b))).toBe(url(t, b));
  });

  it("refuses SVG, other types, a file that lies about its type, and anything over 150 KB", () => {
    expect(() => checkAvatar(`data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`)).toThrow(/PNG, JPEG or WebP/);
    expect(() => checkAvatar("https://evil.test/a.png")).toThrow(/PNG, JPEG or WebP/);
    expect(() => checkAvatar(url("png", JPEG))).toThrow(/not the image type/);
    expect(() => checkAvatar(url("jpeg", Buffer.from("<html>hello</html>")))).toThrow(/not the image type/);
    expect(() => checkAvatar(url("png", Buffer.concat([Buffer.from(PNG), Buffer.alloc(150_001)])))).toThrow(/under 150 KB/);
  });
});
