import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info");
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string")
  .refine((v) => !/@host:\d+\//.test(v), "is still the placeholder value; paste the real connection string");

/** Settings both the API and the worker need. */
const sharedObject = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  APP_URL: z.url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.url().default("http://localhost:4000"),
  // Path the host mounts the API under (Vercel: /api; the rewrite keeps the path). Empty: the API is at its root.
  API_PATH_PREFIX: z.string().regex(/^(\/[a-z0-9-]+)*$/, "empty, or a path like /api").default(""),
  DATABASE_SSL_CA_FILE: z.string().optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_CLIENT_TOKEN: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MOCK_PADDLE_WEBHOOK_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  CATALOG_SEARCH_BACKEND: z.enum(["postgres", "meilisearch"]).default("postgres"),
  // Owner decision 2026-10-20: v1 is the frozen query understanding (default until a rating round accepts v2).
  SEARCH_PROFILE: z.enum(["v1", "v2"]).default("v1"),
  // Owner decision 2026-10-19: a free trial starts only when staff approve it. "automatic" restores trial-at-sign-up.
  TRIAL_ACTIVATION: z.enum(["approval", "automatic"]).default("approval"),
  // MUSHIN-derived metrics from YouTube API data (DATA-004): off until the owner confirms policy eligibility.
  YOUTUBE_DERIVED_METRICS: z.enum(["on", "off"]).default("off"),
  // How enrichment stores niche, country and city (owner instruction 2026-10-26), separate from SEARCH_PROFILE (which
  // only chooses query understanding). "evidence": stored from evidence with provenance; "legacy": the AI's reading.
  ENRICHMENT_ATTRIBUTE_POLICY: z.enum(["evidence", "legacy"]).default("evidence"),
  // YouTube video titles/descriptions as niche, city and language evidence, and contacts read from a channel's
  // description: off until the owner confirms Roster's YouTube API use case allows them (Developer Policies III.E.4.h,
  // YouTube Terms "collect information that might identify a person"). Existing stored data is not deleted by this.
  YOUTUBE_CONTENT_EVIDENCE: z.enum(["on", "off"]).default("off"),
  YOUTUBE_DESCRIPTION_CONTACTS: z.enum(["on", "off"]).default("off"),
  // Owner decision 2026-10-26: no new YouTube Data API calls (channel fetches, video search, audience) while the YouTube
  // policy decision is pending. Off withholds the key from every YouTube adapter, so no request can be made; YouTube
  // jobs then fail as "not configured" and are refunded. Retention purges of stored YouTube data keep running.
  YOUTUBE_API_CALLS: z.enum(["on", "off"]).default("off"),
  // Semantic (AI) niche reading when the rules cannot read the evidence clearly; needs a configured LLM.
  NICHE_SEMANTIC: z.enum(["on", "off"]).default("on"),
  // Audience estimate sources, comma-separated; empty (the default) turns the feature off. Only "youtube" exists, and it
  // may be enabled only once MUSHIN may derive metrics from YouTube API data (Developer Policies III.E.2, III.E.4.h, L).
  AUDIENCE_SOURCES: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.literal("youtube"))),
  MEILISEARCH_HOST: z.url().optional(),
  MEILISEARCH_API_KEY: z.string().min(1).optional(),
  MEILISEARCH_SEARCH_KEY: z.string().min(1).optional(),
  MEILISEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9_]*$/, "lowercase letters, digits and _ only").default(""),
  // Gemini (main provider, owner decision 2026-10-26) through its OpenAI-compatible endpoint. No model or price is
  // assumed: set both from https://ai.google.dev/gemini-api/docs/models and /pricing. GEMINI_BILLING=paid confirms the
  // key belongs to a billed project: unpaid-tier prompts may be used by Google to improve its products, which is not
  // acceptable for creator data.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  GEMINI_BASE_URL: z.url().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  GEMINI_PRICE_IN_PER_MTOK: z.coerce.number().min(0).optional(),
  GEMINI_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).optional(),
  GEMINI_BILLING: z.enum(["paid"]).optional(),
  // Ollama Cloud gpt-oss:20b pay-as-you-go price (ollama.com/pricing, checked 2026-10-14). Plans include usage credits,
  // but usage is still recorded at the per-token price so paid fallback traffic is never booked as free.
  OLLAMA_API_KEY: z.string().min(1).optional(),
  OLLAMA_BASE_URL: z.url().default("https://ollama.com/v1"),
  OLLAMA_MODEL: z.string().min(1).default("gpt-oss:20b"),
  OLLAMA_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.07),
  OLLAMA_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0.3),
  // Monthly cap on hosted-LLM spend across Gemini and Ollama (USD). Required in production (owner decision 2026-10-14);
  // local and staging use USD 5 when unset. 0 refuses every AI call; no value disables the cap.
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),
});
type SharedValues = z.output<typeof sharedObject>;

