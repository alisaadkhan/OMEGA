import { pino, type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "./config";

export type { Logger };

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.challengeToken",
  "*.secret",
  "*.totpSecret",
  "*.email",
  "email",
];

export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  return at > 0 ? `${value[0]}***${value.slice(at)}` : "[REDACTED]";
}

export function createLogger(opts: { level: LogLevel; name?: string }, destination?: DestinationStream): Logger {
  return pino(
    {
      level: opts.level,
      ...(opts.name ? { name: opts.name } : {}),
      redact: {
        paths: REDACT_PATHS,
        censor: (value: unknown, path: string[]) =>
          path[path.length - 1] === "email" && typeof value === "string" ? maskEmail(value) : "[REDACTED]",
      },
    },
    destination,
  );
}
