/**
 * Acceptance: authentication, authorisation, tenant isolation and abuse controls (SEC-*), through the real API and the
 * database's row-level security. Limited to these checks: this is not a full security audit.
 */
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { resetTables } from "@mushin/db/testing";
import { sql } from "drizzle-orm";
import { createTestIssuer } from "../test-support/keys";
import { buildApi, db, evidence, externalAttempts, generousBuckets, owner, synthetic } from "./harness";

beforeEach(resetTables);
afterAll(() => expect(externalAttempts).toEqual([]));

describe("authentication (SEC)", () => {
  it("SEC-01 every customer endpoint refuses a request without a token", async () => {
    const api = await buildApi();
    const calls = await Promise.all([
      api.app.inject({ method: "POST", url: "/v1/search", payload: { text: "food", filters: {}, confirmedCost: 50 } }),
      api.app.inject({ method: "GET", url: "/v1/billing/summary" }),
      api.app.inject({ method: "POST", url: "/v1/discovery/estimates", payload: {} }),
      api.app.inject({ method: "GET", url: `/v1/creators/${randomUUID()}` }),
    ]);
    evidence("SEC-01", { statuses: calls.map((c) => c.statusCode) });
    expect(calls.every((c) => c.statusCode === 401)).toBe(true);
  });

  it("SEC-02 a token signed by another key (forged) is refused", async () => {
    const api = await buildApi();
    const other = await createTestIssuer();
    const r = await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: { authorization: `Bearer ${await other.sign({})}` } });
    evidence("SEC-02", { status: r.statusCode });
    expect(r.statusCode).toBe(401);
  });

  it("SEC-03 an expired token is refused", async () => {
    const api = await buildApi();
    const t = await api.iss.sign({ expiresIn: "1s" });
    await new Promise((r) => setTimeout(r, 1_500));
    const r = await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: { authorization: `Bearer ${t}` } });
    evidence("SEC-03", { status: r.statusCode });
    expect(r.statusCode).toBe(401);
  });

  it("SEC-04 a token from the right key but another project's issuer or audience is refused", async () => {
    const api = await buildApi();
    const wrongIss = await api.iss.sign({ issuer: "https://another-project.supabase.co/auth/v1" });
    const wrongAud = await api.iss.sign({ audience: "anon" });
    const a = await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: { authorization: `Bearer ${wrongIss}` } });
    const b = await api.app.inject({ method: "GET", url: "/v1/billing/summary", headers: { authorization: `Bearer ${wrongAud}` } });
    evidence("SEC-04", { wrongIssuer: a.statusCode, wrongAudience: b.statusCode });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
  });
});