const PADDLE_KEYS = ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET"] as const;

const LLM_KEYS = {
  GEMINI_API_KEY: true, GEMINI_MODEL: true, GEMINI_BASE_URL: true, GEMINI_PRICE_IN_PER_MTOK: true, GEMINI_PRICE_OUT_PER_MTOK: true, GEMINI_BILLING: true,
  OLLAMA_API_KEY: true, OLLAMA_BASE_URL: true, OLLAMA_MODEL: true, OLLAMA_PRICE_IN_PER_MTOK: true, OLLAMA_PRICE_OUT_PER_MTOK: true,
} as const;
type LlmValues = Pick<SharedValues, keyof typeof LLM_KEYS>;

function checkGemini(v: LlmValues, ctx: z.RefinementCtx) {
  if (v.GEMINI_API_KEY) {
    for (const key of ["GEMINI_MODEL", "GEMINI_PRICE_IN_PER_MTOK", "GEMINI_PRICE_OUT_PER_MTOK"] as const) {
      if (v[key] === undefined) ctx.addIssue({ code: "custom", path: [key], message: "is required with GEMINI_API_KEY (from Google's model and pricing pages; no value is assumed)" });
    }
    if (v.GEMINI_BILLING !== "paid") {
      ctx.addIssue({ code: "custom", path: ["GEMINI_BILLING"], message: "set GEMINI_BILLING=paid to confirm the key belongs to a billed project (unpaid-tier prompts may be used to improve Google's products)" });
    }
  }
}

function checkShared(v: SharedValues, ctx: z.RefinementCtx) {
  checkGemini(v, ctx);
  if (v.NODE_ENV === "production" && v.LLM_MONTHLY_BUDGET_USD === undefined) {
    ctx.addIssue({ code: "custom", path: ["LLM_MONTHLY_BUDGET_USD"], message: "is required in production: set the monthly AI spend cap explicitly (USD)" });
  }
  if (v.NODE_ENV === "production" && !v.DATABASE_SSL_CA_FILE) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_SSL_CA_FILE"], message: "is required in production so database TLS certificates are verified" });
  }
  const missingPaddle = PADDLE_KEYS.filter((key) => !v[key]);
  if (missingPaddle.length > 0 && missingPaddle.length < PADDLE_KEYS.length) {
    for (const key of missingPaddle) {
      ctx.addIssue({ code: "custom", path: [key], message: "set all three Paddle values (PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_WEBHOOK_SECRET) or none" });
    }
  }
  if (missingPaddle.length === PADDLE_KEYS.length) {
    if (v.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["PADDLE_API_KEY"], message: "is required in production: the mock payment provider is for development only" });
    } else if (!v.MOCK_PADDLE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["MOCK_PADDLE_WEBHOOK_SECRET"], message: "is required while Paddle keys are not set (run npm run env:secrets)" });
    }
  }
  if (v.NODE_ENV === "production" && v.CATALOG_SEARCH_BACKEND === "meilisearch" && (!v.MEILISEARCH_HOST || !v.MEILISEARCH_API_KEY || !v.MEILISEARCH_SEARCH_KEY)) {
    ctx.addIssue({ code: "custom", path: ["MEILISEARCH_HOST"], message: "is required in production with MEILISEARCH_API_KEY and MEILISEARCH_SEARCH_KEY" });
  }
}

const encryptionKey = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded");

