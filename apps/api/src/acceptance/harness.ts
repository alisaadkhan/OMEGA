/**
 * Acceptance campaign harness (final Search acceptance mandate, 2026-10-20). Builds the real API (Fastify app with the
 * production modules) against the disposable test database, with deterministic provider fixtures only:
 *   - no paid provider can be reached: provider adapters are fixtures, and `installNetworkGuard` refuses any request to a
 *     host other than localhost and records the attempt, so a test can prove nothing left the machine;
 *   - every synthetic creator is labelled SYNTHETIC in its display name and never enters official quality metrics.
 * Only public module entry points (index.ts) are used, so the campaign exercises what production wires together.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchFiltersSchema, type LiveRunSize } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { createTestDatabase, ownerQuery } from "@mushin/db/testing";
import { FixtureScraper, FixtureWebSearch, MemoryStorage, MockLlm, MockPayments, scraperFixture, UnavailableSearchIndex, type ScrapeRequest, type WebQuery, type WebResult } from "@mushin/integrations";
import { createCustomerGuard } from "../auth/customer-guard";
import { createCustomerTokenVerifier } from "../auth/customer-token";
import { MemoryRateLimiter } from "../rate-limit/memory";
import type { RateLimitBuckets } from "../rate-limit/types";
import { buildTestApp } from "../test-support/app";
import { createTestIssuer } from "../test-support/keys";
import { createBillingModule, createBillingService, MemoryAccessCache } from "../modules/billing/index";
import { createCreatorIndexer, createCreatorsModule, createCreatorsService, createEnrichmentPipeline, createPostgresCatalogSearch, insertCreator, type NewCreator, type NewProfile } from "../modules/creators/index";
import { createCachedSearch, createDiscoveryModule, createDiscoveryRunner, createDiscoveryService, createLiveRunner } from "../modules/discovery/index";
import { createIdentityModule } from "../modules/identity/index";
import { createPlatformModule } from "../modules/platform/index";

export const db: Db = createTestDatabase();
export const logger = createLogger({ level: "silent" });
export const KEY = Buffer.alloc(32, 7);
export const indexer = createCreatorIndexer({ db, index: null, logger });

const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/completion/acceptance-evidence/records");

/**
 * Writes the structured evidence for one test id (inputs, parsed filters, results, balances, timings). Only with
 * ACCEPTANCE_EVIDENCE=1, so an ordinary `npm run verify` never rewrites the committed campaign evidence.
 */
