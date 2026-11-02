import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { ProviderCallSink } from "@mushin/core";
import type { Db } from "./database";
import { providerCalls, providerControls } from "./schema";

export function createDbProviderCallSink(db: Db): ProviderCallSink {
  return {
    async record(call) {
      await db.withSystem((tx) =>
        tx.insert(providerCalls).values({
          ...call,
          units: call.units === null ? null : String(call.units),
          costUsd: String(call.costUsd),
        }),
      );
    },
  };
}

/** Recorded spend for one provider since a moment (the Apify monthly spend cap, spec §4). Worker role only. */
export async function providerSpendSince(db: Db, provider: string, since: Date): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${providerCalls.costUsd}), 0)` })
      .from(providerCalls)
      .where(and(eq(providerCalls.provider, provider), gte(providerCalls.createdAt, since))),
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Hosted-LLM providers counted against the monthly LLM budget. Gemini is the main provider and Ollama the fallback;
 * Groq (replaced 2026-10-26) stays in the sum so its spend earlier in the month still counts.
 */
export const LLM_BUDGET_PROVIDERS = ["gemini", "ollama", "groq"] as const;

/** Recorded hosted-LLM spend since a moment, across LLM_BUDGET_PROVIDERS (each provider stays distinguishable in the rows). */
export async function llmSpendSince(db: Db, since: Date): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${providerCalls.costUsd}), 0)` })
      .from(providerCalls)
      .where(and(inArray(providerCalls.provider, [...LLM_BUDGET_PROVIDERS]), gte(providerCalls.createdAt, since))),
  );
  return Number(rows[0]?.total ?? 0);
}

/** Successful calls to one provider since a moment (the Serper monthly search limit, spec §4.4). Worker role only. */
export async function providerCallsSince(db: Db, provider: string, since: Date): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx
      .select({ n: sql<string>`count(*)` })
      .from(providerCalls)
      .where(and(eq(providerCalls.provider, provider), eq(providerCalls.status, "ok"), gte(providerCalls.createdAt, since))),
  );
  return Number(rows[0]?.n ?? 0);
}

/** Direct provider cost recorded so far for one job (USD), for the per-job cost cap. */
export async function providerSpendForJob(db: Db, jobId: string): Promise<number> {
  const rows = await db.withSystem((tx) =>
    tx.select({ total: sql<string>`coalesce(sum(${providerCalls.costUsd}), 0)` }).from(providerCalls).where(eq(providerCalls.jobId, jobId)),
  );
  return Number(rows[0]?.total ?? 0);
}

/** Whether operations paused this provider family (platform.provider_controls); a missing row means not paused. */
export async function providerPaused(db: Db, provider: "apify" | "serper" | "llm"): Promise<boolean> {
  const rows = await db.withSystem((tx) => tx.select({ paused: providerControls.paused }).from(providerControls).where(eq(providerControls.provider, provider)));
  return rows[0]?.paused === true;
}