const apiSchema = sharedObject
  .extend({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    ALLOWED_PREVIEW_ORIGINS: z.string().default(""),
    DATABASE_URL: postgresUrl,
    SUPABASE_URL: z.url(),
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1).default("authenticated"),
    JWKS_URI: z.url(),
    STAFF_JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    DATA_ENCRYPTION_KEY: encryptionKey,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    // Where counters live: PostgreSQL (shared by every API process); "memory" for development only. Upstash was removed
    // (audit SEC-06, ARCH-03).
    RATE_LIMIT_STORE: z.enum(["postgres", "memory"]).optional(),
    // Proxies whose X-Forwarded-For the API believes (audit SEC-05): comma-separated IPs/CIDRs, or "loopback".
    // Empty (default, development): the client address is the connecting socket and forwarded headers are ignored, so
    // nobody can choose their own rate-limit bucket. Production must state it (mandate v3): the host proxy's addresses,
    // or "none" when nothing stands in front of the API.
    TRUSTED_PROXIES: z.string().default(""),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
    // Supabase Auth admin access (service key): the trusted record of a user's confirmed email (audit SEC-03), used to
    // accept invitations. Required in production; without it invitations cannot be accepted (fail closed).
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    // Outreach email (owner decision 2026-10-16): off by default. "test" records sends through a mock provider and
    // delivers nothing (never in production). "resend" sends for real and needs every key below plus
    // OUTREACH_EMAIL_SENDS_AUTHORIZED=yes, which the owner sets only after authorising real sends.
    OUTREACH_EMAIL_MODE: z.enum(["off", "test", "resend"]).default("off"),
    OUTREACH_EMAIL_FROM: z.string().min(3).max(200).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/, "must be the whsec_ signing secret").optional(),
    OUTREACH_EMAIL_SENDS_AUTHORIZED: z.enum(["yes", "no"]).default("no"),
    // The sender's postal address shown in every outreach email footer (commercial email rules require a physical
    // address of the sender). Required for real sends; test mode shows that it is missing.
    OUTREACH_POSTAL_ADDRESS: z.string().trim().min(10).max(300).optional(),
    // Where alerts go (audit OPS-03): an incoming-webhook URL of the team's chat (Slack- and Discord-compatible JSON).
    // Unset: alerts are only logged (development). Required in production, over HTTPS. The URL is a secret.
    ALERT_WEBHOOK_URL: z.url().optional(),
  })
  .superRefine(checkShared)
  .superRefine((v, ctx) => {
    // The in-memory limiter is per process: several API instances would each allow the full limit.
    if (v.NODE_ENV === "production" && v.RATE_LIMIT_STORE === "memory") {
      ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_STORE"], message: "memory is for development and tests only" });
    }
    if (v.NODE_ENV === "production" && !v.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({ code: "custom", path: ["SUPABASE_SERVICE_ROLE_KEY"], message: "required in production (trusted email verification for invitations)" });
    }
    // Audit ARCH-07: tokens must be checked against the same Supabase project the API talks to for everything else.
    const origin = (u: string) => {
      try {
        return new URL(u).origin;
      } catch {
        return null;
      }
    };
    for (const key of ["JWT_ISSUER", "JWKS_URI"] as const) {
      if (origin(v[key]) && origin(v.SUPABASE_URL) && origin(v[key]) !== origin(v.SUPABASE_URL)) {
        ctx.addIssue({ code: "custom", path: [key], message: "must be on the same Supabase project as SUPABASE_URL" });
      }
    }
    const proxies = v.TRUSTED_PROXIES.split(",").map((p) => p.trim()).filter(Boolean);
    const validProxy = (p: string) => {
      if (p === "loopback") return true;
      const [addr, bits, extra] = p.split("/");
      if (extra !== undefined || !addr || isIP(addr) === 0) return false;
      if (bits === undefined) return true;
      const max = isIP(addr) === 4 ? 32 : 128;
      return /^\d{1,3}$/.test(bits) && Number(bits) <= max;
    };
    if (!(proxies.length === 1 && proxies[0] === "none")) {
      for (const p of proxies) if (!validProxy(p)) ctx.addIssue({ code: "custom", path: ["TRUSTED_PROXIES"], message: `"${p}" is not an IP address, a CIDR range, "loopback" or "none"` });
    }
    if (v.NODE_ENV === "production" && proxies.length === 0) {
      ctx.addIssue({ code: "custom", path: ["TRUSTED_PROXIES"], message: `required in production: the host proxy's addresses or CIDR ranges, or "none" when nothing is in front of the API` });
    }
    if (v.NODE_ENV === "production" && !v.ALERT_WEBHOOK_URL) {
      ctx.addIssue({ code: "custom", path: ["ALERT_WEBHOOK_URL"], message: "required in production so alerts reach a person (audit OPS-03)" });
    }
    if (v.ALERT_WEBHOOK_URL && v.NODE_ENV === "production" && !v.ALERT_WEBHOOK_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["ALERT_WEBHOOK_URL"], message: "must use https" });
    }
    if (v.OUTREACH_EMAIL_MODE === "test" && v.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["OUTREACH_EMAIL_MODE"], message: "test mode delivers nothing and is for development only" });
    }
    if (v.OUTREACH_EMAIL_MODE === "resend") {
      for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "OUTREACH_EMAIL_FROM", "OUTREACH_POSTAL_ADDRESS"] as const) {
        if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when OUTREACH_EMAIL_MODE=resend" });
      }
      if (v.OUTREACH_EMAIL_SENDS_AUTHORIZED !== "yes") {
        ctx.addIssue({ code: "custom", path: ["OUTREACH_EMAIL_SENDS_AUTHORIZED"], message: "real outreach email needs the owner's authorisation (set to yes)" });
      }
    }
  });

