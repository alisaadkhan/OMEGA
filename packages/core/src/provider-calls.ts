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
};

export interface ProviderCallSink {
  record(call: ProviderCall): Promise<void>;
}
