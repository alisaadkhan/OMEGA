export type ProviderCall = {
  provider: string;
  operation: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  units: number | null;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode: string | null;
  workspaceId: string | null;
  jobId: string | null;
  requestId: string | null;
  /** Which of the provider's keys served the call (1 = first), null for single-key providers (0105). */
  keySlot?: number | null;
};

export interface ProviderCallSink {
  record(call: ProviderCall): Promise<void>;
}