const workerSchema = sharedObject
  .extend({
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
    DATA_ENCRYPTION_KEY: encryptionKey,
    APIFY_TOKEN: z.string().min(1).optional(),
    APIFY_INSTAGRAM_ACTOR_ID: z.string().min(1).default("apify/instagram-profile-scraper"),
    APIFY_INSTAGRAM_BUILD: z.string().min(1).optional(),
    APIFY_TIKTOK_ACTOR_ID: z.string().min(1).default("clockworks/tiktok-profile-scraper"),
    APIFY_TIKTOK_BUILD: z.string().min(1).optional(),
    // Instagram post/reel → author for live discovery; set to "off" to disable. Pinned build reviewed 2026-10-13.
    APIFY_INSTAGRAM_POST_ACTOR_ID: z.string().min(1).default("apify/instagram-scraper"),
    APIFY_INSTAGRAM_POST_BUILD: z.string().min(1).optional(),
    // Off by default until the post actor's terms and permitted use are reviewed (2026-10-13); 10 was the tested setting.
    LIVE_CONTENT_RESOLUTION_MAX: z.coerce.number().int().min(0).max(20).default(0),
    // One YouTube Data API video search per live run with YouTube in scope (101 quota units, $0); "off" disables it.
    LIVE_YOUTUBE_SEARCH: z.enum(["video", "off"]).default("video"),
    // Fill-to-size, per platform: fetch up to this multiple of the run size while it is not filled. The customer charge
    // is unchanged (only delivered new creators, never above the quote); provider cost rises. 1 disables extra waves.
    // Defaults from the 2026-10-14 recorded-response replay study (25 briefs, size 5, 1×–4× per platform, cost cap on;
    // docs/readiness/search-quality.md): the smallest multiplier at each platform's yield plateau. Instagram 2× (33 → 45
    // delivered, +USD 0.007 per brief estimated), YouTube 3× (2 → 12, USD 0: API quota). TikTok stays 1×: the
    // recordings cannot measure it (most extra profiles were never recorded). Provisional until human relevance ratings.
    LIVE_EXTRACTION_MULTIPLIER_INSTAGRAM: z.coerce.number().min(1).max(4).default(2),
    LIVE_EXTRACTION_MULTIPLIER_YOUTUBE: z.coerce.number().min(1).max(4).default(3),
    LIVE_EXTRACTION_MULTIPLIER_TIKTOK: z.coerce.number().min(1).max(4).default(1),
    // Profiles a live run processes at the same time (the AI assessment dominates; measured ~6 s per profile).
    LIVE_PROFILE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
    // Per-job cost cap, checked before every extraction batch: a run's provider cost may not pass quoted max credits ×
    // revenue per credit ÷ the cost-to-price ratio (owner rule: price at least 3× cost). Revenue per credit defaults to
    // the cheapest paid credit (Scale tier, before payment fees). A batch takes only the candidates whose estimated
    // profile cost still fits: Instagram USD 0.0026 (measured per profile), TikTok USD 0.011 (one measured 5-profile
    // run, USD 0.054), YouTube USD 0 (Data API). Re-measure before relying on them.
    LIVE_REVENUE_PER_CREDIT_USD: z.coerce.number().positive().default(0.002029),
    LIVE_COST_TO_PRICE_RATIO: z.coerce.number().min(1).default(3),
    LIVE_PROFILE_USD_INSTAGRAM: z.coerce.number().min(0).default(0.0026),
    LIVE_PROFILE_USD_TIKTOK: z.coerce.number().min(0).default(0.011),
    LIVE_PROFILE_USD_YOUTUBE: z.coerce.number().min(0).default(0),
    // Per-job deadline (LIVE-004), minutes from job creation, checked before each extraction batch. Kept below the
    // stuck-job sweep (stuck_job_minutes, default 30), which fails and refunds the whole run. Measured live runs took
    // about 2.5 minutes (2026-10-13). Provisional default; the owner may set another value.
    LIVE_JOB_DEADLINE_MINUTES: z.coerce.number().min(1).max(240).default(20),
    APIFY_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(5),
    YOUTUBE_API_KEY: z.string().min(1).optional(),
    SERPER_API_KEY: z.string().min(1).optional(),
    SERPER_MONTHLY_SEARCH_LIMIT: z.coerce.number().int().min(0).default(2500),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    checkShared(v, ctx);
    if (v.NODE_ENV !== "production") return;
    for (const key of ["APIFY_TOKEN", "YOUTUBE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SERPER_API_KEY"] as const) {
      if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production (creator data pipeline and live discovery)" });
    }
  });

