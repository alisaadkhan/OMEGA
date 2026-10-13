import { searchFiltersSchema, type DiscoveryJobStep, type LiveSearch } from "@mushin/contracts";
import { AppError, type Logger } from "@mushin/core";
import type { Db, LivePrices, LiveProgress, TenantTx } from "@mushin/db";
import { ProviderError, type Llm, type ProfileScraper } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { findProfileByUrl, fitLabel, getSearchSettings, isVisibleCreator, rankCards, suppressedUrls, type CreatorPlatform, type EnrichJob, type EnrichmentPipeline } from "../creators/index";
import { notifyFinished, releaseHeld } from "./finish";
import type { CachedSearch } from "./live/cache";
import { evaluateCampaignFit } from "./fit";
import { collectCandidates, spreadByPlatform } from "./live/candidates";
import { buildQueries, platformsFor, youtubeNativeQuery } from "./live/queries";
import { classifyCandidates, filterRelevant, rankByEvidence, type Kept } from "./live/relevance";
import { createTrail, type SearchGroup } from "./live/trail";
import { contentGroup, mentionLeads, postsToResolve } from "./live/content";
import * as repo from "./repository";

type Deps = {
  db: Db;
  billing: Pick<BillingService, "engine">;
  pipeline: Pick<EnrichmentPipeline, "archive" | "archived" | "profileForUrl" | "processProfile">;
  scraper: Pick<ProfileScraper, "fetchProfiles" | "resolveInstagramPostOwners">;
  search: Pick<CachedSearch, "search" | "searchYouTube">;
  llm: Llm;
  logger: Logger;
  maxAttempts?: number;
  now?: () => Date;
  /** Most Instagram post/reel links whose authors are resolved per run (0, the default, disables it). */
  contentResolutionMax?: number;
  /** Profiles fetched per run, as a multiple of the chosen size, while the size is not filled (1, the default, = size). */
  extractionMultiplier?: number;
  /** Profiles processed at the same time (default 1). */
  profileConcurrency?: number;
};

/** G2: candidates after the cheap G1 gate needed before extraction (spec default 8); below it the run is `insufficient`. */
export const MIN_POOL = 8;

const MESSAGES: Record<ProviderError["reason"], string> = {
  spend_cap: "Finding new creators is paused right now. Please try again later. Your credits were returned.",
  quota: "Finding new creators is paused right now. Please try again later. Your credits were returned.",
  not_configured: "Finding new creators isn't available right now. Your credits were returned.",
  provider: "We couldn't finish finding new creators right now. Please try again later. Your credits were returned.",
};

function providerErrorOf(err: unknown): ProviderError | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof ProviderError) return e;
  return null;
}