export function evidence(id: string, data: unknown): void {
  if (process.env["ACCEPTANCE_EVIDENCE"] !== "1") return;
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${id}.json`), `${JSON.stringify({ id, recordedAt: new Date().toISOString(), data }, null, 1)}\n`);
}

// ── Network guard ─────────────────────────────────────────────────────────────────────────────────────────────────
export const externalAttempts: string[] = [];
let guarded = false;
/** Any fetch to a non-local host fails and is recorded; localhost (JWKS fixtures, local services) still works. */
export function installNetworkGuard(): void {
  if (guarded) return;
  guarded = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
      externalAttempts.push(url.hostname);
      throw new Error(`acceptance network guard: external request to ${url.hostname} refused`);
    }
    return real(input, init);
  }) as typeof fetch;
}

// ── Synthetic catalogue ──────────────────────────────────────────────────────────────────────────────────────────
export type Synthetic = { name: string; platform?: "instagram" | "tiktok" | "youtube"; handle?: string; city?: string | null; niches?: string[]; bio?: string; followers?: number | null; engagement?: number | null; contacts?: NewCreator["contacts"]; isMinor?: boolean; extraProfiles?: Partial<NewProfile>[]; updatedAt?: Date };

/** Inserts a SYNTHETIC creator and indexes it as the worker would. Returns its id. */
export async function synthetic(s: Synthetic, o: { index?: boolean } = {}): Promise<string> {
  const handle = (s.handle ?? `syn_${randomUUID().slice(0, 8)}`).toLowerCase();
  const platform = s.platform ?? "instagram";
  const creator: NewCreator = {
    displayName: `SYNTHETIC ${s.name}`,
    primaryHandle: handle,
    primaryPlatform: platform,
    city: s.city === undefined ? "Lahore" : s.city,
    country: "PK",
    niches: s.niches ?? [],
    tags: [],
    ...(s.isMinor ? { isMinor: true } : {}),
    ...(s.contacts ? { contacts: s.contacts } : {}),
    profiles: [
      { platform, handle, followers: s.followers === undefined ? 50_000 : s.followers, engagementRate: s.engagement === undefined ? 4 : s.engagement, bio: s.bio ?? "", ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}) },
      ...(s.extraProfiles ?? []).map((p) => ({ platform: "tiktok" as const, handle: `${handle}_tt`, followers: 40_000, engagementRate: 4, bio: s.bio ?? "", ...p })),
    ],
  };
  const id = await db.withSystem((tx) => insertCreator(tx, creator, KEY));
  if (o.index !== false) await indexer.sync([id]);
  return id;
}

// ── App ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const big = { limit: 100_000, windowSeconds: 60 };
export const generousBuckets: RateLimitBuckets = { ip: big, user: big, auth: big, ai: big, jobs: { limit: 100_000, windowSeconds: 3600 }, workspaceJobs: { limit: 100_000, windowSeconds: 3600 }, callback: big };

/** A fixture creator profile in Apify's Instagram shape, with recent dated posts (eligibility needs activity). */
export function igProfile(username: string, bio: string, followers = 50_000): Record<string, unknown>[] {
  const one = structuredClone((scraperFixture("instagram-profile.json") as Record<string, unknown>[])[0] ?? {});
  const posts = Array.isArray(one["latestPosts"]) ? one["latestPosts"] : [];
  // Post hashtags follow the bio's topic, so topic evidence comes only from what the fixture says.
  const tags = /food|khana/i.test(bio) ? ["food", "lahore"] : bio.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).slice(0, 2);
  one["latestPosts"] = posts.map((post, i) =>
    typeof post === "object" && post !== null ? { ...(post as Record<string, unknown>), caption: bio, hashtags: tags, timestamp: new Date(Date.now() - i * 5 * 86_400_000).toISOString() } : post,
  );
  return [{ ...one, username, biography: bio, followersCount: followers }];
}

/** Assessment replies valid for whatever range was measured; relevance keeps every candidate unless `drop` says so. */
export function fixtureLlm(o: { drop?: (line: string) => boolean } = {}): MockLlm {
  return new MockLlm((req) => {
    if (req.feature === "discovery_relevance") {
      const lines = req.input.split("\n").filter((l) => /^\d+\. /.test(l));
      return { keep: lines.map((l, i) => ({ i, l })).filter((x) => !(o.drop?.(x.l) ?? false)).map((x) => ({ i: x.i, reason: "Food creator in the requested city" })) };
    }
    const m = /Range: (\d+)–(\d+)/.exec(req.input);
    const score = m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
    const signal = /^(\w+) \(/m.exec(req.input.split("<signals>")[1] ?? "")?.[1] ?? "engagement_vs_tier";
    return {
      verdict: score === null ? null : score >= 60 ? "mostly genuine" : "mixed signals",
      score,
      evidence: score === null ? [] : [{ signal, detail: "Measured from recent posts." }],
      watchOuts: [],
      audience: { age: [], gender: null, cities: [], countries: [] },
      niches: [],
      creatorCity: null,
      creatorCountry: null,
      minorSigns: { likely: false, reason: "" },
    };
  });
}

export type Fixtures = { web: FixtureWebSearch; scraper: FixtureScraper; llm: MockLlm };

/** Web results: the given handles (padded to the 8-candidate pool) as Instagram links with a food/city snippet. */
export function webFor(byQuery: (q: WebQuery) => string[], city = "Lahore"): FixtureWebSearch {
  return new FixtureWebSearch((q: WebQuery): WebResult[] =>
    byQuery(q).map((h) => ({ title: `${h} | Food vlogger`, link: `https://www.instagram.com/${h}/`, snippet: `Food reviews and street food, ${city}` })),
  );
}

