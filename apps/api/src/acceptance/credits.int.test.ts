/**
 * Acceptance: credit accounting (CR-*). Pricing oracle = platform.credit_action_costs in the database (search_existing 50,
 * find_new 50, live_creator 10, refresh_data 50, reveal_contact 5). Every check reads balances and ledger rows from the
 * database; API messages are never taken as proof.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetTables } from "@mushin/db/testing";
import { FixtureScraper, ProviderError } from "@mushin/integrations";
import { buildApi, db, evidence, externalAttempts, ledgerMismatches, owner, synthetic, webFor } from "./harness";

beforeEach(resetTables);
afterAll(() => expect(externalAttempts).toEqual([]));
type Api = Awaited<ReturnType<typeof buildApi>>;

/** Authoritative balance: unexpired lot credits (available + held) and held reservations, straight from the tables. */
async function truth(workspaceId: string) {
  const [r] = await owner<{ remaining: number; held: number }>(`
    select coalesce((select sum(remaining) from wp.credit_lots where workspace_id = '${workspaceId}' and (expires_at is null or expires_at > now())), 0)::int remaining,
           coalesce((select sum(amount) from wp.credit_reservations where workspace_id = '${workspaceId}' and status = 'held'), 0)::int held`);
  return r ?? { remaining: 0, held: 0 };
}
const spends = async (workspaceId: string) => (await owner<{ n: number; total: number }>(`select count(*)::int n, coalesce(-sum(amount), 0)::int total from wp.credit_ledger where workspace_id = '${workspaceId}' and kind = 'spend'`))[0];
async function topUp(api: Api, workspaceId: string, amount: number) {
  await db.withWorkspace(workspaceId, (tx) => api.billing.engine.grant(tx, workspaceId, { source: "adjustment", amount, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `acc-${randomUUID()}`, note: "Acceptance credits" }));
}
/** Sets a workspace's spendable credits to exactly `n` (one lot), for boundary tests. */
async function exactly(workspaceId: string, n: number) {
  await owner(`update wp.credit_lots set remaining = 0 where workspace_id = '${workspaceId}'`);
  await owner(`update wp.credit_lots set remaining = ${n} where id = (select id from wp.credit_lots where workspace_id = '${workspaceId}' and amount >= ${n} order by created_at limit 1)`);
}

