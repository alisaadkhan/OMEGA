import { AppError } from "@mushin/core";
import type { Llm } from "./llm/types";
import { ProviderError, type SpendGuard } from "./scrapers/types";

/**
 * An operations pause (staff console, migration 0033) in front of a provider's spend guard: while the provider is
 * paused no new call starts, and a failure to read the flag also refuses the call (fail closed). Runs already in flight
 * finish; jobs refused here fail cleanly and are refunded like a reached budget.
 */
export function pausableGuard(guard: SpendGuard, isPaused: () => Promise<boolean>, label: string): SpendGuard {
  return {
    async begin(units?: number) {
      if (await isPaused()) throw new ProviderError(false, "spend_cap", `${label} is paused by MUSHIN operations`);
      return guard.begin(units);
    },
  };
}

/** The same pause for AI calls: refused as "AI unavailable", which every AI feature already degrades from. */
export function pausableLlm(llm: Llm, isPaused: () => Promise<boolean>): Llm {
  return {
    async complete(req) {
      if (await isPaused()) throw new AppError("PROVIDER_UNAVAILABLE", "AI is unavailable right now. Please try again later.", { reason: "provider_paused" });
      return llm.complete(req);
    },
  };
}