/** Reads the database CA certificate (PEM). Returns null when no path is configured. */
export function readCaFile(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new ConfigError([`DATABASE_SSL_CA_FILE: cannot read ${path}`]);
  }
}

function clean(env: Env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === undefined || v.trim() === "" ? undefined : v.trim();
  return out;
}

function parse<S extends z.ZodType>(schema: S, env: Env): z.output<S> {
  const result = schema.safeParse(clean(env));
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

export type PaymentsConfig =
  | { mode: "mock"; webhookSecret: string; appUrl: string; publicApiUrl: string }
  | {
      mode: "paddle";
      apiKey: string;
      clientToken: string;
      webhookSecret: string;
      environment: "sandbox" | "production";
      appUrl: string;
      publicApiUrl: string;
    };

function paymentsFrom(v: SharedValues): PaymentsConfig {
  const appUrl = new URL(v.APP_URL).origin;
  const publicApiUrl = v.PUBLIC_API_URL.replace(/\/+$/, "");
  if (v.PADDLE_API_KEY && v.PADDLE_CLIENT_TOKEN && v.PADDLE_WEBHOOK_SECRET) {
    return {
      mode: "paddle",
      apiKey: v.PADDLE_API_KEY,
      clientToken: v.PADDLE_CLIENT_TOKEN,
      webhookSecret: v.PADDLE_WEBHOOK_SECRET,
      environment: v.PADDLE_ENVIRONMENT,
      appUrl,
      publicApiUrl,
    };
  }
  // checkShared guarantees the mock secret outside production.
  return { mode: "mock", webhookSecret: v.MOCK_PADDLE_WEBHOOK_SECRET ?? "", appUrl, publicApiUrl };
}



/** Enrichment policy (owner instruction 2026-10-26), independent of SEARCH_PROFILE. */
export type EnrichmentPolicy = { attributePolicy: "evidence" | "legacy"; youtubeContentEvidence: boolean; youtubeDescriptionContacts: boolean; semanticNiche: boolean };

export type SearchConfig = { host: string; apiKey: string; indexPrefix: string } | null;
export type LlmProviderConfig = {
  name: "gemini" | "ollama";
  baseUrl: string;
  apiKey: string;
  model: string;
  priceInPerMTok: number;
  priceOutPerMTok: number;
};

function searchFrom(v: SharedValues, key: string | undefined): SearchConfig {
  if (!v.MEILISEARCH_HOST || !key) return null;
  return { host: v.MEILISEARCH_HOST.replace(/\/+$/, ""), apiKey: key, indexPrefix: v.MEILISEARCH_INDEX_PREFIX };
}

/** Gemini first, Ollama Cloud as the fallback when Gemini fails (owner decision 2026-10-26; was Groq, SRS §3.3). */
function llmFrom(v: LlmValues): LlmProviderConfig[] {
  const out: LlmProviderConfig[] = [];
  // checkShared guarantees the model, prices and paid billing whenever the key is set.
  if (v.GEMINI_API_KEY && v.GEMINI_MODEL && v.GEMINI_PRICE_IN_PER_MTOK !== undefined && v.GEMINI_PRICE_OUT_PER_MTOK !== undefined && v.GEMINI_BILLING === "paid") {
    out.push({
      name: "gemini",
      baseUrl: v.GEMINI_BASE_URL.replace(/\/+$/, ""),
      apiKey: v.GEMINI_API_KEY,
      model: v.GEMINI_MODEL,
      priceInPerMTok: v.GEMINI_PRICE_IN_PER_MTOK,
      priceOutPerMTok: v.GEMINI_PRICE_OUT_PER_MTOK,
    });
  }
  if (v.OLLAMA_API_KEY) {
    out.push({
      name: "ollama",
      baseUrl: v.OLLAMA_BASE_URL.replace(/\/+$/, ""),
      apiKey: v.OLLAMA_API_KEY,
      model: v.OLLAMA_MODEL,
      priceInPerMTok: v.OLLAMA_PRICE_IN_PER_MTOK,
      priceOutPerMTok: v.OLLAMA_PRICE_OUT_PER_MTOK,
    });
  }
  return out;
}

export type ScrapingConfig = {
  apifyToken: string | null;
  instagramActor: string;
  instagramBuild: string | null;
  tiktokActor: string;
  tiktokBuild: string | null;
  /** Live discovery resolves Instagram post/reel authors with this actor; null disables it. */
  instagramPostActor: string | null;
  instagramPostBuild: string | null;
  /** Most post links resolved per live run (0 disables). */
  contentResolutionMax: number;
  /** Live discovery also searches YouTube videos through the Data API. */
  youtubeSearch: boolean;
  /** Per platform: profiles fetched per live run as a multiple of the run size while it is not filled (1 = the size). */
  extractionMultiplier: { instagram: number; youtube: number; tiktok: number };
  /** Profiles a live run processes at the same time. */
  profileConcurrency: number;
  /** Before every batch: a run's provider cost may not pass quoted max credits × revenuePerCreditUsd ÷ costToPriceRatio. */
  jobCostCap: { revenuePerCreditUsd: number; costToPriceRatio: number; profileUsd: { instagram: number; tiktok: number; youtube: number } };
  /** Before every extraction batch: no new batch once this many milliseconds have passed since the job was created. */
  jobDeadlineMs: number;
  apifyMonthlyBudgetUsd: number;
  youtubeApiKey: string | null;
  serperApiKey: string | null;
  serperMonthlySearchLimit: number;
};
export type StorageConfig = { url: string; serviceKey: string } | null;

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: LogLevel;
  port: number;
  appUrl: string;
  /** Public mount path of the API ("" or e.g. "/api"); see API_PATH_PREFIX. */
  pathPrefix: string;
  allowedOrigins: string[];
  databaseUrl: string;
  auth: { issuer: string; audience: string; jwksUri: string };
  staffJwtSecret: string;
  /** Staff hardware keys: bound to the app's own origin (the admin console is served there, never from previews). */
  webauthn: { rpId: string; rpName: string; origins: string[] };
  dataEncryptionKey: Buffer;
  rateLimit: { windowMs: number; maxRequests: number; store: "postgres" | "memory" };
  idempotencyTtlHours: number;
  databaseCaPem: string | null;
  payments: PaymentsConfig;
  catalogSearchBackend: "postgres" | "meilisearch";
  searchProfile: "v1" | "v2";
  trialActivation: "approval" | "automatic";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  audienceSources: "youtube"[];
  outreachEmail: OutreachEmailConfig;
  /** Incoming-webhook URL for alerts (audit OPS-03); null = logged only. */
  alertWebhookUrl: string | null;
  /** Proxies trusted for X-Forwarded-For (audit SEC-05); empty = none. */
  trustedProxies: string[];
  /** Supabase Auth admin access for trusted email checks (audit SEC-03); null when not configured. */
  authAdmin: { url: string; serviceKey: string } | null;
};

