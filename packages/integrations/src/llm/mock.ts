import { AppError } from "@mushin/core";
import type { Llm, LlmRequest } from "./types";

/** Test stand-in: returns what `reply` gives, validated with the request's schema like the real adapter. */
export class MockLlm implements Llm {
  readonly calls: LlmRequest<unknown>[] = [];

  constructor(private readonly reply: (req: LlmRequest<unknown>) => unknown | Promise<unknown>) {}

  async complete<T>(req: LlmRequest<T>): Promise<{ value: T; model: string }> {
    this.calls.push(req as LlmRequest<unknown>);
    const r = req.schema.safeParse(await this.reply(req as LlmRequest<unknown>));
    if (!r.success) throw new AppError("PROVIDER_UNAVAILABLE", "The AI could not produce a usable answer. Please try again.");
    return { value: r.data, model: "mock" };
  }
}