describe("catalogue search charging (CR)", () => {
  it("CR-01 a catalogue search charges 50 credits once, with one ledger spend row; balance equals the tables", async () => {
    const api = await buildApi();
    await synthetic({ name: "Food A", niches: ["Food"], bio: "food" });
    const u = await api.person();
    const before = await truth(u.workspaceId);
    const r = (await api.search(u.headers, "food lahore")).json();
    const after = await truth(u.workspaceId);
    const summary = await api.balance(u.ctx);
    evidence("CR-01", { response: { charged: r.charged, creditsCharged: r.creditsCharged }, before, after, summary, spends: await spends(u.workspaceId) });
    expect(r).toMatchObject({ charged: true, creditsCharged: 50 });
    expect(before.remaining - after.remaining).toBe(50);
    expect(await spends(u.workspaceId)).toEqual({ n: 1, total: 50 });
    expect(summary.available).toBe(after.remaining - after.held);
  });

  it("CR-02 an exact repeat (case and spacing differ) inside 30 minutes is free; the next page is free", async () => {
    const api = await buildApi();
    const u = await api.person();
    await api.search(u.headers, "food lahore");
    const b = (await api.search(u.headers, "  FOOD   Lahore ")).json();
    evidence("CR-02", { repeat: { charged: b.charged, credits: b.creditsCharged }, spends: await spends(u.workspaceId) });
    expect(b).toMatchObject({ charged: false, creditsCharged: 0 });
    expect((await spends(u.workspaceId))?.n).toBe(1);
  });

  it("CR-03 the same search after the 30-minute window is a new search and is charged again", async () => {
    let clock = Date.now();
    const api = await buildApi({ now: () => new Date(clock) });
    const u = await api.person();
    await api.search(u.headers, "food lahore");
    clock += 29 * 60_000;
    const inside = (await api.search(u.headers, "food lahore")).json();
    clock += 2 * 60_000;
    const outside = (await api.search(u.headers, "food lahore")).json();
    evidence("CR-03", { at29min: inside.creditsCharged, at31min: outside.creditsCharged, spends: await spends(u.workspaceId) });
    expect(inside.creditsCharged).toBe(0);
    expect(outside.creditsCharged).toBe(50);
  });

  it("CR-04 equivalent wording is a different logical search under the pricing contract and is charged", async () => {
    const api = await buildApi();
    const u = await api.person();
    await api.search(u.headers, "food vloggers in lahore");
    const b = (await api.search(u.headers, "food bloggers in lahore")).json();
    evidence("CR-04", { second: b.creditsCharged });
    expect(b.creditsCharged).toBe(50);
  });

  it("CR-05 the same text with a different effective filter is charged as a new search", async () => {
    const api = await buildApi();
    const u = await api.person();
    await api.search(u.headers, "food lahore");
    const b = (await api.search(u.headers, "food lahore", { platform: "youtube" })).json();
    evidence("CR-05", { second: b.creditsCharged });
    expect(b.creditsCharged).toBe(50);
  });

  it("CR-06 a zero-result search is charged under the current rule (owner decision D-05 still open)", async () => {
    const api = await buildApi();
    const u = await api.person();
    const r = (await api.search(u.headers, "nothingmatchesthisword")).json();
    evidence("CR-06", { results: r.results.length, charged: r.creditsCharged, decision: "D-05 open" });
    expect(r.results).toEqual([]);
    expect(r.creditsCharged).toBe(50);
  });

  it("CR-07 an insufficient balance refuses the search: no results returned, nothing charged, never negative", async () => {
    const api = await buildApi();
    await synthetic({ name: "Food B", niches: ["Food"], bio: "food" });
    const u = await api.person();
    await exactly(u.workspaceId, 40);
    const r = await api.search(u.headers, "food lahore");
    const after = await truth(u.workspaceId);
    evidence("CR-07", { status: r.statusCode, code: r.json().error?.code, after });
    expect(r.statusCode).toBe(402);
    expect(r.json().results).toBeUndefined();
    expect(after.remaining).toBe(40);
    expect(await spends(u.workspaceId)).toEqual({ n: 0, total: 0 });
  });

  it("CR-08 a stale confirmed price is refused and nothing is charged; a price change applies to the next confirmation", async () => {
    const api = await buildApi();
    const u = await api.person();
    try {
      await owner(`update platform.credit_action_costs set credits = 60 where action = 'search_existing'`);
      const stale = await api.search(u.headers, "food lahore", {}, { confirmedCost: 50 });
      const fresh = await api.search(u.headers, "food lahore", {}, { confirmedCost: 60 });
      evidence("CR-08", { stale: [stale.statusCode, stale.json().error?.code], fresh: fresh.json().creditsCharged });
      expect(stale.statusCode).toBe(409);
      expect(fresh.json().creditsCharged).toBe(60);
      expect(await spends(u.workspaceId)).toEqual({ n: 1, total: 60 });
    } finally {
      await owner(`update platform.credit_action_costs set credits = 50 where action = 'search_existing'`);
    }
  });

  it("CR-09 ten simultaneous identical searches are charged exactly once", async () => {
    const api = await buildApi();
    const u = await api.person();
    const out = await Promise.all(Array.from({ length: 10 }, () => api.search(u.headers, "food lahore")));
    evidence("CR-09", { statuses: out.map((o) => o.statusCode), charged: out.map((o) => o.json().creditsCharged), spends: await spends(u.workspaceId) });
    expect(out.every((o) => o.statusCode === 200)).toBe(true);
    expect(out.filter((o) => o.json().charged)).toHaveLength(1);
    expect(await spends(u.workspaceId)).toEqual({ n: 1, total: 50 });
  });

  it("CR-10 two different searches racing for the last 50 credits: exactly one succeeds, the balance never goes negative", async () => {
    const api = await buildApi();
    const u = await api.person();
    await exactly(u.workspaceId, 50);
    const out = await Promise.all(["food lahore", "fashion karachi", "tech islamabad"].map((t) => api.search(u.headers, t)));
    const after = await truth(u.workspaceId);
    evidence("CR-10", { statuses: out.map((o) => o.statusCode), after });
    expect(out.filter((o) => o.statusCode === 200)).toHaveLength(1);
    expect(out.filter((o) => o.statusCode === 402)).toHaveLength(2);
    expect(after.remaining).toBe(0);
  });
});

