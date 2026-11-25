import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createYouTubeApi, youtubeHandleOf } from "./youtube-expand";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("$0 YouTube expansion API (owner, 25 Nov)", () => {
  it("searches channels in Pakistan's region and reads their statistics 50 ids per call, recording every unit", async () => {
    const urls: string[] = [];
    const recorded: number[] = [];
    const ids = Array.from({ length: 60 }, (_, i) => `UC${String(i).padStart(22, "0")}`);
    const api = createYouTubeApi({
      apiKey: "k",
      logger: createLogger({ level: "silent", name: "t" }),
      sink: { record: async (c) => void recorded.push(Number(c.units ?? 0)) },
      fetch: async (u) => {
        const url = String(u);
        urls.push(url);
        if (url.includes("/search?")) return json({ items: ids.map((channelId) => ({ id: { channelId } })) });
        const asked = new URL(url).searchParams.get("id")?.split(",") ?? [];
        return json({ items: asked.map((id, i) => ({ id, snippet: { customUrl: `@ch${id.slice(-3)}`, country: "PK" }, statistics: i === 0 ? { hiddenSubscriberCount: true } : { subscriberCount: "25000" } })) });
      },
    });
    const found = await api.searchChannels("calligraphy artist Lahore");
    expect(found).toHaveLength(60);
    expect(found[0]).toMatchObject({ handle: "@ch000", subscribers: null });
    expect(found[1]).toMatchObject({ subscribers: 25_000, country: "PK" });
    const search = new URL(urls[0] ?? "");
    expect(Object.fromEntries(["type", "regionCode", "maxResults"].map((k) => [k, search.searchParams.get(k)]))).toEqual({ type: "channel", regionCode: "PK", maxResults: "50" });
    expect(urls.filter((u) => u.includes("/channels?"))).toHaveLength(2); // 60 ids: two batched calls, never one per channel
    expect(recorded).toEqual([100, 1, 1]);
  });

  it("stops on a used-up daily quota instead of retrying", async () => {
    const api = createYouTubeApi({ apiKey: "k", logger: createLogger({ level: "silent", name: "t" }), sink: { record: async () => {} }, fetch: async () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403) });
    await expect(api.searchChannels("x y z")).rejects.toThrow(/quota/i);
  });

  it("reads @handles from YouTube links", () => {
    expect(youtubeHandleOf("https://www.youtube.com/@AliFilms/videos")).toBe("@alifilms");
    expect(youtubeHandleOf("https://youtube.com/channel/UC123")).toBeNull();
  });
});