export function scraperFor(bioOf: (handle: string) => string | null, followersOf: (handle: string) => number = () => 50_000): FixtureScraper {
  return new FixtureScraper({
    instagram: (req: ScrapeRequest) => {
      const bio = bioOf(req.handle);
      return bio === null ? { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 } : { provider: "apify", raw: igProfile(req.handle, bio, followersOf(req.handle)), costUsd: 0.0026 };
    },
  });
}

export async function buildApi(o: { fixtures?: Partial<Fixtures>; buckets?: RateLimitBuckets; now?: () => Date } = {}) {
  installNetworkGuard();
  const payments = new MockPayments({ webhookSecret: "h".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
  const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger, ...(o.now ? { now: o.now } : {}) });
  // The test harness gives each first workspace the trial so journeys have credits (production default is approval).
  const identity = createIdentityModule({ db, autoTrial: billing.startTrial });
  const platform = createPlatformModule({ db, ttlHours: 24 });
  const limiter = new MemoryRateLimiter(o.buckets ?? generousBuckets);
  const llm = o.fixtures?.llm ?? fixtureLlm();
  const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm, billing, encryptionKey: KEY, logger, ...(o.now ? { now: o.now } : {}) });
  const discovery = createDiscoveryService({ db, billing, ...(o.now ? { now: o.now } : {}) });
  const web = o.fixtures?.web ?? webFor(() => []);
  const scraper = o.fixtures?.scraper ?? scraperFor(() => "Food vlogger in Lahore");
  const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm, encryptionKey: KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
  const live = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm, logger, ...(o.now ? { now: o.now } : {}) });
  const profileRunner = createDiscoveryRunner({ db, billing, pipeline, logger });
  const iss = await createTestIssuer();
  const app = await buildTestApp({
    guards: { customer: createCustomerGuard({ verify: createCustomerTokenVerifier(iss), resolveTenant: identity.resolveTenant, limiter }), idempotent: platform.requireIdempotencyKey },
    modules: [platform.module, identity.module, createBillingModule({ service: billing, payments, appUrl: "http://localhost:5173" }), createCreatorsModule({ service: creators, limiter }), createDiscoveryModule({ service: discovery, limiter })],
  });

  /** A signed-in person with their own workspace (provisioned with the trial on the first call). */
  async function person(email = `p-${randomUUID().slice(0, 6)}@acceptance.test`) {
    const sub = randomUUID();
    const headers = { authorization: `Bearer ${await iss.sign({ sub, email, fullName: "Acceptance Tester" })}` };
    const me = (await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { workspace: { id: string } };
    const ctx: TenantContext = { userId: sub, workspaceId: me.workspace.id, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
    return { headers, ctx, sub, workspaceId: me.workspace.id };
  }
  const search = (h: Record<string, string>, text: string, filters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/search", headers: h, payload: { text, filters, confirmedCost: 50, ...extra } });
  const balance = async (ctx: TenantContext) => (await billing.summary(ctx)).balance;

  /** Quote and confirm a live run through the service, as the API does. */
  async function startLive(ctx: TenantContext, text: string, filters: Record<string, unknown>, maxNew: LiveRunSize = 10) {
    const estimate = await discovery.createEstimate(ctx, { search: { text, filters: searchFiltersSchema.parse(filters) }, maxNew });
    const out = await discovery.start(ctx, { kind: "live", estimateId: estimate.estimateId });
    if (out.body.status !== "started") throw new Error(`expected a started run, got ${out.body.status}`);
    return { estimate, jobId: out.body.job.id };
  }
  return { app, billing, creators, discovery, live, profileRunner, pipeline, web, scraper, llm, iss, person, search, balance, startLive };
}

/** Independent read of authoritative rows through the database owner (not the application's connection). */
export const owner = ownerQuery;

/** Ledger check: lots, holds and ledger agree for a workspace (no mismatch rows). */
export async function ledgerMismatches(billing: Awaited<ReturnType<typeof buildApi>>["billing"], workspaceId: string): Promise<unknown[]> {
  return db.withWorkspace(workspaceId, (tx) => billing.engine.reconcile(tx, workspaceId));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? Number.NaN;
}