describe("live discovery and reservation accounting (CR)", () => {
  const live = { platform: "instagram", creatorCity: "Lahore" };
  const handles = Array.from({ length: 8 }, (_, i) => `cr_food_${i + 1}`);

  it("CR-11 five simultaneous confirmations of one estimate create one job and one reservation", async () => {
    const api = await buildApi();
    const u = await api.person();
    await topUp(api, u.workspaceId, 1_000);
    const e = await api.discovery.createEstimate(u.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, ...live } as never }, maxNew: 10 });
    const out = await Promise.allSettled(Array.from({ length: 5 }, () => api.discovery.start(u.ctx, { kind: "live", estimateId: e.estimateId })));
    const jobs = await owner<{ n: number }>(`select count(*)::int n from wp.discovery_jobs where workspace_id = '${u.workspaceId}'`);
    const holds = await owner<{ n: number; amount: number }>(`select count(*)::int n, coalesce(sum(amount),0)::int amount from wp.credit_reservations where workspace_id = '${u.workspaceId}'`);
    evidence("CR-11", { settled: out.map((o) => o.status), jobs: jobs[0]?.n, holds: holds[0] });
    expect(jobs[0]?.n).toBe(1);
    expect(holds[0]).toEqual({ n: 1, amount: 150 });
  });

  it("CR-12 a successful run's ledger: one hold, one spend of base + new creators, the rest released; lots and ledger agree", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => handles) } });
    const u = await api.person();
    await topUp(api, u.workspaceId, 1_000);
    const before = await truth(u.workspaceId);
    const { jobId } = await api.startLive(u.ctx, "food vlogger", live, 10);
    await api.live.run(jobId, u.workspaceId);
    const job = await api.discovery.get(u.ctx, jobId);
    const rows = await owner<{ kind: string; total: number }>(`select kind, sum(amount)::int total from wp.credit_ledger where workspace_id = '${u.workspaceId}' and reservation_id is not null group by 1 order by 1`);
    const after = await truth(u.workspaceId);
    evidence("CR-12", { charged: job.live?.creditsCharged, delivered: job.live?.new, ledger: rows, before, after });
    expect(job.live?.creditsCharged).toBe(50 + (job.live?.new ?? 0) * 10);
    expect(before.remaining - after.remaining).toBe(job.live?.creditsCharged);
    expect(after.held).toBe(0);
    expect(await ledgerMismatches(api.billing, u.workspaceId)).toEqual([]);
  });

  it("CR-13 a provider failure returns the whole hold: ledger nets to zero for the run", async () => {
    const web = webFor(() => {
      throw new ProviderError(true, "provider", "HTTP 500");
    });
    const api = await buildApi({ fixtures: { web } });
    const u = await api.person();
    await topUp(api, u.workspaceId, 1_000);
    const before = await truth(u.workspaceId);
    const { jobId } = await api.startLive(u.ctx, "food vlogger", live, 10);
    for (let i = 0; i < 3; i++) await api.live.run(jobId, u.workspaceId).catch(() => undefined);
    const job = await api.discovery.get(u.ctx, jobId);
    const after = await truth(u.workspaceId);
    evidence("CR-13", { status: job.status, before, after });
    expect(job.status).toBe("failed");
    expect(after).toEqual(before);
  });

  it("CR-14 a worker that dies after the reservation leaves a stuck job; the sweep fails it and returns the credits", async () => {
    const api = await buildApi();
    const u = await api.person();
    await topUp(api, u.workspaceId, 1_000);
    const before = await truth(u.workspaceId);
    const { jobId } = await api.startLive(u.ctx, "food vlogger", live, 10);
    await owner(`update wp.discovery_jobs set status = 'running', created_at = now() - interval '2 hours' where id = '${jobId}'`);
    const swept = await api.profileRunner.sweepStuck();
    const job = await api.discovery.get(u.ctx, jobId);
    const after = await truth(u.workspaceId);
    evidence("CR-14", { swept, status: job.status, error: job.error, before, after });
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(job.status).toBe("failed");
    expect(after).toEqual(before);
  });

  it("CR-15 an abandoned reservation (not renewed past its expiry) is released by the cleanup", async () => {
    const api = await buildApi();
    const u = await api.person();
    const held = await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.reserve(tx, u.workspaceId, { action: "refresh_data", confirmedCost: 50, refType: "discovery_job", refId: randomUUID() }, { userId: u.sub, requestId: null }));
    const mid = await truth(u.workspaceId);
    await owner(`update wp.credit_reservations set expires_at = now() - interval '1 minute' where id = '${held.reservationId}'`);
    const released = await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.releaseAbandoned(tx, u.workspaceId));
    const after = await truth(u.workspaceId);
    const [r] = await owner<{ status: string }>(`select status from wp.credit_reservations where id = '${held.reservationId}'`);
    evidence("CR-15", { heldBefore: mid.held, released, status: r?.status, after });
    expect(mid.held).toBe(50);
    expect(released).toBe(1);
    expect(r?.status).toBe("expired");
    expect(after.held).toBe(0);
  });

  it("CR-16 settling the same reservation twice charges once (the duplicate settlement is refused or has no effect)", async () => {
    const api = await buildApi();
    const u = await api.person();
    const held = await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.reserveAmount(tx, u.workspaceId, { action: "find_new", amount: 100, confirmedCost: 100, refType: "discovery_job", refId: randomUUID() }, { userId: u.sub, requestId: null }));
    const before = await truth(u.workspaceId);
    await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.commitPartial(tx, u.workspaceId, held.reservationId, 60, { userId: u.sub, requestId: null }, "first settlement"));
    const second = await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.commitPartial(tx, u.workspaceId, held.reservationId, 60, { userId: u.sub, requestId: null }, "duplicate settlement")).then(() => "accepted", (e: { code?: string }) => e.code);
    const after = await truth(u.workspaceId);
    evidence("CR-16", { second, before, after, spends: await spends(u.workspaceId) });
    expect(["CONFLICT", "accepted"]).toContain(second);
    expect(before.remaining - after.remaining).toBe(60);
    expect(after.held).toBe(0);
    expect(await spends(u.workspaceId)).toEqual({ n: 1, total: 60 });
  });

  it("CR-17 only one live run per workspace at a time; the second brief holds nothing", async () => {
    const api = await buildApi();
    const u = await api.person();
    await topUp(api, u.workspaceId, 1_000);
    await api.startLive(u.ctx, "food vlogger", live, 5);
    const second = await api.startLive(u.ctx, "fashion stylist", { platform: "instagram", creatorCity: "Karachi" }, 5).catch((e: { code?: string; details?: { reason?: string } }) => `${e.code}:${e.details?.reason}`);
    const holds = await owner<{ n: number }>(`select count(*)::int n from wp.credit_reservations where workspace_id = '${u.workspaceId}' and status = 'held'`);
    evidence("CR-17", { second, heldReservations: holds[0]?.n });
    expect(second).toBe("CONFLICT:live_run_in_progress");
    expect(holds[0]?.n).toBe(1);
  });
});

