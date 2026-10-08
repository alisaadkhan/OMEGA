import type { Logger, PaymentsConfig, ProviderCallSink } from "@mushin/core";
import { MockPayments } from "./mock";
import { PaddlePayments } from "./paddle";
import type { Payments } from "./types";

export * from "./types";
export * from "./signature";
export * from "./paddle-events";
export * from "./mock";
export * from "./paddle";

export function createPayments(config: PaymentsConfig, deps: { sink: ProviderCallSink; logger: Logger }): Payments {
  if (config.mode === "paddle") {
    return new PaddlePayments({ apiKey: config.apiKey, webhookSecret: config.webhookSecret, environment: config.environment, sink: deps.sink, logger: deps.logger });
  }
  deps.logger.warn("Paddle keys are not set: using the MOCK payment provider (test-mode checkout, no real charges)");
  return new MockPayments({ webhookSecret: config.webhookSecret, publicApiUrl: config.publicApiUrl });
}