describe("tenant isolation (SEC)", () => {
  it("SEC-05 naming another workspace in X-Workspace-Id is refused (403), never silently switched", async () => {
    const api = await buildApi();
    const a = await api.person();
    const b = await api.person();
    const r = await api.app.inject({ method: "GET", url: "/v1/me", headers: { ...a.headers, "x-workspace-id": b.workspaceId } });
    evidence("SEC-05", { status: r.statusCode, reason: r.json().error?.details?.reason });
    expect(r.statusCode).toBe(403);
    expect(r.json().error?.details?.reason).toBe("workspace_access_denied");
  });

  it("SEC-06 another workspace's discovery job, its results and its estimate are not found", async () => {
    const api = await buildApi();
    const a = await api.person();
    const b = await api.person();
    const { jobId, estimate } = await api.startLive(a.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 5);
    const job = await api.app.inject({ method: "GET", url: `/v1/discovery/jobs/${jobId}`, headers: b.headers });
    const results = await api.app.inject({ method: "GET", url: `/v1/discovery/jobs/${jobId}/results`, headers: b.headers });
    const start = await api.discovery.start(b.ctx, { kind: "live", estimateId: estimate.estimateId }).catch((e: { code: string }) => e.code);
    evidence("SEC-06", { job: job.statusCode, results: results.statusCode, startForeignEstimate: start });
    expect(job.statusCode).toBe(404);
    expect(results.statusCode).toBe(404);
    expect(start).toBe("NOT_FOUND");
  });

  it("SEC-07 row-level security: a tenant transaction cannot read or write another workspace's rows, even when asking by id", async () => {
    const api = await buildApi();
    const a = await api.person();
    const b = await api.person();
    await api.search(a.headers, "food lahore");
    const seen = await db.withTenant({ userId: b.sub, workspaceId: b.workspaceId }, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int n from wp.catalog_search_charges where workspace_id = ${a.workspaceId}`),
    );
    const lots = await db.withTenant({ userId: b.sub, workspaceId: b.workspaceId }, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from wp.credit_lots where workspace_id = ${a.workspaceId}`));
    const write = await db
      .withTenant({ userId: b.sub, workspaceId: b.workspaceId }, (tx) => tx.execute(sql`insert into wp.lists (workspace_id, name, created_by) values (${a.workspaceId}, 'intrusion', ${b.sub})`))
      .then(() => "inserted", (e: Error) => e.message.slice(0, 80));
    evidence("SEC-07", { chargesSeen: seen[0]?.n, lotsSeen: lots[0]?.n, crossWrite: write });
    expect(seen[0]?.n).toBe(0);
    expect(lots[0]?.n).toBe(0);
    expect(write).not.toBe("inserted");
  });

  it("SEC-08 an Idempotency-Key replays only its own person's response, never another workspace's", async () => {
    const api = await buildApi();
    const id = await synthetic({ name: "Idem", niches: ["Food"], contacts: [{ kind: "email", value: "idem@synthetic.invalid", trust: "verified", source: "bio" }] });
    const a = await api.person();
    const b = await api.person();
    const key = `shared-${randomUUID()}`;
    const ra = await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: { ...a.headers, "idempotency-key": key }, payload: { confirmedCost: 5 } });
    const rb = await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: { ...b.headers, "idempotency-key": key }, payload: { confirmedCost: 5 } });
    const bSpends = await owner<{ n: number }>(`select count(*)::int n from wp.credit_ledger where workspace_id = '${b.workspaceId}' and kind = 'spend'`);
    evidence("SEC-08", { a: ra.json().charged, b: rb.json().charged, bSpendRows: bSpends[0]?.n });
    expect(ra.json().charged).toBe(true);
    expect(rb.json().charged).toBe(true);
    expect(bSpends[0]?.n).toBe(1);
  });

  it("SEC-09 contact values appear only in a paid reveal response: never in search cards, profiles before reveal, or another workspace", async () => {
    const api = await buildApi();
    const id = await synthetic({ name: "Private contact", niches: ["Food"], bio: "food", contacts: [{ kind: "email", value: "secret@synthetic.invalid", trust: "verified", source: "bio" }] });
    const a = await api.person();
    const b = await api.person();
    const search = await api.search(a.headers, "food lahore");
    const profile = await api.app.inject({ method: "GET", url: `/v1/creators/${id}`, headers: a.headers });
    await api.app.inject({ method: "POST", url: `/v1/creators/${id}/reveal`, headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { confirmedCost: 5 } });
    const otherProfile = await api.app.inject({ method: "GET", url: `/v1/creators/${id}`, headers: b.headers });
    const stored = await owner<{ value_encrypted: string }>(`select value_encrypted from gcp.creator_contacts where creator_id = '${id}'`);
    evidence("SEC-09", { inSearch: search.body.includes("secret@"), inProfileBeforeReveal: profile.body.includes("secret@"), inOtherWorkspaceAfterReveal: otherProfile.body.includes("secret@"), storedEncrypted: !(stored[0]?.value_encrypted ?? "").includes("secret@") });
    expect(search.body).not.toContain("secret@");
    expect(profile.body).not.toContain("secret@");
    expect(otherProfile.body).not.toContain("secret@");
    expect(stored[0]?.value_encrypted).not.toContain("secret@");
  });
});

