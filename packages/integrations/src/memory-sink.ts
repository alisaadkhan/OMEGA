import type { ProviderCall, ProviderCallSink } from "@mushin/core";

export class MemoryProviderCallSink implements ProviderCallSink {
  readonly calls: ProviderCall[] = [];

  async record(call: ProviderCall): Promise<void> {
    this.calls.push(call);
  }
}
