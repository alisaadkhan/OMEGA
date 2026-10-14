import { z } from "zod";
import { creatorCardSchema, creatorPlatformSchema, searchFiltersSchema } from "./search";

const iso = z.iso.datetime();

export const discoveryJobKindSchema = z.enum(["add_by_url", "refresh", "live"]);
export const discoveryJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const discoveryJobStepSchema = z.enum(["searching", "filtering", "fetching", "archiving", "cleaning", "assessing", "saving"]);
export type DiscoveryJobStep = z.output<typeof discoveryJobStepSchema>;
export const liveDiscoveryOutcomeSchema = z.enum(["succeeded", "completed_empty", "insufficient", "partial", "failed", "canceled", "expired"]);
export const liveDiscoveryProgressSchema = z.object({
  serpResultsSeen: z.number().int().nonnegative(),
  profileCandidates: z.number().int().nonnegative(),
  afterDedupe: z.number().int().nonnegative(),
  snippetGatePass: z.number().int().nonnegative(),
  ambiguousCandidates: z.number().int().nonnegative(),
  extractedProfiles: z.number().int().nonnegative(),
  validIndividualCreators: z.number().int().nonnegative(),
  qualifiedCreators: z.number().int().nonnegative(),
  persistedResults: z.number().int().nonnegative(),
  billableCreators: z.number().int().nonnegative(),
});

const liveFiltersSchema = searchFiltersSchema.safeExtend({ niches: z.array(z.string().trim().min(1).max(40)).max(5).default([]) });
export const liveSearchSchema = z.object({ text: z.string().trim().max(500).default(""), filters: liveFiltersSchema });
export type LiveSearch = z.output<typeof liveSearchSchema>;
export const liveRunSizeSchema = z.union([z.literal(5), z.literal(10), z.literal(15)]);
export type LiveRunSize = z.output<typeof liveRunSizeSchema>;

const GENERIC = new Set("creator creators influencer influencers people person account accounts profile profiles blogger bloggers vlogger vloggers best top find new social media content popular famous some any all the and in of for with from ke ki ka instagram tiktok youtube".split(" "));
const TOPICS = ["food", "foodie", "food blogger", "street food", "skincare", "skin care", "beauty", "makeup", "makeup artist", "fashion", "bridal", "tech", "technology", "gadgets", "fitness", "gym", "workout", "travel", "travel vlogger", "northern areas", "hiking", "کھانا", "فوڈ", "فیشن", "سفر"];
const PLACES = ["lahore", "lahori", "lhr", "لاہور", "karachi", "khi", "کراچی", "islamabad", "isb", "اسلام آباد", "rawalpindi", "pindi", "peshawar", "faisalabad", "fsd", "multan", "quetta", "sialkot", "gujranwala"];
const COUNTRIES = ["pakistan", "pakistani", "pk", "پاکستان"];
const LANGUAGES = ["urdu", "اردو", "roman urdu", "english", "punjabi", "pashto"];

function normalizedWords(value: string): string[] {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/u).filter(Boolean);
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const normalized = ` ${normalizedWords(text).join(" ")} `;
  return phrases.some((phrase) => normalized.includes(` ${normalizedWords(phrase).join(" ")} `));
}

/** The same deterministic gate is called for estimates and again when the estimate is consumed. */
export function validateLiveBrief(search: LiveSearch): { ok: boolean; specificity: number; missingRequirements: string[] } {
  const text = search.text;
  const words = normalizedWords(text);
  const placeInText = hasPhrase(text, PLACES);
  const countryInText = hasPhrase(text, COUNTRIES);
  const languageInText = hasPhrase(text, LANGUAGES);
  const selectedTopic = search.filters.niches.some((niche) => normalizedWords(niche).some((word) => word.length >= 3 && !GENERIC.has(word)));
  const recognizedTopic = hasPhrase(text, TOPICS);
  const reserved = new Set([...PLACES, ...COUNTRIES, ...LANGUAGES].flatMap(normalizedWords));
  const free = words.filter((word) => !GENERIC.has(word) && !reserved.has(word) && word.length >= 3 && !/^\d+[km]?$/.test(word));
  const freeTopic = free.length >= 2 || free.some((word) => word.length >= 5);
  const topic = selectedTopic || recognizedTopic || freeTopic;
  const city = Boolean(search.filters.creatorCity) || placeInText;
  const country = Boolean(search.filters.creatorCountry) || countryInText;
  const language = languageInText;
  let specificity = topic ? (selectedTopic || recognizedTopic ? 2 : 1.5) : 0;
  if (city) specificity += 1;
  else if (country) specificity += 0.5;
  if (language) specificity += 0.5;
  if (search.filters.platform) specificity += 0.5;
  if (search.filters.followersMin !== undefined && search.filters.followersMax !== undefined) specificity += 0.5;
  else if (search.filters.followersMin !== undefined || search.filters.followersMax !== undefined) specificity += 0.25;

  const missingRequirements: string[] = [];
  if (!topic) missingRequirements.push("topic");
  if (!city && !country && !language) missingRequirements.push("location_or_language");
  if (topic && (city || country || language) && specificity < 2.5) missingRequirements.push("specificity");
  return { ok: missingRequirements.length === 0 && specificity >= 2.5, specificity, missingRequirements };
}