export type OutreachEmailConfig =
  | { mode: "off" }
  | { mode: "test"; from: string; postalAddress: string | null }
  | { mode: "resend"; from: string; apiKey: string; webhookSecret: string; postalAddress: string };

/** Only the hosted-LLM providers (for the manual smoke test): no database URL or other secret is read. */
export function loadLlmConfig(env: Env): LlmProviderConfig[] {
  return llmFrom(parse(sharedObject.pick(LLM_KEYS).superRefine(checkGemini), env));
}

export function loadApiConfig(env: Env): ApiConfig {
  const v = parse(apiSchema, env);
  const previews = v.ALLOWED_PREVIEW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const appUrl = new URL(v.APP_URL).origin;
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    port: v.PORT,
    appUrl,
    pathPrefix: v.API_PATH_PREFIX,
    allowedOrigins: [appUrl, ...previews],
    databaseUrl: v.DATABASE_URL,
    auth: { issuer: v.JWT_ISSUER, audience: v.JWT_AUDIENCE, jwksUri: v.JWKS_URI },
    staffJwtSecret: v.STAFF_JWT_SECRET,
    webauthn: { rpId: new URL(appUrl).hostname, rpName: "MUSHIN staff", origins: [appUrl] },
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    rateLimit: { windowMs: v.RATE_LIMIT_WINDOW_MS, maxRequests: v.RATE_LIMIT_MAX_REQUESTS, store: v.RATE_LIMIT_STORE ?? "postgres" },
    idempotencyTtlHours: v.IDEMPOTENCY_TTL_HOURS,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    payments: paymentsFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    searchProfile: v.SEARCH_PROFILE,
    trialActivation: v.TRIAL_ACTIVATION,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_SEARCH_KEY),
    llm: llmFrom(v),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    outreachEmail:
      v.OUTREACH_EMAIL_MODE === "resend" && v.RESEND_API_KEY && v.RESEND_WEBHOOK_SECRET && v.OUTREACH_EMAIL_FROM && v.OUTREACH_POSTAL_ADDRESS
        ? { mode: "resend", from: v.OUTREACH_EMAIL_FROM, apiKey: v.RESEND_API_KEY, webhookSecret: v.RESEND_WEBHOOK_SECRET, postalAddress: v.OUTREACH_POSTAL_ADDRESS }
        : v.OUTREACH_EMAIL_MODE === "test"
          ? { mode: "test", from: v.OUTREACH_EMAIL_FROM ?? "MUSHIN test <outreach@test.mushin.invalid>", postalAddress: v.OUTREACH_POSTAL_ADDRESS ?? null }
          : { mode: "off" },
    alertWebhookUrl: v.ALERT_WEBHOOK_URL ?? null,
    trustedProxies: v.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter((s) => s && s !== "none"),
    authAdmin: v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
  };
}

