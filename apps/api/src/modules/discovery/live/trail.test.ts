import { describe, expect, it } from "vitest";
import { createTrail, type SearchGroup } from "./trail";

const group = (platform: SearchGroup["platform"], query: string, links: string[], round = 1): SearchGroup => ({
  platform, query, round, results: links.map((link, i) => ({ title: `Result ${i} call 0300-1234567`, link, snippet: "Food creator" })),
});

describe("candidate decision trail", () => {
  it("records every result link once, with normalization outcome, origin and duplicate count", () => {
    const t = createTrail({ workspaceId: "w", jobId: "j" });
    const groups = [
      group("instagram", "site:instagram.com food karachi", ["https://www.instagram.com/sana/", "https://www.instagram.com/p/C1x2/", "https://www.tiktok.com/@sana"]),
      group("instagram", "site:instagram.com food blogger karachi", ["https://instagram.com/sana?hl=en", "https://instagram.com/bilal"]),
    ];
    t.observe(groups);
    t.observe(groups); // a later round re-observes everything seen so far
    const rows = new Map(t.all().map((r) => [r.candidateKey, r]));
    expect(rows.size).toBe(4);
    expect(rows.get("https://instagram.com/sana")).toMatchObject({ stage: "dedupe", decision: "pending", occurrences: 2, query: "site:instagram.com food karachi", position: 1, handle: "sana" });
    expect(rows.get("https://www.instagram.com/p/C1x2/")).toMatchObject({ stage: "normalization", decision: "rejected", reason: "non_profile_url" });
    expect(rows.get("https://www.tiktok.com/@sana")).toMatchObject({ stage: "normalization", decision: "rejected", reason: "wrong_platform" });
    expect(JSON.stringify(t.all())).not.toContain("0300-1234567");
  });

  it("separates insufficient evidence from account and campaign rejections", () => {
    const t = createTrail({ workspaceId: "w", jobId: "j" });
    t.observe([group("youtube", "q", ["https://youtube.com/@a", "https://youtube.com/@b", "https://youtube.com/@c", "https://youtube.com/@d"])]);
    const fit = (gate: string | null, eligible = false) => ({ eligible, gate, score: eligible ? 80 : 0, topicScore: 1, evidence: ["x"] });
    t.fit("https://youtube.com/@a", fit("individual_creator_unverified"));
    t.fit("https://youtube.com/@b", fit("location_mismatch"));
    t.fit("https://youtube.com/@c", fit("off_topic"));
    t.fit("https://youtube.com/@d", fit(null, true), "creator-d");
    const rows = new Map(t.all().map((r) => [r.candidateKey, r]));
    expect(rows.get("https://youtube.com/@a")).toMatchObject({ stage: "verification", decision: "unverified", reason: "individual_creator_unverified" });
    expect(rows.get("https://youtube.com/@b")).toMatchObject({ stage: "verification", decision: "rejected", reason: "location_mismatch" });
    expect(rows.get("https://youtube.com/@c")).toMatchObject({ stage: "fit", decision: "rejected", reason: "off_topic" });
    expect(rows.get("https://youtube.com/@d")).toMatchObject({ stage: "fit", decision: "pending", reason: "eligible", creatorId: "creator-d" });
  });

  it("leaves no candidate pending once finished and drains each change once", () => {
    const t = createTrail({ workspaceId: "w", jobId: "j" });
    t.observe([group("tiktok", "q", ["https://tiktok.com/@a", "https://tiktok.com/@b"])]);
    expect(t.drain()).toHaveLength(2);
    expect(t.drain()).toHaveLength(0);
    t.set("https://tiktok.com/@a", "delivery", "delivered", "new_creator");
    t.finish("skipped", "not_processed");
    expect(t.pendingKeys()).toEqual([]);
    expect(t.drain().map((r) => [r.candidateKey, r.decision, r.reason])).toEqual([
      ["https://tiktok.com/@a", "delivered", "new_creator"],
      ["https://tiktok.com/@b", "skipped", "not_processed"],
    ]);
  });
});