export const createLiveEstimateSchema = z.object({ search: liveSearchSchema, maxNew: liveRunSizeSchema });
export type CreateLiveEstimate = z.output<typeof createLiveEstimateSchema>;
export const liveEstimateSchema = z.object({
  estimateId: z.uuid(),
  maxCredits: z.number().int().positive(),
  /** Least charged when the run succeeds with at least one result (TikTok in scope); absent = base fee + per creator. */
  minimumCredits: z.number().int().positive().optional(),
  priceVersion: z.string().min(1),
  expiresAt: iso,
});
export type LiveEstimate = z.output<typeof liveEstimateSchema>;

export const startDiscoveryJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_by_url"), url: z.string().trim().min(3).max(500), confirmedCost: z.number().int().min(1) }),
  z.object({ kind: z.literal("refresh"), creatorId: z.uuid(), confirmedCost: z.number().int().min(1) }),
  z.object({ kind: z.literal("live"), estimateId: z.uuid() }),
]);
export type StartDiscoveryJob = z.output<typeof startDiscoveryJobSchema>;

export const discoveryJobSchema = z.object({
  id: z.uuid(),
  kind: discoveryJobKindSchema,
  status: discoveryJobStatusSchema,
  step: discoveryJobStepSchema.nullable(),
  outcome: z.enum(["created", "refreshed", "reused", ...liveDiscoveryOutcomeSchema.options]).nullable(),
  creatorId: z.uuid().nullable(),
  platform: creatorPlatformSchema.nullable(),
  handle: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
  /** The customer asked a live run to stop; it stops at the next safe point and settles what was delivered. */
  cancelRequested: z.boolean(),
  /** Live runs only: the search, its size and progress counters (found = new + known). */
  live: z
    .object({
      search: liveSearchSchema,
      maxNew: z.number().int(),
      found: z.number().int().nonnegative(),
      new: z.number().int().nonnegative(),
      known: z.number().int().nonnegative(),
      maxCost: z.number().int().nonnegative(),
      creditsCharged: z.number().int().nonnegative(),
      progress: liveDiscoveryProgressSchema,
    })
    .nullable(),
});
export type DiscoveryJob = z.output<typeof discoveryJobSchema>;

export const startDiscoveryJobResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("started"), job: discoveryJobSchema }),
  z.object({ status: z.literal("known"), creatorId: z.uuid() }),
  z.object({ status: z.literal("up_to_date"), creatorId: z.uuid(), updatedAt: iso }),
]);
export type StartDiscoveryJobResponse = z.output<typeof startDiscoveryJobResponseSchema>;

export const discoveryJobListSchema = z.object({ jobs: z.array(discoveryJobSchema) });

/** A creator a live run returned: Brain 1's card plus where it came from (spec §6). */
export const discoveryResultSchema = creatorCardSchema.extend({
  seq: z.number().int().positive(),
  rank: z.number().int().nonnegative(),
  isNew: z.boolean(),
  reason: z.string().nullable(),
  campaignFit: z.object({
    version: z.string(), score: z.number().int().min(0).max(100).nullable(), confidence: z.number().min(0).max(1),
    eligible: z.boolean(), gate: z.string().nullable(), topicScore: z.number().min(0).max(1).nullable(), sampleSize: z.number().int().nonnegative(), sourceUrl: z.url(), fetchedAt: iso, evidence: z.array(z.string()),
  }).nullable(),
});
export type DiscoveryResult = z.output<typeof discoveryResultSchema>;
export const discoveryResultsResponseSchema = z.object({ results: z.array(discoveryResultSchema), done: z.boolean() });
