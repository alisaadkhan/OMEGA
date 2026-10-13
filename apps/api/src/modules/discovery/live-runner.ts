import { searchFiltersSchema, type DiscoveryJobStep, type LiveSearch } from "@mushin/contracts";
import { AppError, type Logger } from "@mushin/core";
import type { Db, LivePrices, LiveProgress, TenantTx } from "@mushin/db";
import { ProviderError, type Llm, type ProfileScraper } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { findProfileByUrl, fitLabel, getSearchSettings, isVisibleCreator, rankCards, suppressedUrls, type CreatorPlatform, type EnrichJob, type EnrichmentPipeline } from "../creators/index";
import { notifyFinished, releaseHeld } from "./finish";
import type { CachedSearch } from "./live/cache";
import { evaluateCampaignFit } from "./fit";
import { collectCandidates } from "./live/candidates";
import { buildQueries } from "./live/queries";
import { filterRelevant, type Kept } from "./live/relevance";
import * as repo from "./repository";

type Deps = {
  db: Db;
  billing: Pick<BillingService, "engine">;
  pipeline: Pick<EnrichmentPipeline, "archive" | "archived" | "profileForUrl" | "processProfile">;
  scraper: Pick<ProfileScraper, "fetchProfiles">;
  search: Pick<CachedSearch, "search">;
  llm: Llm;
  logger: Logger;
  maxAttempts?: number;
  now?: () => Date;
};

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
        if (!await repo.insertResult(tx, workspaceId, jobId, { creatorId, isNew: false, credits: 0, reason, campaignFit })) return;
        const results = await repo.resultCreatorIds(tx, workspaceId, jobId);
        const qualified = await rerank(tx, job, search);
        await repo.advanceProgress(tx, workspaceId, jobId, {
          validIndividualCreators: qualified,
          qualifiedCreators: qualified,
          persistedResults: results.length,
          billableCreators: await repo.countBillable(tx, workspaceId, jobId),
        });
      });
    const profileJob = (k: Kept): EnrichJob => ({ jobId, workspaceId, platform: k.platform, handle: k.handle, canonicalUrl: k.canonicalUrl, requestId: job.requestId });

    try {
      // 1–2. Adaptive, cached Google rounds → unique profile candidates. The first
      // round is precise; recall rounds add Urdu/Roman Urdu or alternate English
      // phrasing only when the current valid-profile pool is still thin.
      await step("searching");
      const groups: { platform: CreatorPlatform; results: Awaited<ReturnType<CachedSearch["search"]>> }[] = [];
      for (const round of [1, 2, 3] as const) {
        for (const q of buildQueries(search, round)) groups.push({ platform: q.platform, results: await deps.search.search(q, ctx) });
        const candidates = collectCandidates(groups, 60);
        await progress({
          serpResultsSeen: groups.reduce((total, group) => total + group.results.length, 0),
          profileCandidates: candidates.length,
          afterDedupe: candidates.length,
          // Candidate snippets are not cheaply classified yet; all are conservatively
          // treated as ambiguous and sent through the schema-validated relevance gate.
          ambiguousCandidates: candidates.length,
        });
        if (candidates.length >= 8) break;
      }
      // 3. The AI keeps the relevant ones.
      await step("filtering");
      const kept = await filterRelevant({ llm: deps.llm, search, candidates: collectCandidates(groups), ctx, logger: deps.logger });
      await progress({ ambiguousCandidates: collectCandidates(groups).length });
      if (kept.length < 8) {
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          if (!(await repo.lockOpenJob(tx, workspaceId, jobId))) return;
          if (job.reservationId) await engine.commitPartial(tx, workspaceId, job.reservationId, 0, { userId: job.requestedBy, requestId: job.requestId }, "Live run had too few eligible candidates");
          if (!(await repo.finishJob(tx, workspaceId, jobId, { status: "completed", outcome: "insufficient", creditsCharged: 0 }))) return;
          await notifyFinished(tx, job, "completed");
        });
        return;
      }
      // 4. Known creators become free results; erased and hidden ones are dropped; new ones are queued up to the size.
      const suppressed = await deps.db.withSystem((tx) => suppressedUrls(tx, kept.map((k) => k.canonicalUrl)));
      const alreadyNew = await deps.db.withWorkspace(workspaceId, (tx) => repo.countNew(tx, workspaceId, jobId));
      const fresh: Kept[] = [];
      for (const k of kept) {
        if (suppressed.has(k.canonicalUrl)) continue;
        const known = await deps.db.withSystem((tx) => findProfileByUrl(tx, k.canonicalUrl));
        if (known) {
          // Reuse retained evidence only. A known creator without an archived sample cannot pass a per-job Fit gate.
          if (await deps.db.withSystem((tx) => isVisibleCreator(tx, known.creatorId))) {
            const stored = await deps.pipeline.profileForUrl(k.canonicalUrl);
            if (stored) {
              const campaignFit = evaluateCampaignFit(search, k, stored.profile, false, now(), stored.fetchedAt);
              if (campaignFit.eligible) await recordKnown(known.creatorId, k.reason, campaignFit);
            }
          }
          continue;
        }
        if (alreadyNew + fresh.length < maxNew) fresh.push(k);
      }
      // 5. One Apify run per platform; each profile archived on its own (a retry reuses the archive).
      await step("fetching");
      const fetched: { k: Kept; payloadId: string; raw: unknown }[] = [];
      for (const platform of ["instagram", "tiktok", "youtube"] as const) {
        const list = fresh.filter((k) => k.platform === platform);
        const missing: Kept[] = [];
        for (const k of list) {
          const a = await deps.pipeline.archived(jobId, k.canonicalUrl);
          if (a) fetched.push({ k, ...a });
          else missing.push(k);
        }
        if (missing.length === 0) continue;
        const batch = await deps.scraper.fetchProfiles({ platform, handles: missing.map((m) => m.handle), ctx });
        await step("archiving");
        for (const m of missing) {
          const raw = batch.profiles.find((p) => p.handle === m.handle.toLowerCase())?.raw ?? [];
          fetched.push({ k: m, payloadId: await deps.pipeline.archive(profileJob(m), batch.provider, raw), raw });
        }
      }
      // 6–7. 4A's steps per profile; each save inserts its result and re-ranks in the same transaction.
      for (const f of fetched) {
        await progress({ extractedProfiles: fetched.length });
        await deps.pipeline.processProfile(profileJob(f.k), f.payloadId, f.raw, {
          onStep: (s) => (s === "assessing" || s === "saving" ? step(s) : Promise.resolve()),
          onSaved: async (tx, saved) => {
            const isNew = saved.outcome === "created";
            // A possible minor is saved but hidden from customers, so it costs nothing (Review Focus 1).
            const visible = await isVisibleCreator(tx, saved.creatorId);
            const campaignFit = evaluateCampaignFit(search, f.k, saved.profile, !visible, now());
            if (campaignFit.eligible && visible && await repo.insertResult(tx, workspaceId, jobId, { creatorId: saved.creatorId, isNew, credits: isNew ? prices[f.k.platform] : 0, reason: f.k.reason, campaignFit })) {
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
      }
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
      if (retryable && job.attempts < maxAttempts) throw err; // the queue tries again with backoff
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
