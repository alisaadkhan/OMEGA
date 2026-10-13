import type { CandidateDecision, CandidateStage } from "@mushin/db";
import type { WebResult } from "@mushin/integrations";
import { cleanText, normalizeProfileUrl, redactContacts, type CreatorPlatform } from "../../creators/index";
import { isInstagramContent } from "./candidates";
import type { CandidateRow } from "../repository";

export type SearchGroup = { platform: CreatorPlatform; query: string; round: number; results: WebResult[] };

/** Fit gates that mean "not enough evidence yet", as opposed to evidence that a requirement is not met. */
const INSUFFICIENT_EVIDENCE = new Set(["individual_creator_unverified", "topic_evidence_unavailable", "follower_count_unavailable"]);
/** Gates about the account itself (who or what it is); the rest are about the campaign (topic, score). */
const ACCOUNT_GATES = new Set(["minor_or_unclear", "business_or_non_creator", "inactive_or_unverified", "platform_mismatch", "location_mismatch", "individual_creator_unverified", "follower_count_unavailable"]);

const excerpt = (text: string, max: number): string => redactContacts(cleanText(text, max));

/**
 * The decision trail of one live run: every search-result link, the stage it reached and why it stopped there. Every
 * link starts `pending`; a finished run leaves none pending (`finish` marks leftovers). Pure and in memory; the runner
 * flushes `rows()` to wp.discovery_candidates after each stage.
 */
export function createTrail(o: { workspaceId: string; jobId: string }) {
  const rows = new Map<string, CandidateRow>();
  const dirty = new Set<string>();
  const put = (row: CandidateRow) => {
    rows.set(row.candidateKey, row);
    dirty.add(row.candidateKey);
  };

  return {
    /** Records normalization and URL deduplication for all results seen so far (idempotent across rounds). */
    observe(groups: SearchGroup[]): void {
      for (const g of groups) {
        g.results.forEach((r, index) => {
          const n = normalizeProfileUrl(r.link);
          const sourceUrl = r.link.slice(0, 500);
          const key = n && n.platform === g.platform ? n.canonicalUrl : sourceUrl;
          const existing = rows.get(key);
          if (existing) {
            // Seeing the same group again (a later round re-observes) must not double count.
            const seenHere = (existing.detail as { seenIn?: string[] }).seenIn ?? [];
            const tag = `${g.round}|${g.query}|${index}`;
            if (!seenHere.includes(tag)) {
              existing.occurrences = (existing.occurrences ?? 1) + 1;
              existing.detail = { ...existing.detail, seenIn: [...seenHere, tag].slice(0, 20) };
              dirty.add(key);
            }
            return;
          }
          const base = {
            workspaceId: o.workspaceId, jobId: o.jobId, platform: g.platform, candidateKey: key, sourceUrl, query: g.query.slice(0, 300),
            round: g.round, position: index + 1, occurrences: 1,
            detail: { title: excerpt(r.title, 160), snippet: excerpt(r.snippet, 200), seenIn: [`${g.round}|${g.query}|${index}`] } as Record<string, unknown>,
          };
          if (!n) put({ ...base, stage: "normalization", decision: "rejected", reason: isInstagramContent(r.link) ? "content_url" : "non_profile_url" });
          else if (n.platform !== g.platform) put({ ...base, stage: "normalization", decision: "rejected", reason: "wrong_platform" });
          else put({ ...base, canonicalUrl: n.canonicalUrl, handle: (n.canonicalUrl.split("/").pop() ?? "").replace(/^@/, "").slice(0, 100), stage: "dedupe", decision: "pending", reason: null });
        });
      }
    },

    set(key: string, stage: CandidateStage, decision: CandidateDecision, reason: string | null, extra: { detail?: Record<string, unknown>; creatorId?: string } = {}): void {
      const row = rows.get(key);
      if (!row) return;
      put({ ...row, stage, decision, reason, ...(extra.detail ? { detail: { ...row.detail, ...extra.detail } } : {}), ...(extra.creatorId ? { creatorId: extra.creatorId } : {}) });
    },

    /** A Fit result: insufficient evidence is `unverified`, an account gate is a verification rejection, the rest Fit. */
    fit(key: string, fit: { eligible: boolean; gate: string | null; score: number | null; topicScore: number | null; evidence: string[] }, creatorId?: string): void {
      const detail = { fitScore: fit.score, topicScore: fit.topicScore, evidence: fit.evidence.slice(0, 12) };
      const extra = { detail, ...(creatorId ? { creatorId } : {}) };
      if (fit.eligible) return this.set(key, "fit", "pending", "eligible", extra);
      const gate = fit.gate ?? "below_min_fit";
      if (INSUFFICIENT_EVIDENCE.has(gate)) return this.set(key, "verification", "unverified", gate, extra);
      this.set(key, ACCOUNT_GATES.has(gate) ? "verification" : "fit", "rejected", gate, extra);
    },

    /** Adds evidence to a row without changing its stage or decision. */
    note(key: string, detail: Record<string, unknown>): void {
      const row = rows.get(key);
      if (row) put({ ...row, detail: { ...row.detail, ...detail } });
    },

    pendingKeys(): string[] {
      return [...rows.values()].filter((r) => r.decision === "pending").map((r) => r.candidateKey);
    },

    /** Leftover pending rows get a terminal decision so no candidate silently disappears. */
    finish(decision: CandidateDecision, reason: string): void {
      for (const key of this.pendingKeys()) {
        const row = rows.get(key);
        if (row) put({ ...row, decision, reason });
      }
    },

    /** Rows changed since the last call. */
    drain(): CandidateRow[] {
      const out = [...dirty].flatMap((k) => (rows.has(k) ? [rows.get(k) as CandidateRow] : []));
      dirty.clear();
      return out;
    },

    all(): CandidateRow[] {
      return [...rows.values()];
    },
  };
}

export type Trail = ReturnType<typeof createTrail>;
