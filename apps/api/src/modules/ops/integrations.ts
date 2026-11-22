import type { FastifyInstance } from "fastify";
import { staffIntegrationsSchema, type StaffIntegrations } from "@mushin/contracts";
import type { PreHandler } from "../../http/types";
import { sendOk } from "../../http/validate";
import type { StaffAction } from "../staff/index";

type Item = StaffIntegrations["integrations"][number];
type Entry = Omit<Item, "configured"> & { vars: string[] };

/**
 * The outside services MUSHIN can call (owner, 22 Nov: "all the APIs we have, including the backup ones"). Backups are
 * the extra keys the code falls back to when the first one is exhausted or refused. Only whether each is set on this
 * server is reported: never a key, a prefix or a length.
 */
const CATALOG: Entry[] = [
  { key: "gemini", group: "AI", name: "Google Gemini", purpose: "Creator assessments, niches and search understanding", role: "primary", vars: ["GEMINI_API_KEY"] },
  { key: "groq-1", group: "AI", name: "Groq key 1", purpose: "Fast AI answers (search, assessments)", role: "primary", vars: ["GROQ_API_KEY_1", "GROQ_API_KEY"] },
  ...[2, 3, 4, 5].map((n): Entry => ({ key: `groq-${n}`, group: "AI", name: `Groq key ${n}`, purpose: "Used when the earlier Groq keys run out", role: "backup", vars: [`GROQ_API_KEY_${n}`] })),
  { key: "openrouter", group: "AI", name: "OpenRouter", purpose: "Backup AI models when Gemini and Groq are unavailable", role: "backup", vars: ["OPENROUTER_API_KEY"] },
  { key: "ollama", group: "AI", name: "Ollama", purpose: "Backup AI models", role: "backup", vars: ["OLLAMA_API_KEY"] },
  { key: "apify-1", group: "Creator data", name: "Apify token 1", purpose: "Instagram and TikTok profiles and posts", role: "primary", vars: ["APIFY_TOKEN"] },
  { key: "apify-2", group: "Creator data", name: "Apify token 2", purpose: "Used when token 1 is out of credit", role: "backup", vars: ["APIFY_TOKEN_2"] },
  { key: "apify-3", group: "Creator data", name: "Apify token 3", purpose: "Used when tokens 1 and 2 are out of credit", role: "backup", vars: ["APIFY_TOKEN_3"] },
  { key: "youtube", group: "Creator data", name: "YouTube Data API", purpose: "YouTube channels and videos (official API)", role: "primary", vars: ["YOUTUBE_API_KEY"] },
  { key: "serper", group: "Creator data", name: "Serper (Google search)", purpose: "Finding new creators on the web", role: "primary", vars: ["SERPER_API_KEY"] },
  { key: "yepapi", group: "Creator data", name: "YepAPI", purpose: "Extra creator data", role: "backup", vars: ["YEPAPI_API_KEY"] },
  { key: "meilisearch", group: "Search", name: "Meilisearch", purpose: "Creator search index", role: "primary", vars: ["MEILISEARCH_HOST"] },
  { key: "resend", group: "Email", name: "Resend", purpose: "Outreach and notification email", role: "primary", vars: ["RESEND_API_KEY"] },
  { key: "paddle", group: "Payments", name: "Paddle", purpose: "Subscriptions and credit top-ups", role: "primary", vars: ["PADDLE_API_KEY"] },
  { key: "supabase", group: "Platform", name: "Supabase database", purpose: "All MUSHIN data", role: "primary", vars: ["DATABASE_URL"] },
  { key: "supabase-auth", group: "Platform", name: "Supabase sign-in", purpose: "Customer sign-in and email confirmation", role: "primary", vars: ["SUPABASE_URL"] },
  { key: "alert-webhook", group: "Platform", name: "Alert channel", purpose: "Sends alerts to the team's chat", role: "primary", vars: ["ALERT_WEBHOOK_URL"] },
  { key: "cron", group: "Platform", name: "Daily maintenance job", purpose: "Billing jobs, YouTube data expiry, alert checks", role: "primary", vars: ["CRON_SECRET"] },
];

export function integrationsOf(env: Record<string, string | undefined>): StaffIntegrations {
  return { integrations: CATALOG.map(({ vars, ...e }) => ({ ...e, configured: vars.some((v) => (env[v] ?? "").trim().length > 0) })) };
}

export function registerIntegrationRoutes(app: FastifyInstance, o: { requireStaff: (action: StaffAction) => PreHandler; env?: Record<string, string | undefined> }) {
  app.get("/admin/v1/ops/integrations", { preHandler: o.requireStaff("ops.providers.read") }, async (_req, reply) =>
    sendOk(reply, staffIntegrationsSchema, integrationsOf(o.env ?? process.env)),
  );
}
