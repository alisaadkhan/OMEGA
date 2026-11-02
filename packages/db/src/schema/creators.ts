import { boolean, char, date, doublePrecision, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { wp } from "./identity";

export const gcp = pgSchema("gcp");
const platform = pgSchema("platform");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const platformEnum = ["instagram", "tiktok", "youtube"] as const;
type Confidence = "low" | "medium" | "high";

export type EvidenceRow = { signal: string; detail: string; weight: number };
export type AudienceRow = {
  age: { label: string; value: number; confidence: Confidence }[];
  gender: { female: number; male: number; confidence: Confidence } | null;
  cities: { label: string; value: number; confidence: Confidence }[];
  countries: { code: string; value: number; confidence: Confidence }[];
  source: string;
};

export const creators = gcp.table("creators", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  primaryHandle: text("primary_handle").notNull(),
  primaryPlatform: text("primary_platform", { enum: platformEnum }).notNull(),
  avatarUrl: text("avatar_url"),
  city: text("city"),
  country: char("country", { length: 2 }),
  niches: text("niches").array().notNull().default([]),
  /** Niche classification (0054): `niches` stays the searched labels; these say how they were reached. */
  nicheMain: text("niche_main"),
  nicheStatus: text("niche_status", { enum: ["classified", "variety", "unknown"] }),
  nicheConfidence: text("niche_confidence", { enum: ["high", "medium", "low"] }),
  nicheAssessedAt: ts("niche_assessed_at"),
  /** Country by source (0054); `country` is the resolved value: confirmed, else stated, else platform-declared. */
  platformCountry: char("platform_country", { length: 2 }),
  statedCountry: char("stated_country", { length: 2 }),
  confirmedCountry: char("confirmed_country", { length: 2 }),
  /** Country from a public record (0067): curated seed manifest or staff, with its source URL. */
  publicCountry: char("public_country", { length: 2 }),
  publicCountrySource: text("public_country_source"),
  publicCountryAt: ts("public_country_at"),
  countrySource: text("country_source", { enum: ["creator_confirmed", "creator_stated", "platform_declared", "public_record", "linked_profile"] }),
  countryConfidence: text("country_confidence", { enum: ["high", "medium", "low"] }),
  countryCheckedAt: ts("country_checked_at"),
  tags: text("tags").array().notNull().default([]),
  nameVariants: text("name_variants").array().notNull().default([]),
  verified: boolean("verified").notNull().default(false),
  authenticityScore: smallint("authenticity_score"),
  fakeFollowerPct: doublePrecision("fake_follower_pct"),
  aiSummary: text("ai_summary"),
  aiSummaryModel: text("ai_summary_model"),
  aiSummaryAt: ts("ai_summary_at"),
  aiSummarySourceHash: text("ai_summary_source_hash"),
  aiSummaryFailedAt: ts("ai_summary_failed_at"),
  isMinor: boolean("is_minor").notNull().default(false),
  minorOverrideByStaffId: uuid("minor_override_by_staff_id"),
  minorOverrideReason: text("minor_override_reason"),
  status: text("status", { enum: ["active", "merged", "removal_requested", "erased"] }).notNull().default("active"),
  mergedIntoId: uuid("merged_into_id"),
  lastEnrichedAt: ts("last_enriched_at"),
  minorReason: text("minor_reason"),
  minorFlaggedAt: ts("minor_flagged_at"),
  assessmentStatus: text("assessment_status", { enum: ["assessed", "pending", "insufficient_data"] }),
  avatarKey: text("avatar_key"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creatorProfiles = gcp.table("creator_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  platform: text("platform", { enum: platformEnum }).notNull(),
  handle: text("handle").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  followers: integer("followers"),
  following: integer("following"),
  posts: integer("posts"),
  engagementRate: doublePrecision("engagement_rate"),
  avgLikes: integer("avg_likes"),
  avgComments: integer("avg_comments"),
  avgViews: integer("avg_views"),
  bio: text("bio"),
  followersUpdatedAt: ts("followers_updated_at"),
  engagementUpdatedAt: ts("engagement_updated_at"),
  audienceUpdatedAt: ts("audience_updated_at"),
  lastScrapedAt: ts("last_scraped_at"),
  /** Latest public post seen (eligibility activity evidence); null when not known. */
  lastPostAt: ts("last_post_at"),
  /** Availability as the providers last showed it (0057); see the migration for each state. */
  availability: text("availability", { enum: ["available", "temporarily_unavailable", "missing_unconfirmed", "not_found", "private"] }).notNull().default("available"),
  availabilityCheckedAt: ts("availability_checked_at"),
  missingSince: ts("missing_since"),
  /** This profile's own country (0060; Pakistan-only catalogue). Absent or not Pakistani = not shown to customers. */
  country: text("country"),
  countrySource: text("country_source", { enum: ["creator_confirmed", "creator_stated", "platform_declared", "public_record", "linked_profile"] }),
  countryStatus: text("country_status", { enum: ["pakistan", "foreign", "unknown", "conflicting"] }).notNull().default("unknown"),
  countryReason: text("country_reason"),
  countryConfidence: text("country_confidence", { enum: ["high", "medium", "low"] }),
  countryCheckedAt: ts("country_checked_at"),
  /** Typical content performance (0066, elig-3): medians of the latest 10 non-pinned items of one fetch. */
  medianViews: integer("median_views"),
  medianEngagementRate: doublePrecision("median_engagement_rate"),
  performanceViewsSample: smallint("performance_views_sample"),
  performanceEngagementSample: smallint("performance_engagement_sample"),
  performanceFormat: text("performance_format", { enum: ["reel", "video"] }),
  performanceFrom: ts("performance_from"),
  performanceTo: ts("performance_to"),
  performanceAt: ts("performance_at"),
  /** Geotag place names of the latest fetched posts (0068). */
  postLocations: text("post_locations").array(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creatorContacts = gcp.table("creator_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  kind: text("kind", { enum: ["email", "phone"] }).notNull(),
  valueEncrypted: text("value_encrypted").notNull(),
  valueHash: text("value_hash").notNull(),
  masked: text("masked").notNull(),
  trust: text("trust", { enum: ["verified", "likely", "unverified"] }).notNull().default("unverified"),
  source: text("source").notNull(),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  lastVerifiedAt: ts("last_verified_at"),
  /** What has been established about the contact (migration 0032); `trust` says where it came from. */
  status: text("status", { enum: ["unverified", "domain_ok", "invalid", "verified"] }).notNull().default("unverified"),
  checkedAt: ts("checked_at"),
  checkDetail: text("check_detail"),
});

/** Evidence of every contact check (migration 0032); deleted with the contact. */
export const contactChecks = gcp.table("contact_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  creatorId: uuid("creator_id").notNull(),
  requestedByWorkspaceId: uuid("requested_by_workspace_id"),
  method: text("method", { enum: ["format_domain_mx"] }).notNull(),
  result: text("result", { enum: ["domain_ok", "invalid", "check_failed"] }).notNull(),
  detail: text("detail").notNull(),
  checkedAt: ts("checked_at").notNull().defaultNow(),
});

export const enrichmentSnapshots = gcp.table("enrichment_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  verdict: text("verdict").notNull(),
  authenticityScore: smallint("authenticity_score"),
  evidenceBreakdown: jsonb("evidence_breakdown").$type<EvidenceRow[]>().notNull().default([]),
  audience: jsonb("audience").$type<AudienceRow>(),
  modelVersion: text("model_version").notNull(),
  confidence: doublePrecision("confidence"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const niches = platform.table("niches", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
});

export const searchSettings = platform.table("search_settings", {
  id: boolean("id").primaryKey().default(true),
  weightText: integer("weight_text").notNull(),
  weightFilters: integer("weight_filters").notNull(),
  weightEngagement: integer("weight_engagement").notNull(),
  weightAuthenticity: integer("weight_authenticity").notNull(),
  weightFreshness: integer("weight_freshness").notNull(),
  labelBest: integer("label_best").notNull(),
  labelStrong: integer("label_strong").notNull(),
  labelPossible: integer("label_possible").notNull(),
  freshCurrentDays: integer("fresh_current_days").notNull(),
  freshAgingDays: integer("fresh_aging_days").notNull(),
  candidatePool: integer("candidate_pool").notNull(),
  pageSize: integer("page_size").notNull(),
  fewResults: integer("few_results").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const summaryRequests = platform.table(
  "summary_requests",
  {
    creatorId: uuid("creator_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    requestedAt: ts("requested_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.creatorId, t.sourceHash] })],
);

export const contactReveals = wp.table(
  "contact_reveals",
  {
    workspaceId: uuid("workspace_id").notNull(),
    creatorId: uuid("creator_id").notNull(),
    revealedBy: uuid("revealed_by").notNull(),
    ledgerReservationId: uuid("ledger_reservation_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.creatorId] })],
);

export const audienceViews = wp.table(
  "audience_views",
  {
    workspaceId: uuid("workspace_id").notNull(),
    creatorId: uuid("creator_id").notNull(),
    month: date("month", { mode: "string" }).notNull(),
    viewedBy: uuid("viewed_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.creatorId, t.month] })],
);

export const savedSearches = wp.table("saved_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  queryText: text("query_text").notNull().default(""),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const profileMetricSnapshots = gcp.table("profile_metric_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull(),
  followers: integer("followers"),
  following: integer("following"),
  posts: integer("posts"),
  engagementRate: doublePrecision("engagement_rate"),
  avgLikes: integer("avg_likes"),
  avgComments: integer("avg_comments"),
  avgViews: integer("avg_views"),
  rawPayloadId: uuid("raw_payload_id"),
  capturedAt: ts("captured_at").notNull().defaultNow(),
});

export const creatorLinks = gcp.table("creator_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  platform: text("platform", { enum: ["instagram", "tiktok", "youtube", "website"] }).notNull(),
  url: text("url").notNull(),
  source: text("source", { enum: ["bio", "profile_link"] }).notNull(),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
});

export const rawPayloads = platform.table("raw_payloads", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider", { enum: ["apify", "youtube"] }).notNull(),
  platform: text("platform", { enum: platformEnum }).notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  creatorId: uuid("creator_id"),
  jobId: uuid("job_id"),
  storageKey: text("storage_key").notNull(),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
  deleteAfter: ts("delete_after").notNull(),
});

export type EngagementBenchmarks = Record<"instagram" | "tiktok" | "youtube", { per: "followers" | "views"; viewsLow: number; tiers: [number, number, number][] }>;

export const enrichmentSettings = platform.table("enrichment_settings", {
  id: boolean("id").primaryKey().default(true),
  rawRetentionDays: integer("raw_retention_days").notNull(),
  refreshMinAgeHours: integer("refresh_min_age_hours").notNull(),
  reuseWindowMinutes: integer("reuse_window_minutes").notNull(),
  recentPosts: integer("recent_posts").notNull(),
  tiktokRecentVideos: integer("tiktok_recent_videos").notNull(),
  minPostsForScore: integer("min_posts_for_score").notNull(),
  growthMinDays: integer("growth_min_days").notNull(),
  scoreBand: integer("score_band").notNull(),
  stuckJobMinutes: integer("stuck_job_minutes").notNull(),
  engagementBenchmarks: jsonb("engagement_benchmarks").$type<EngagementBenchmarks>().notNull(),
  modelVersion: text("model_version").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const removalRequests = gcp.table("removal_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  urls: text("urls").array().notNull(),
  creatorId: uuid("creator_id"),
  requesterEmailEncrypted: text("requester_email_encrypted"),
  reason: text("reason"),
  status: text("status", { enum: ["received", "processed", "rejected"] }).notNull().default("received"),
  staffNote: text("staff_note"),
  handledByStaffId: uuid("handled_by_staff_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

export const creatorSuppressions = gcp.table("creator_suppressions", {
  urlHash: text("url_hash").primaryKey(),
  platform: text("platform", { enum: platformEnum }).notNull(),
  removalRequestId: uuid("removal_request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Evidence and provenance for creator attributes (0052): supported, weak or conflicting observations with a quote. */
export const creatorAttributeEvidence = gcp.table("creator_attribute_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  attribute: text("attribute", { enum: ["city", "country", "niche", "language"] }).notNull(),
  value: text("value").notNull(),
  source: text("source", { enum: ["profile_text", "post_text", "platform_registration", "ai_assessment", "display_name", "account_category"] }).notNull(),
  status: text("status", { enum: ["supported", "weak", "conflicting"] }).notNull(),
  evidence: text("evidence").notNull(),
  payloadId: uuid("payload_id"),
  observedAt: ts("observed_at").notNull().defaultNow(),
});

/** Every creator lifecycle transition with its reason, source and action (0057). Append-only for the app roles. */
export const creatorLifecycleEvents = gcp.table("creator_lifecycle_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull(),
  profileId: uuid("profile_id"),
  kind: text("kind", { enum: ["availability", "retention", "location", "removal", "eligibility"] }).notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  reason: text("reason").notNull(),
  source: text("source", { enum: ["enrichment", "refresh_job", "lifecycle_sweep", "retention_job", "staff", "backfill"] }).notNull(),
  action: text("action").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
