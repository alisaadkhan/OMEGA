import { boolean, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

const platform = pgSchema("platform");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const discoveryJobs = wp.table("discovery_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  kind: text("kind", { enum: ["add_by_url", "refresh", "live"] }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  inputUrl: text("input_url"),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube"] }),
  handle: text("handle"),
  canonicalUrl: text("canonical_url"),
  creatorId: uuid("creator_id"),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  step: text("step", { enum: ["searching", "filtering", "fetching", "archiving", "cleaning", "assessing", "saving"] }),
  attempts: integer("attempts").notNull().default(0),
  reservationId: uuid("reservation_id"),
  cost: integer("cost").notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  search: jsonb("search").$type<{ text: string; filters: Record<string, unknown> }>(),
  maxNew: integer("max_new"),
  searchHash: text("search_hash"),
  prices: jsonb("prices").$type<LivePrices>(),
  foundCount: integer("found_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  knownCount: integer("known_count").notNull().default(0),
  progress: jsonb("progress").$type<LiveProgress>().notNull().default({
    serpResultsSeen: 0, profileCandidates: 0, afterDedupe: 0, snippetGatePass: 0, ambiguousCandidates: 0,
    extractedProfiles: 0, validIndividualCreators: 0, qualifiedCreators: 0, persistedResults: 0, billableCreators: 0,
  }),
  outcome: text("outcome", { enum: ["created", "refreshed", "reused", "succeeded", "completed_empty", "insufficient", "partial", "failed", "canceled", "expired"] }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const discoveryEstimates = wp.table("discovery_estimates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  search: jsonb("search").$type<{ text: string; filters: Record<string, unknown> }>().notNull(),
  maxNew: integer("max_new").notNull(),
  searchHash: text("search_hash").notNull(),
  prices: jsonb("prices").$type<LivePrices>().notNull(),
  maxCredits: integer("max_credits").notNull(),
  priceVersion: text("price_version").notNull(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  jobId: uuid("job_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type LivePrices = { search: number; instagram: number; tiktok: number; youtube: number };
export type LiveProgress = {
  serpResultsSeen: number; profileCandidates: number; afterDedupe: number; snippetGatePass: number; ambiguousCandidates: number;
  extractedProfiles: number; validIndividualCreators: number; qualifiedCreators: number; persistedResults: number; billableCreators: number;
};
export type CampaignFitEvidence = { version: string; score: number | null; confidence: number; eligible: boolean; gate: string | null; topicScore: number | null; sampleSize: number; sourceUrl: string; fetchedAt: string; evidence: string[] };

export const discoveryResults = wp.table("discovery_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  jobId: uuid("job_id").notNull(),
  creatorId: uuid("creator_id").notNull(),
  seq: integer("seq").notNull(),
  rank: integer("rank").notNull().default(0),
  fitScore: smallint("fit_score").notNull().default(0),
  fitLabel: text("fit_label", { enum: ["Best match", "Strong match", "Possible match", "Needs review"] }).notNull().default("Needs review"),
  isNew: boolean("is_new").notNull(),
  credits: integer("credits").notNull().default(0),
  reason: text("reason"),
  campaignFit: jsonb("campaign_fit").$type<CampaignFitEvidence>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type CandidateStage = "normalization" | "dedupe" | "cheap_gate" | "relevance" | "selection" | "extraction" | "verification" | "fit" | "delivery";
export type CandidateDecision = "pending" | "delivered" | "rejected" | "duplicate" | "skipped" | "not_extracted" | "unreviewed" | "unverified" | "failed";

/** Live Discovery decision trail: one row per job and search-result link (migration 0021). */
export const discoveryCandidates = wp.table("discovery_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  jobId: uuid("job_id").notNull(),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube"] }).notNull(),
  candidateKey: text("candidate_key").notNull(),
  sourceUrl: text("source_url").notNull(),
  canonicalUrl: text("canonical_url"),
  handle: text("handle"),
  query: text("query"),
  round: smallint("round"),
  position: smallint("position"),
  occurrences: smallint("occurrences").notNull().default(1),
  stage: text("stage").$type<CandidateStage>().notNull(),
  decision: text("decision").$type<CandidateDecision>().notNull(),
  reason: text("reason"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  creatorId: uuid("creator_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const serperCache = platform.table("serper_cache", {
  queryHash: text("query_hash").primaryKey(),
  query: text("query").notNull(),
  results: jsonb("results").$type<{ title: string; link: string; snippet: string }[]>().notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
});
