import { describe, expect, it } from "vitest";
import type { DiscoveryJob } from "@mushin/contracts";
import { isOpenJob, jobStatusText, jobTitle, newlyFinished } from "./discovery-mapping";
import { creatorStub } from "./search-mapping";

const job = (over: Partial<DiscoveryJob> = {}): DiscoveryJob => ({
  id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
  kind: "add_by_url",
  status: "running",
  step: "assessing",
  outcome: null,
  creatorId: null,
  platform: "instagram",
  handle: "coke_studio",
  error: null,
  createdAt: "2026-10-09T10:00:00.000Z",
  finishedAt: null,
  ...over,
});

describe("job wording", () => {
  it("names the job and its current step", () => {
    expect(jobTitle(job())).toBe("Adding @coke_studio");
    expect(jobTitle(job({ kind: "refresh" }))).toBe("Refreshing @coke_studio");
    expect(jobStatusText(job())).toBe("Assessing authenticity and audience…");
    expect(jobStatusText(job({ status: "queued", step: null }))).toBe("Waiting to start…");
  });

  it("explains outcomes, always saying when credits came back", () => {
    expect(jobStatusText(job({ status: "completed", outcome: "created" }))).toBe("Added to MUSHIN");
    expect(jobStatusText(job({ status: "completed", outcome: "refreshed" }))).toBe("Profile updated");
    expect(jobStatusText(job({ status: "completed", outcome: "reused" }))).toBe("Fresh data was already available. Your credits were returned.");
    expect(jobStatusText(job({ status: "failed", error: { code: "PRIVATE_ACCOUNT", message: "This account is private, so we can't assess it." } }))).toBe(
      "This account is private, so we can't assess it. Your credits were returned.",
    );
    expect(jobStatusText(job({ status: "failed", error: { code: "TIMED_OUT", message: "This took too long and was stopped. Your credits were returned." } }))).toBe(
      "This took too long and was stopped. Your credits were returned.",
    );
  });

  it("finds jobs that just finished", () => {
    const a = job();
    const b = job({ id: "7f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10" });
    expect(isOpenJob(a)).toBe(true);
    expect(newlyFinished([a, b], [{ ...a, status: "completed", outcome: "created" }, b]).map((j) => j.id)).toEqual([a.id]);
    expect(newlyFinished([], [{ ...a, status: "completed", outcome: "created" }])).toEqual([]);
  });

  it("builds a profile-panel stub for a creator known only by id", () => {
    expect(creatorStub(job().id, "tiktok", "cokestudiopakistan")).toMatchObject({ id: job().id, platform: "tiktok", handle: "cokestudiopakistan", name: "@cokestudiopakistan" });
  });
});
