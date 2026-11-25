import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { staffApiCallsSchema, staffApiKeysSchema, staffIntegrationsSchema, type StaffApiKey, type StaffIntegrations } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
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

/** Which recorded calls belong to a catalogue key: provider name, and the key's position for multi-key providers. */
export function meterOf(key: string): { provider: string; slot: number | null } | null {
  const m = /^(groq|apify)-(\d)$/.exec(key);
  if (m) return { provider: m[1] as string, slot: Number(m[2]) };
  return ["gemini", "openrouter", "ollama", "youtube", "serper", "yepapi"].includes(key) ? { provider: key, slot: null } : null;
}

type Usage = { provider: string; slot: number; calls24h: string; errors24h: string; calls_month: string; cost_month: string; active_now: string; last_at: string | null; last_error: string | null };

export function registerIntegrationRoutes(app: FastifyInstance, o: { requireStaff: (action: StaffAction) => PreHandler; db?: Db; env?: Record<string, string | undefined> }) {
  const db = o.db;
  if (db) {
    app.get("/admin/v1/ops/api-keys", { preHandler: o.requireStaff("ops.providers.read") }, async (_req, reply) => {
      const usage = await db.withSystem((tx) =>
        tx.execute<Usage>(sql`
          select provider, coalesce(key_slot, 1)::int slot,
            count(*) filter (where created_at >= now() - interval '24 hours') calls24h,
            count(*) filter (where created_at >= now() - interval '24 hours' and status = 'error') errors24h,
            count(*) calls_month, coalesce(sum(cost_usd), 0) cost_month,
            count(*) filter (where created_at >= now() - interval '10 minutes') active_now,
            max(created_at) last_at,
            (array_agg(error_code order by created_at desc) filter (where status = 'error'))[1] last_error
          from platform.provider_calls where created_at >= date_trunc('month', now()) group by 1, 2`),
      );
      const quota = await db.withSystem((tx) =>
        tx.execute<{ provider: string; quota_used: string | null; quota_limit: string | null; quota_unit: string | null }>(sql`select provider, quota_used, quota_limit, quota_unit from platform.provider_status`),
      );
      const keys: StaffApiKey[] = integrationsOf(o.env ?? process.env).integrations.map((i) => {
        const meter = meterOf(i.key);
        const rows = meter ? usage.filter((u) => u.provider === meter.provider && (meter.slot === null || u.slot === meter.slot)) : [];
        const sum = (f: keyof Usage) => rows.reduce((a, r) => a + Number(r[f] ?? 0), 0);
        const last = rows.map((r) => r.last_at).filter((x): x is string => !!x).sort().at(-1) ?? null;
        const q = meter ? quota.find((x) => x.provider === meter.provider && x.quota_used !== null && x.quota_limit !== null) : undefined;
        return {
          ...i,
          metered: meter !== null,
          calls24h: sum("calls24h"),
          errors24h: sum("errors24h"),
          callsMonth: sum("calls_month"),
          costMonthUsd: Math.round(sum("cost_month") * 10_000) / 10_000,
          lastCallAt: last ? new Date(last).toISOString() : null,
          lastErrorCode: rows.find((r) => r.last_error)?.last_error ?? null,
          activeNow: sum("active_now"),
          quota: q && meter?.slot === null ? { used: Number(q.quota_used), limit: Number(q.quota_limit), unit: q.quota_unit ?? "" } : null,
        };
      });
      return sendOk(reply, staffApiKeysSchema, { keys });
    });

    // The requests made through one key: who (account, person) and what (the job and its search), newest first.
    app.get("/admin/v1/ops/api-keys/:key/calls", { preHandler: o.requireStaff("ops.providers.read") }, async (req, reply) => {
      const { key } = parseInput(z.object({ key: z.string().max(40) }), req.params);
      const { limit } = parseInput(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
      const meter = meterOf(key);
      if (!meter) throw new AppError("NOT_FOUND", "MUSHIN does not record requests for this service");
      type Row = { at: string; operation: string; model: string | null; status: "ok" | "error"; errorCode: string | null; costUsd: number; latencyMs: number; workspaceId: string | null; workspaceName: string | null; userEmail: string | null; jobId: string | null; jobKind: string | null; jobStatus: string | null; jobSearch: string | null; jobTarget: string | null };
      const [res] = await db.withSystem((tx) => tx.execute<{ v: Row[] }>(sql`select platform.staff_api_calls(${meter.provider}, ${meter.slot}, ${limit}) v`));
      return sendOk(reply, staffApiCallsSchema, {
        key,
        calls: (res?.v ?? []).map((r) => ({
          at: new Date(r.at).toISOString(),
          operation: r.operation,
          model: r.model,
          status: r.status,
          errorCode: r.errorCode,
          costUsd: Number(r.costUsd),
          latencyMs: r.latencyMs,
          account: r.workspaceId ? { id: r.workspaceId, name: r.workspaceName ?? "" } : null,
          userEmail: r.userEmail,
          job: r.jobId ? { id: r.jobId, kind: r.jobKind ?? "", status: r.jobStatus ?? "", search: r.jobSearch, target: r.jobTarget } : null,
        })),
      });
    });
  }

  app.get("/admin/v1/ops/integrations", { preHandler: o.requireStaff("ops.providers.read") }, async (_req, reply) =>
    sendOk(reply, staffIntegrationsSchema, integrationsOf(o.env ?? process.env)),
  );
}
