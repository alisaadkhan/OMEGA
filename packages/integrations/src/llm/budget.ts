import { AppError, type Logger } from "@mushin/core";
import type { Llm, LlmRequest } from "./types";

/**
 * Monthly cap on hosted-LLM spend (OPS-005, LIVE-004), the LLM counterpart of the Apify budget guard. Spend is what
 * provider_calls recorded this calendar month (UTC) for the LLM providers, plus an allowance for calls in flight. At the
 * cap every call fails as "AI unavailable" (features already degrade safely); from the warning share on, a warning is
 * logged once a month. The default budget is a placeholder until the owner sets LLM_MONTHLY_BUDGET_USD.
 */
export function withLlmBudget(
  llm: Llm,
  o: { budgetUsd: number; spentSince: (since: Date) => Promise<number>; logger: Logger; perCallUsd?: number; warnShare?: number; now?: () => Date },
): Llm {
  const perCall = o.perCallUsd ?? 0.001;
  const warnShare = o.warnShare ?? 0.8;
  let inFlight = 0;
  let warnedFor = "";
  return {
    async complete<T>(req: LlmRequest<T>) {
      const t = (o.now ?? (() => new Date()))();
      const month = `${t.getUTCFullYear()}-${t.getUTCMonth()}`;
      const spent = await o.spentSince(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
      if (spent + (inFlight + 1) * perCall > o.budgetUsd + 1e-9) {
        o.logger.error({ spentUsd: spent, budgetUsd: o.budgetUsd, feature: req.feature }, "monthly LLM budget reached: AI calls refused");
        throw new AppError("PROVIDER_UNAVAILABLE", "AI is unavailable right now. Please try again later.", { reason: "llm_budget" });
      }
      if (spent >= o.budgetUsd * warnShare && warnedFor !== month) {
        warnedFor = month;
        o.logger.warn({ spentUsd: spent, budgetUsd: o.budgetUsd }, `LLM spend passed ${Math.round(warnShare * 100)}% of the monthly budget`);
      }
      inFlight += 1;
      try {
        return await llm.complete(req);
      } finally {
        inFlight -= 1;
      }
    },
  };
}