/** Worker side of a live run (spec §4.2; Diagram 7). */
export function createLiveRunner(deps: Deps) {
  const maxAttempts = deps.maxAttempts ?? 3;
  const now = deps.now ?? (() => new Date());
  const engine = deps.billing.engine;

  async function rerank(tx: TenantTx, job: repo.JobRow, search: LiveSearch): Promise<number> {
    const ids = await repo.resultCreatorIds(tx, job.workspaceId, job.id);
    const [cards, rows, settings] = await Promise.all([
      rankCards(tx, ids, search.filters, now()),
      repo.resultsAfter(tx, job.workspaceId, job.id, 0),
      getSearchSettings(tx),
    ]);
    const campaignFit = new Map(rows.map((r) => [r.creatorId, r.campaignFit?.score ?? null]));
    cards.sort((a, b) => (campaignFit.get(b.id) ?? b.fitScore) - (campaignFit.get(a.id) ?? a.fitScore) || b.fitScore - a.fitScore || a.id.localeCompare(b.id));
    await repo.setRanks(tx, job.workspaceId, job.id, cards.map((c, i) => {
      const score = campaignFit.get(c.id);
      return { creatorId: c.id, rank: i + 1, fitScore: score ?? c.fitScore, fitLabel: score === null || score === undefined ? c.fitLabel : fitLabel(score, settings.labels) };
    }));
    return cards.length; // creators customers can see
  }

  async function run(jobId: string, workspaceId: string): Promise<void> {
    const job = await deps.db.withWorkspace(workspaceId, (tx) => repo.startAttempt(tx, workspaceId, jobId));
    if (!job) return;
    if (job.kind !== "live" || !job.search || !job.prices || job.maxNew === null) throw new Error(`discovery job ${jobId} is not a live run`);
    const search: LiveSearch = { text: job.search.text, filters: searchFiltersSchema.parse(job.search.filters) };
    const prices: LivePrices = job.prices;
    const maxNew = job.maxNew;
    const ctx = { workspaceId, jobId, requestId: job.requestId };
    const step = (s: DiscoveryJobStep) =>
      deps.db.withWorkspace(workspaceId, async (tx) => {
        await repo.setStep(tx, workspaceId, jobId, s);
        // Long runs keep their credits held: the 15-minute cleanup must not release a run that is still working.
        if (job.reservationId) await engine.extend(tx, workspaceId, job.reservationId).catch(() => undefined);
      });
    const progress = (patch: Partial<LiveProgress>) =>
      deps.db.withWorkspace(workspaceId, (tx) => repo.advanceProgress(tx, workspaceId, jobId, patch));
    const recordKnown = (creatorId: string, reason: string | null, campaignFit: Awaited<ReturnType<typeof evaluateCampaignFit>>) =>
      deps.db.withWorkspace(workspaceId, async (tx) => {
        if (!await repo.insertResult(tx, workspaceId, jobId, { creatorId, isNew: false, credits: 0, reason, campaignFit })) return false;
        const results = await repo.resultCreatorIds(tx, workspaceId, jobId);
        const qualified = await rerank(tx, job, search);
        await repo.advanceProgress(tx, workspaceId, jobId, {
          validIndividualCreators: qualified,
          qualifiedCreators: qualified,
          persistedResults: results.length,
          billableCreators: await repo.countBillable(tx, workspaceId, jobId),
        });
        return true;
      });
    // Every search-result link and the stage where it stopped (wp.discovery_candidates).
    const trail = createTrail({ workspaceId, jobId });
    const flush = async () => {
      const rows = trail.drain();
      if (rows.length > 0) await deps.db.withWorkspace(workspaceId, (tx) => repo.upsertCandidates(tx, rows));
    };
    const profileJob = (k: Kept): EnrichJob => ({ jobId, workspaceId, platform: k.platform, handle: k.handle, canonicalUrl: k.canonicalUrl, requestId: job.requestId });

    try {
      // 1–2. Adaptive, cached Google rounds → unique profile candidates. The first
      // round is precise; recall rounds add Urdu/Roman Urdu or alternate English
      // phrasing only while the pool after the cheap G1 gate is still below the
      // G2 minimum (counting raw URLs stopped after round 1 even when most were shops).
      await step("searching");
      const groups: SearchGroup[] = [];
      // Profiles found only through a post or mention: their search evidence is the post's, so they queue after organic ones.
      const recoveredKeys = new Set<string>();
      for (const round of [1, 2, 3] as const) {
        // A round's searches are independent: run them together, keep their planned order (measured: 9 sequential
        // searches took 14 s of a 138 s run).
        const planned = buildQueries(search, round);
        const nativeQuery = round === 1 ? youtubeNativeQuery(search) : null;
        const nativeSearch = nativeQuery && deps.search.searchYouTube ? deps.search.searchYouTube(nativeQuery, ctx) : Promise.resolve([]);
        nativeSearch.catch(() => undefined); // handled where it is awaited below
        const found = await Promise.all(planned.map((q) => deps.search.search(q, ctx)));
        planned.forEach((q, index) => groups.push({ platform: q.platform, query: q.query, round, results: found[index] ?? [] }));
        const native = round === 1 ? youtubeNativeQuery(search) : null;
        if (native && deps.search.searchYouTube) {
          try {
            groups.push({ platform: "youtube", query: `youtube_video: ${native.query}`, round, results: await nativeSearch });
          } catch (err) {
            // An extra source: a used-up quota or a refused key never fails the run.
            deps.logger.warn({ err, jobId }, "YouTube-native search failed; continuing with web search results");
          }
        }
        trail.observe(groups);
        const candidates = collectCandidates(groups, 60);
        await progress({
          serpResultsSeen: groups.reduce((total, group) => total + group.results.length, 0),
          profileCandidates: candidates.length,
          afterDedupe: candidates.length,
        });
        const g1 = classifyCandidates(search, candidates);
        if (g1.possible.length + g1.ambiguous.length >= MIN_POOL) break;
      }
      // 2b. Posts and reels as discovery evidence: authors the provider reports for the exact post, and creator
      // @mentions as leads. Resolution is paid, so it runs only while Instagram's own pool is short of twice the size.
      if (platformsFor(search).includes("instagram")) {
        const igPool = classifyCandidates(search, collectCandidates(groups)).possible.filter((c) => c.platform === "instagram").length;
        const limit = deps.scraper.resolveInstagramPostOwners ? Math.min(deps.contentResolutionMax ?? 0, Math.max(0, 2 * maxNew - igPool)) : 0;
        const { chosen, business, thirdPerson, overLimit } = postsToResolve(search, groups, limit);
        for (const c of business) trail.set(c.url, "normalization", "rejected", "content_business_cue");
        for (const c of thirdPerson) trail.set(c.url, "normalization", "skipped", "content_not_creator_voice");
        for (const c of overLimit) trail.set(c.url, "normalization", "skipped", limit === 0 ? "content_resolution_not_needed" : "content_resolution_limit");
        const authors: { handle: string; from: (typeof chosen)[number] }[] = [];
        if (chosen.length > 0 && deps.scraper.resolveInstagramPostOwners) {
          try {
            const resolved = await deps.scraper.resolveInstagramPostOwners({ urls: chosen.map((c) => c.url), ctx });
            for (const c of chosen) {
              const owner = resolved.owners.find((o) => o.url === c.url)?.owner ?? null;
              if (owner) {
                authors.push({ handle: owner, from: c });
                trail.set(c.url, "normalization", "skipped", "content_author_resolved", { detail: { author: owner } });
              } else trail.set(c.url, "normalization", "rejected", "content_author_unresolved");
            }
          } catch (err) {
            // Optional discovery evidence: a spend cap or provider failure here never fails the run.
            deps.logger.warn({ err, jobId }, "Instagram post authors could not be resolved; continuing with profile results");
            for (const c of chosen) trail.set(c.url, "normalization", "rejected", "content_resolution_failed");
          }
        }
        const recovered = [...contentGroup("post_author", authors), ...contentGroup("mention", mentionLeads(groups))];
        if (recovered.length > 0) {
          const before = new Set(trail.all().map((r) => r.candidateKey));
          groups.push(...recovered);
          trail.observe(groups);
          for (const g of recovered) {
            const source = g.query.startsWith("post_author") ? "post_author" : "mention";
            for (const r of g.results) {
              const key = collectCandidates([{ platform: "instagram", results: [r] }])[0]?.canonicalUrl;
              if (key && !before.has(key)) {
                trail.note(key, { source });
                recoveredKeys.add(key);
              }
            }
          }
          await progress({ serpResultsSeen: groups.reduce((total, group) => total + group.results.length, 0), profileCandidates: collectCandidates(groups, 60).length, afterDedupe: collectCandidates(groups, 60).length });
        }
        await flush();
      }
      // 3. Apply cheap topic/business evidence first (G1); G2 is the minimum pool after it. The LLM sees ambiguous results only.
      await step("filtering");
      const capped = collectCandidates(groups);
      const inCap = new Set(capped.map((c) => c.canonicalUrl));
      for (const key of trail.pendingKeys()) if (!inCap.has(key)) trail.set(key, "dedupe", "skipped", "candidate_cap");
      const gated = classifyCandidates(search, capped);
      for (const c of gated.businesses) trail.set(c.canonicalUrl, "cheap_gate", "rejected", "business_snippet");
      for (const c of gated.possible) trail.set(c.canonicalUrl, "cheap_gate", "pending", "topic_snippet");
      for (const c of gated.ambiguous) trail.set(c.canonicalUrl, "relevance", "pending", null);
      await progress({ snippetGatePass: gated.possible.length, ambiguousCandidates: gated.ambiguous.length });
      const pool = gated.possible.length + gated.ambiguous.length;
      const relevance = { unreviewed: 0, unreviewedUrls: [] as string[] };
      const reviewed = pool < MIN_POOL ? [] : await filterRelevant({ llm: deps.llm, search, candidates: gated.ambiguous, ctx, logger: deps.logger, stats: relevance });
      if (relevance.unreviewed > 0) deps.logger.warn({ jobId, unreviewed: relevance.unreviewed }, "some candidates were not extracted because their relevance review failed");
      const kept = [...gated.possible, ...reviewed];
      if (pool < MIN_POOL) {
        trail.finish("skipped", "insufficient_pool");
        await flush();
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          if (!(await repo.lockOpenJob(tx, workspaceId, jobId))) return;
          if (job.reservationId) await engine.commitPartial(tx, workspaceId, job.reservationId, 0, { userId: job.requestedBy, requestId: job.requestId }, "Live run had too few eligible candidates");
          if (!(await repo.finishJob(tx, workspaceId, jobId, { status: "completed", outcome: "insufficient", creditsCharged: 0 }))) return;
          await notifyFinished(tx, job, "completed");
        });
        return;
      }
      const keptUrls = new Set(reviewed.map((k) => k.canonicalUrl));
      const unreviewed = new Set(relevance.unreviewedUrls);
      for (const k of reviewed) trail.set(k.canonicalUrl, "relevance", "pending", "relevant", { detail: { relevanceReason: k.reason } });
      for (const c of gated.ambiguous) {
        if (keptUrls.has(c.canonicalUrl)) continue;
        if (unreviewed.has(c.canonicalUrl)) trail.set(c.canonicalUrl, "relevance", "unreviewed", "relevance_review_failed");
        else trail.set(c.canonicalUrl, "relevance", "rejected", "not_relevant");
      }
      await flush();
      // 4. Known creators become free results; erased and hidden ones are dropped; new ones are queued up to the size.
      const suppressed = await deps.db.withSystem((tx) => suppressedUrls(tx, kept.map((k) => k.canonicalUrl)));
      const alreadyNew = await deps.db.withWorkspace(workspaceId, (tx) => repo.countNew(tx, workspaceId, jobId));
      const availableNew: Kept[] = [];
      for (const k of kept) {
        if (suppressed.has(k.canonicalUrl)) {
          trail.set(k.canonicalUrl, "selection", "rejected", "suppressed");
          continue;
        }
        const known = await deps.db.withSystem((tx) => findProfileByUrl(tx, k.canonicalUrl));
        if (known) {
          // Reuse retained evidence only. A known creator without an archived sample cannot pass a per-job Fit gate.
          if (!(await deps.db.withSystem((tx) => isVisibleCreator(tx, known.creatorId)))) {
            trail.set(k.canonicalUrl, "selection", "skipped", "hidden_creator", { creatorId: known.creatorId });
            continue;
          }
          // An unreadable archive (storage outage, or an object purged before its row) skips this creator, not the run.
          const stored = await deps.pipeline.profileForUrl(k.canonicalUrl).catch((err: unknown) => {
            deps.logger.warn({ err, jobId }, "stored profile sample could not be read; the known creator is skipped");
            trail.set(k.canonicalUrl, "selection", "skipped", "stored_sample_unreadable", { creatorId: known.creatorId });
            return "unreadable" as const;
          });
          if (stored === "unreadable") continue;
          if (!stored) {
            trail.set(k.canonicalUrl, "selection", "skipped", "known_without_sample", { creatorId: known.creatorId });
            continue;
          }
          const campaignFit = evaluateCampaignFit(search, k, stored.profile, false, now(), stored.fetchedAt);
          trail.fit(k.canonicalUrl, campaignFit, known.creatorId);
          if (campaignFit.eligible) {
            if (await recordKnown(known.creatorId, k.reason, campaignFit)) trail.set(k.canonicalUrl, "delivery", "delivered", "known_creator");
            else trail.set(k.canonicalUrl, "delivery", "duplicate", "already_in_results");
          }
          continue;
        }
        availableNew.push(k);
      }
      // Measured 2026-10-13: 1 of 12 extracted post/mention profiles qualified against about 60% of organic ones.
      const organic = rankByEvidence(search, availableNew.filter((k) => !recoveredKeys.has(k.canonicalUrl)));
      const ordered = spreadByPlatform([...organic, ...rankByEvidence(search, availableNew.filter((k) => recoveredKeys.has(k.canonicalUrl)))]);
      // The run size chosen at quote time bounds the new creators charged. Profiles are fetched in waves: a first wave of
      // the remaining size, then (when extractionMultiplier > 1) further waves of the next-best candidates while fewer
      // new creators than the size qualified, up to multiplier × size fetches. The charge rule is unchanged.
      const fetchCap = Math.max(0, Math.ceil((deps.extractionMultiplier ?? 1) * maxNew) - alreadyNew);
      let offset = 0;
      let fetchedCount = 0;
      ordered.forEach((k, index) => trail.set(k.canonicalUrl, "selection", "pending", null, { detail: { selectionRank: index + 1 } }));
      for (let wave = 1; ; wave++) {
        const need = maxNew - (await deps.db.withWorkspace(workspaceId, (tx) => repo.countNew(tx, workspaceId, jobId)));
        const take = Math.min(need, fetchCap - fetchedCount, ordered.length - offset);
        if (take <= 0) break;
        const fresh = ordered.slice(offset, offset + take);
        offset += take;
        fetchedCount += take;
        for (const k of fresh) trail.set(k.canonicalUrl, "extraction", "pending", null, { detail: { wave } });
        await flush();
        // 5. One Apify run per platform and wave; each profile archived on its own (a retry reuses the archive).
        await step("fetching");
        const fetched: { k: Kept; payloadId: string; raw: unknown }[] = [];
        const missingByPlatform: { platform: CreatorPlatform; missing: Kept[] }[] = [];
        for (const platform of ["instagram", "tiktok", "youtube"] as const) {
          const missing: Kept[] = [];
          for (const k of fresh.filter((c) => c.platform === platform)) {
            const a = await deps.pipeline.archived(jobId, k.canonicalUrl);
            if (a) fetched.push({ k, ...a });
            else missing.push(k);
          }
          if (missing.length > 0) missingByPlatform.push({ platform, missing });
        }
        // Each platform's provider run is independent (measured: Instagram then TikTok took 69 s in a row); all
        // settle before archiving so a failure never leaves another platform's paid run unrecorded.
        const batches = await Promise.allSettled(missingByPlatform.map((m) => deps.scraper.fetchProfiles({ platform: m.platform, handles: m.missing.map((x) => x.handle), ctx })));
        if (missingByPlatform.length > 0) await step("archiving");
        for (const [index, m] of missingByPlatform.entries()) {
          const settled = batches[index];
          if (!settled || settled.status === "rejected") continue;
          for (const x of m.missing) {
            const raw = settled.value.profiles.find((p) => p.handle === x.handle.toLowerCase())?.raw ?? [];
            fetched.push({ k: x, payloadId: await deps.pipeline.archive(profileJob(x), settled.value.provider, raw), raw });
          }
        }
        const failedBatch = batches.find((b): b is PromiseRejectedResult => b.status === "rejected");
        // 6–7. 4A's steps per profile; each save inserts its result and re-ranks in the same transaction (the job row is
        // locked there, so concurrent saves stay ordered). The slow step is the AI assessment, so profiles overlap.
        let processedCount = 0;
        const processOne = async (f: (typeof fetched)[number]): Promise<void> => {
          processedCount++;
          await progress({ extractedProfiles: fetchedCount - fresh.length + processedCount });
          const processed = await deps.pipeline.processProfile(profileJob(f.k), f.payloadId, f.raw, {
            onStep: (s) => (s === "assessing" || s === "saving" ? step(s) : Promise.resolve()),
            onSaved: async (tx, saved) => {
              const isNew = saved.outcome === "created";
              // A possible minor is saved but hidden from customers, so it costs nothing (Review Focus 1).
              const visible = await isVisibleCreator(tx, saved.creatorId);
              const campaignFit = evaluateCampaignFit(search, f.k, saved.profile, !visible, now());
              trail.fit(f.k.canonicalUrl, campaignFit, saved.creatorId);
              if (campaignFit.eligible && visible) trail.set(f.k.canonicalUrl, "delivery", "duplicate", "already_in_results");
              if (campaignFit.eligible && visible && await repo.insertResult(tx, workspaceId, jobId, { creatorId: saved.creatorId, isNew, credits: isNew ? prices[f.k.platform] : 0, reason: f.k.reason, campaignFit })) {
                trail.set(f.k.canonicalUrl, "delivery", "delivered", isNew ? "new_creator" : "known_creator", { detail: { credits: isNew ? prices[f.k.platform] : 0 } });
                const results = await repo.resultCreatorIds(tx, workspaceId, jobId);
                const qualified = await rerank(tx, job, search);
                await repo.advanceProgress(tx, workspaceId, jobId, {
                  validIndividualCreators: qualified,
                  qualifiedCreators: qualified,
                  persistedResults: results.length,
                  billableCreators: await repo.countBillable(tx, workspaceId, jobId),
                });
              }
            },
          });
          // Private, missing or unusable profiles return "unavailable": skipped, never charged.
          if (processed.kind === "unavailable") trail.set(f.k.canonicalUrl, "extraction", "rejected", processed.code.toLowerCase());
          await flush();
        };
        let next = 0;
        const workers = Array.from({ length: Math.min(Math.max(1, deps.profileConcurrency ?? 1), fetched.length) }, async () => {
          for (let i = next++; i < fetched.length; i = next++) await processOne(fetched[i] as (typeof fetched)[number]);
        });
        const outcomes = await Promise.allSettled(workers);
        const failedProfile = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
        // Profiles already fetched are saved first; then a provider or processing failure is handled as before.
        if (failedBatch) throw failedBatch.reason;
        if (failedProfile) throw failedProfile.reason;
      }
      for (const key of trail.pendingKeys()) {
        // Candidates never fetched: beyond the chosen size, or beyond the extraction cap while the size was not filled.
        const row = trail.all().find((r) => r.candidateKey === key);
        if (row?.stage === "selection") trail.set(key, "selection", "not_extracted", fetchedCount >= fetchCap && (deps.extractionMultiplier ?? 1) > 1 ? "extraction_cap" : "run_size_limit");
      }
      await flush();
      trail.finish("skipped", "not_processed");
      await flush();
      // 8. Charge 12 + new creators if anything visible was found; otherwise everything comes back.
      await deps.db.withWorkspace(workspaceId, async (tx) => {
        if (!(await repo.lockOpenJob(tx, workspaceId, jobId))) return;
        const visible = await rerank(tx, job, search);
        let charge = visible > 0 ? prices.search + (await repo.resultCredits(tx, workspaceId, jobId)) : 0;
        if (job.reservationId) {
          try {
            await engine.commitPartial(tx, workspaceId, job.reservationId, charge, { userId: job.requestedBy, requestId: job.requestId }, `Live run: ${visible} creator(s) found`);
          } catch (err) {
            // Released by the 15-minute cleanup while the run waited: the creators are saved without a charge (4A rule).
            if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
            deps.logger.warn({ jobId }, "reservation was already released; the run is saved without a charge");
            charge = 0;
          }
        }
        const outcome = visible > 0 ? "succeeded" : "completed_empty";
        if (!(await repo.finishJob(tx, workspaceId, jobId, { status: "completed", outcome, creditsCharged: charge }))) return;
        await notifyFinished(tx, job, "completed");
      });
    } catch (err) {
      const pe = providerErrorOf(err);
      const retryable = pe ? pe.retryable : !(err instanceof AppError) || err.code === "PROVIDER_UNAVAILABLE";
      // The trail is diagnostic: failing to write it must not hide the run's own error.
      if (retryable && job.attempts < maxAttempts) {
        await flush().catch(() => undefined);
        throw err; // the queue tries again with backoff; the next attempt updates these rows
      }
      trail.finish("failed", "run_failed");
      await flush().catch((flushError: unknown) => deps.logger.warn({ err: flushError, jobId }, "could not record the candidate trail"));
      deps.logger.warn({ err, jobId }, "live discovery run failed");
      const code = "PROVIDER_UNAVAILABLE";
      const message = MESSAGES[pe?.reason ?? "provider"];
      await deps.db.withWorkspace(workspaceId, async (tx) => {
        if (!(await repo.lockOpenJob(tx, workspaceId, jobId))) return;
        const visible = await rerank(tx, job, search);
        const usable = visible > 0;
        let charged = 0;
        if (usable && job.reservationId) {
          charged = prices.search + (await repo.resultCredits(tx, workspaceId, jobId));
          try {
            await engine.commitPartial(tx, workspaceId, job.reservationId, charged, { userId: job.requestedBy, requestId: job.requestId }, `Live run partially completed: ${visible} creator(s) delivered`);
          } catch (settlementError) {
            if (!(settlementError instanceof AppError && settlementError.code === "CONFLICT")) throw settlementError;
            deps.logger.warn({ jobId }, "reservation was already released; partial results are saved without a charge");
            charged = 0;
          }
        }
        const status = usable ? "completed" : "failed";
        const outcome = usable ? "partial" : "failed";
        const terminalMessage = usable
          ? "Some creators were saved and charged according to your quote. Remaining reserved credits were returned."
          : message;
        if (!(await repo.finishJob(tx, workspaceId, jobId, { status, outcome, creditsCharged: charged, errorCode: code, errorMessage: terminalMessage }))) return;
        if (!usable) await releaseHeld(engine, tx, job, `${code}: ${message}`);
        await notifyFinished(tx, job, status);
      });
    }
  }

  return { run };
}

export type LiveRunner = ReturnType<typeof createLiveRunner>;