describe("reveal and add-by-link charging (CR)", () => {
  it("CR-18 a contact reveal costs 5 once; a replayed Idempotency-Key and a second reveal are free", async () => {
    const api = await buildApi();
    const id = await synthetic({ name: "Reveal", niches: ["Food"], contacts: [{ kind: "email", value: "reveal@synthetic.invalid", trust: "verified", source: "bio" }] });
    const u = await api.person();
    const key = { ...u.headers, "idempotency-key": `rv-${randomUUID()}` };
    const a = await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: key, payload: { confirmedCost: 5 } });
    const replay = await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: key, payload: { confirmedCost: 5 } });
    const again = await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: { ...u.headers, "idempotency-key": `rv-${randomUUID()}` }, payload: { confirmedCost: 5 } });
    evidence("CR-18", { first: a.json().charged, replaySame: replay.body === a.body, second: again.json().charged, spends: await spends(u.workspaceId) });
    expect(a.json()).toMatchObject({ charged: true });
    expect(replay.json()).toEqual(a.json());
    expect(again.json()).toMatchObject({ charged: false });
    expect(await spends(u.workspaceId)).toEqual({ n: 1, total: 5 });
  });

  it("CR-19 add-by-link holds 50, charges 50 when the profile is saved, and returns everything when the provider is not configured", async () => {
    const ok = await buildApi();
    const u = await ok.person();
    const before = await truth(u.workspaceId);
    const start = await ok.app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...u.headers, "idempotency-key": `ab-${randomUUID()}` }, payload: { kind: "add_by_url", url: "https://www.instagram.com/cr_link_ok/", confirmedCost: 50 } });
    const jobId = start.json().job?.id as string;
    await ok.profileRunner.run(jobId, u.workspaceId);
    const okAfter = await truth(u.workspaceId);

    const failing = await buildApi({ fixtures: { scraper: new FixtureScraper({ instagram: new ProviderError(false, "not_configured", "APIFY_TOKEN is not set") }) } });
    const v = await failing.person();
    const vBefore = await truth(v.workspaceId);
    const s2 = await failing.app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...v.headers, "idempotency-key": `ab-${randomUUID()}` }, payload: { kind: "add_by_url", url: "https://www.instagram.com/cr_link_fail/", confirmedCost: 50 } });
    await failing.profileRunner.run(s2.json().job?.id as string, v.workspaceId).catch(() => undefined);
    const vAfter = await truth(v.workspaceId);
    evidence("CR-19", { startStatus: start.statusCode, okCharged: before.remaining - okAfter.remaining, okHeld: okAfter.held, failStatus: s2.statusCode, failDelta: vBefore.remaining - vAfter.remaining, failHeld: vAfter.held });
    expect(start.statusCode).toBe(202);
    expect(before.remaining - okAfter.remaining).toBe(50);
    expect(okAfter.held).toBe(0);
    expect(vAfter).toEqual(vBefore);
  });

  it("CR-20 the balance shown to the customer equals the tables after a mixed sequence of operations", async () => {
    const api = await buildApi();
    const id = await synthetic({ name: "Mixed", niches: ["Food"], bio: "food", contacts: [{ kind: "email", value: "mixed@synthetic.invalid", trust: "verified", source: "bio" }] });
    const u = await api.person();
    await topUp(api, u.workspaceId, 500);
    await api.search(u.headers, "food lahore");
    await api.search(u.headers, "food karachi");
    await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: { ...u.headers, "idempotency-key": `m-${randomUUID()}` }, payload: { confirmedCost: 5 } });
    const shown = (await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: u.headers })).json() as { balance: { available: number; reserved: number } };
    const t = await truth(u.workspaceId);
    evidence("CR-20", { shown: shown.balance, tables: t, mismatches: await ledgerMismatches(api.billing, u.workspaceId) });
    expect(shown.balance.available).toBe(t.remaining - t.held);
    expect(shown.balance.reserved).toBe(t.held);
    expect(await ledgerMismatches(api.billing, u.workspaceId)).toEqual([]);
  });

  it("CR-21 a member of one workspace cannot read or spend another workspace's credits", async () => {
    const api = await buildApi();
    const a = await api.person();
    const b = await api.person();
    const read = await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: { ...a.headers, "x-workspace-id": b.workspaceId } });
    const spend = await api.app.inject({ method: "POST", url: "/v1/search", headers: { ...a.headers, "x-workspace-id": b.workspaceId }, payload: { text: "food", filters: {}, confirmedCost: 50 } });
    const bAfter = await truth(b.workspaceId);
    evidence("CR-21", { read: read.statusCode, spend: spend.statusCode, bAfter });
    expect(read.statusCode).toBe(403);
    expect(spend.statusCode).toBe(403);
    expect(await spends(b.workspaceId)).toEqual({ n: 0, total: 0 });
  });
});
