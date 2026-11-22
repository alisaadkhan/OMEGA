import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "@mushin/db";
import type { PreHandler } from "../../http/types";
import { sendOk } from "../../http/validate";
import type { StaffAction } from "../staff/index";

const check = z.object({ key: z.string(), name: z.string(), state: z.enum(["ok", "warning", "down", "not_set"]), detail: z.string() });
export const systemHealthSchema = z.object({ checks: z.array(check), version: z.string().nullable(), environment: z.string().nullable(), at: z.string() });
type Check = z.infer<typeof check>;

/**
 * Everything watched in one place (owner, 22 Nov: "watch over the entire system"): each check is measured now, on
 * this request, and says what it found. Nothing defaults to healthy.
 */
export function registerHealthRoutes(app: FastifyInstance, o: { db: Db; requireStaff: (action: StaffAction) => PreHandler; env?: Record<string, string | undefined> }) {
  app.get("/admin/v1/ops/health", { preHandler: o.requireStaff("ops.overview.read") }, async (_req, reply) => {
    const env = o.env ?? process.env;
    const checks: Check[] = [];
    const t0 = Date.now();
    try {
      await o.db.withSystem((tx) => tx.execute(sql`select 1`));
      const ms = Date.now() - t0;
      checks.push({ key: "database", name: "Database", state: ms > 1500 ? "warning" : "ok", detail: `Answered in ${ms} ms` });
    } catch {
      checks.push({ key: "database", name: "Database", state: "down", detail: "Did not answer" });
    }
    const facts = await o.db
      .withSystem(async (tx) => {
        const [m] = await tx.execute<{ name: string | null; n: number }>(sql`select max(name) as name, count(*)::int n from platform.schema_migrations`);
        const [d] = await tx.execute<{ total: number; eligible: number }>(sql`select count(*)::int total, count(*) filter (where eligible)::int eligible from gcp.creator_search_documents`);
        const [c] = await tx.execute<{ n: number }>(sql`select count(*)::int n from gcp.creators where status = 'active'`);
        const [a] = await tx.execute<{ v: { outboxPending: number; outboxOldestSeconds: number | null; workerHeartbeatSeconds: number | null; stuckJobs: number; failedJobs1h: number } }>(sql`select platform.staff_alerts() v`);
        return { m, d, c, a: a?.v };
      })
      .catch(() => null);
    if (facts) {
      checks.push({ key: "migrations", name: "Database version", state: "ok", detail: `${facts.m?.n ?? 0} migrations applied, latest ${facts.m?.name ?? "none"}` });
      const behind = (facts.c?.n ?? 0) - (facts.d?.total ?? 0);
      checks.push({ key: "search", name: "Creator search", state: behind > 0 ? "warning" : "ok", detail: `${facts.d?.eligible ?? 0} of ${facts.d?.total ?? 0} indexed creators visible to customers${behind > 0 ? `; ${behind} active creators not indexed yet` : ""}` });
      const a = facts.a;
      if (a) {
        checks.push({ key: "worker", name: "Background worker", state: a.workerHeartbeatSeconds === null ? "not_set" : a.workerHeartbeatSeconds > 600 ? "down" : "ok", detail: a.workerHeartbeatSeconds === null ? "No worker has run here (production uses the daily job and on-the-spot updates)" : `Last reported ${a.workerHeartbeatSeconds} s ago` });
        checks.push({ key: "outbox", name: "Background work waiting", state: a.outboxPending > 1000 ? "warning" : "ok", detail: `${a.outboxPending} waiting${a.outboxOldestSeconds !== null ? `, oldest ${Math.round(a.outboxOldestSeconds / 60)} min` : ""}` });
        checks.push({ key: "jobs", name: "Customer jobs", state: a.stuckJobs > 0 || a.failedJobs1h > 0 ? "warning" : "ok", detail: `${a.stuckJobs} stuck, ${a.failedJobs1h} failed in the last hour` });
      }
    } else checks.push({ key: "facts", name: "System facts", state: "down", detail: "Could not be read" });
    const meili = env["MEILISEARCH_HOST"];
    if (meili) {
      const r = await fetch(`${meili.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2500) }).then((x) => x.ok).catch(() => false);
      checks.push({ key: "meilisearch", name: "Meilisearch", state: r ? "ok" : "down", detail: r ? "Answered" : "Did not answer (customer search falls back to the database)" });
    } else checks.push({ key: "meilisearch", name: "Meilisearch", state: "not_set", detail: "Not used: search runs in the database" });
    checks.push({ key: "alert-channel", name: "Alert channel", state: env["ALERT_WEBHOOK_URL"] ? "ok" : "not_set", detail: env["ALERT_WEBHOOK_URL"] ? "Alerts go to the team chat" : "Alerts only go to the server log" });
    checks.push({ key: "email", name: "Email sending", state: env["RESEND_API_KEY"] ? "ok" : "not_set", detail: env["RESEND_API_KEY"] ? "Email provider set" : "No email provider: outreach email is off" });
    checks.push({ key: "payments", name: "Payments", state: env["PADDLE_API_KEY"] ? "ok" : "not_set", detail: env["PADDLE_API_KEY"] ? "Payment provider set" : "No payment provider: plans are given by staff" });
    return sendOk(reply, systemHealthSchema, { checks, version: env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ?? null, environment: env["VERCEL_ENV"] ?? env["NODE_ENV"] ?? null, at: new Date().toISOString() });
  });
}
