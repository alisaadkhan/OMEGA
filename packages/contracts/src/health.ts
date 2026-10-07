import { z } from "zod";

export const healthLiveSchema = z.object({ status: z.literal("ok") });

export const healthReadySchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.enum(["ok", "down", "skipped"])),
});