describe("abuse controls and safe failure (SEC)", () => {
  it("SEC-10 paid starts are rate-limited per person (quotes count too): the request after the limit gets 429 and holds nothing", async () => {
    const api = await buildApi({ buckets: { ...generousBuckets, jobs: { limit: 2, windowSeconds: 3600 } } });
    const a = await api.person();
    const est = async (city: string) => (await api.app.inject({ method: "POST", url: "/v1/discovery/estimates", headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { search: { text: "food vlogger", filters: { platform: "instagram", creatorCity: city } }, maxNew: 5 } })).json().estimateId as string;
    const e1 = await est("Lahore");
    const s1 = await api.app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { kind: "live", estimateId: e1 } });
    await api.discovery.cancel(a.ctx, s1.json().job.id);
    await api.live.run(s1.json().job.id, a.workspaceId);
    // Quote + start used the two paid-start slots; the next quote is refused before anything is held.
    const s2 = await api.app.inject({ method: "POST", url: "/v1/discovery/estimates", headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { search: { text: "food vlogger", filters: { platform: "instagram", creatorCity: "Karachi" } }, maxNew: 5 } });
    const holds = await owner<{ n: number }>(`select count(*)::int n from wp.credit_reservations where workspace_id = '${a.workspaceId}' and status = 'held'`);
    evidence("SEC-10", { first: s1.statusCode, second: s2.statusCode, retryAfter: s2.json().error?.details?.retryAfterSeconds, heldAfter: holds[0]?.n });
    expect(s1.statusCode).toBe(202);
    expect(s2.statusCode).toBe(429);
    expect(holds[0]?.n).toBe(0);
  });

  it("SEC-11 malformed JSON, oversized bodies and malformed profile links fail with clean errors (no stack, no SQL)", async () => {
    const api = await buildApi();
    const a = await api.person();
    const badJson = await api.app.inject({ method: "POST", url: "/v1/search", headers: { ...a.headers, "content-type": "application/json" }, payload: "{not json" });
    const huge = await api.app.inject({ method: "POST", url: "/v1/search", headers: { ...a.headers, "content-type": "application/json" }, payload: JSON.stringify({ text: "a", filters: {}, confirmedCost: 50, pad: "x".repeat(1_100_000) }) });
    const badLink = await api.app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { kind: "add_by_url", url: "javascript:alert(1)", confirmedCost: 50 } });
    const ssrf = await api.app.inject({ method: "POST", url: "/v1/discovery/jobs", headers: { ...a.headers, "idempotency-key": randomUUID() }, payload: { kind: "add_by_url", url: "http://169.254.169.254/latest/meta-data/", confirmedCost: 50 } });
    const bodies = [badJson, huge, badLink, ssrf].map((r) => r.body);
    evidence("SEC-11", { statuses: [badJson.statusCode, huge.statusCode, badLink.statusCode, ssrf.statusCode], leaks: bodies.filter((b) => /at \w+ \(|select |stack|postgres/i.test(b)).length });
    expect(badJson.statusCode).toBe(400);
    expect(huge.statusCode).toBe(413);
    expect(badLink.statusCode).toBe(400);
    expect(ssrf.statusCode).toBe(400);
    expect(bodies.filter((b) => /at \w+ \(|select |stack|postgres/i.test(b))).toEqual([]);
  });

  it("SEC-12 logs redact tokens, secrets and contact details", async () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const log = createLogger({ level: "info" }, sink);
    log.info({ req: { headers: { authorization: "Bearer eyJhbGciOi.secret.token", cookie: "sb=abc" } }, email: "person@example.org", apiKey: "sk_live_123", password: "hunter2", token: "tok_abc" }, "request");
    log.info({ err: new Error("connect failed postgres://user:pa55@db.example.org:5432/x") }, "db error");
    const out = lines.join("\n");
    evidence("SEC-12", { output: out.slice(0, 600) });
    for (const secret of ["eyJhbGciOi.secret.token", "sb=abc", "sk_live_123", "hunter2", "tok_abc", "pa55", "person@example.org"]) expect(out).not.toContain(secret);
  });
});
