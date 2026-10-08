import type { Logger } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { Llm } from "@mushin/integrations";
import { SUMMARY_SYSTEM_PROMPT, summaryInput, summaryOutputSchema } from "./prompts";
import * as repo from "./repository";
import { isSafeSummary, sourceHash } from "./rules";

/** Writes the 3-sentence creator brief (SRS REQ-03.01) in the worker; failures are retried by the queue. */
export function createSummaryWriter(o: { db: Db; llm: Llm; logger: Logger }) {
  async function generate(creatorId: string): Promise<"written" | "up_to_date" | "missing"> {
    const found = await o.db.withSystem((tx) => repo.summarySource(tx, creatorId));
    if (!found) return "missing";
    const hash = sourceHash(found.source);
    if (found.currentHash === hash) return "up_to_date";
    try {
      const { value, model } = await o.llm.complete({
        feature: "creator_summary",
        system: SUMMARY_SYSTEM_PROMPT,
        input: summaryInput(found.source),
        schema: summaryOutputSchema,
        timeoutMs: 30_000,
      });
      const text = value.summary.trim();
      if (!isSafeSummary(text)) throw new Error("summary failed the safety check (links, contact details or length)");
      // Written with the hash of the data it was made from; a change meanwhile is caught on the next profile view.
      await o.db.withSystem((tx) => repo.saveSummary(tx, creatorId, text, model, hash));
      return "written";
    } catch (err) {
      await o.db.withSystem((tx) => repo.markSummaryFailed(tx, creatorId));
      o.logger.warn({ err, creatorId }, "creator summary failed; the job will retry");
      throw err;
    }
  }
  return { generate };
}

export type SummaryWriter = ReturnType<typeof createSummaryWriter>;
