import { config } from "zod";

// Audit SEC-14: zod probes `new Function` to speed up parsing, which the Content-Security-Policy forbids (no eval).
// Imported first in main.tsx so no schema is parsed before it.
config({ jitless: true });