export type WorkerConfig = {
  nodeEnv: ApiConfig["nodeEnv"];
  logLevel: LogLevel;
  /** Transaction pooler: the worker's queries, like the API's. */
  databaseUrl: string;
  /** Session pooler: pg-boss and LISTEN need a connection they keep. */
  directUrl: string;
  databaseCaPem: string | null;
  appUrl: string;
  payments: PaymentsConfig;
  catalogSearchBackend: "postgres" | "meilisearch";
  searchProfile: "v1" | "v2";
  sourcePolicy: { youtubeDerivedMetrics: boolean };
  enrichment: EnrichmentPolicy;
  search: SearchConfig;
  llm: LlmProviderConfig[];
  llmMonthlyBudgetUsd: number;
  scraping: ScrapingConfig;
  storage: StorageConfig;
  dataEncryptionKey: Buffer;
  audienceSources: "youtube"[];
};

export function loadWorkerConfig(env: Env): WorkerConfig {
  const v = parse(workerSchema, env);
  return {
    nodeEnv: v.NODE_ENV,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    directUrl: v.DIRECT_URL,
    databaseCaPem: readCaFile(v.DATABASE_SSL_CA_FILE),
    appUrl: new URL(v.APP_URL).origin,
    payments: paymentsFrom(v),
    catalogSearchBackend: v.CATALOG_SEARCH_BACKEND,
    searchProfile: v.SEARCH_PROFILE,
    sourcePolicy: { youtubeDerivedMetrics: v.YOUTUBE_DERIVED_METRICS === "on" },
    enrichment: {
      attributePolicy: v.ENRICHMENT_ATTRIBUTE_POLICY,
      youtubeContentEvidence: v.YOUTUBE_CONTENT_EVIDENCE === "on",
      youtubeDescriptionContacts: v.YOUTUBE_DESCRIPTION_CONTACTS === "on",
      semanticNiche: v.NICHE_SEMANTIC === "on",
    },
    llmMonthlyBudgetUsd: v.LLM_MONTHLY_BUDGET_USD ?? 5,
    search: searchFrom(v, v.MEILISEARCH_API_KEY),
    llm: llmFrom(v),
    dataEncryptionKey: Buffer.from(v.DATA_ENCRYPTION_KEY, "base64"),
    audienceSources: [...new Set(v.AUDIENCE_SOURCES)],
    scraping: {
      apifyToken: v.APIFY_TOKEN ?? null,
      instagramActor: v.APIFY_INSTAGRAM_ACTOR_ID,
      instagramBuild: v.APIFY_INSTAGRAM_BUILD ?? (v.APIFY_INSTAGRAM_ACTOR_ID === "apify/instagram-profile-scraper" ? "0.0.634" : null),
      tiktokActor: v.APIFY_TIKTOK_ACTOR_ID,
      tiktokBuild: v.APIFY_TIKTOK_BUILD ?? (v.APIFY_TIKTOK_ACTOR_ID === "clockworks/tiktok-profile-scraper" ? "0.99.2065" : null),
      instagramPostActor: v.APIFY_INSTAGRAM_POST_ACTOR_ID === "off" ? null : v.APIFY_INSTAGRAM_POST_ACTOR_ID,
      instagramPostBuild: v.APIFY_INSTAGRAM_POST_BUILD ?? (v.APIFY_INSTAGRAM_POST_ACTOR_ID === "apify/instagram-scraper" ? "0.0.812" : null),
      contentResolutionMax: v.LIVE_CONTENT_RESOLUTION_MAX,
      youtubeSearch: v.LIVE_YOUTUBE_SEARCH === "video" && v.YOUTUBE_API_CALLS === "on" && Boolean(v.YOUTUBE_API_KEY),
      extractionMultiplier: { instagram: v.LIVE_EXTRACTION_MULTIPLIER_INSTAGRAM, youtube: v.LIVE_EXTRACTION_MULTIPLIER_YOUTUBE, tiktok: v.LIVE_EXTRACTION_MULTIPLIER_TIKTOK },
      profileConcurrency: v.LIVE_PROFILE_CONCURRENCY,
      jobCostCap: {
        revenuePerCreditUsd: v.LIVE_REVENUE_PER_CREDIT_USD,
        costToPriceRatio: v.LIVE_COST_TO_PRICE_RATIO,
        profileUsd: { instagram: v.LIVE_PROFILE_USD_INSTAGRAM, tiktok: v.LIVE_PROFILE_USD_TIKTOK, youtube: v.LIVE_PROFILE_USD_YOUTUBE },
      },
      jobDeadlineMs: v.LIVE_JOB_DEADLINE_MINUTES * 60_000,
      apifyMonthlyBudgetUsd: v.APIFY_MONTHLY_BUDGET_USD,
      youtubeApiKey: v.YOUTUBE_API_CALLS === "on" ? (v.YOUTUBE_API_KEY ?? null) : null,
      serperApiKey: v.SERPER_API_KEY ?? null,
      serperMonthlySearchLimit: v.SERPER_MONTHLY_SEARCH_LIMIT,
    },
    storage: v.SUPABASE_URL && v.SUPABASE_SERVICE_ROLE_KEY ? { url: v.SUPABASE_URL.replace(/\/+$/, ""), serviceKey: v.SUPABASE_SERVICE_ROLE_KEY } : null,
  };
}
