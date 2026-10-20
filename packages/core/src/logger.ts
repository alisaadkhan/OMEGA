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

// Keys censored at any depth; REDACT_PATHS only reaches one level down.
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "challengeToken",
  "secret",
  "totpSecret",
  "authorization",
  "cookie",
  "set-cookie",
]);
// Credential-looking key names in any spelling (apiKey, api_key, serviceRoleKey, webhookSecret, privateKey, …), so a new
// field holding a secret is censored without being listed here first (acceptance SEC-12, 2026-10-20).
const SENSITIVE_KEY_PATTERN = /(?:api[-_]?key|secret|passw(?:or)?d|token|credential|private[-_]?key|service[-_]?(?:role[-_]?)?key|session[-_]?key|dsn)$/i;
const isSensitiveKey = (key: string) => SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key);
// The password part of a URL (postgres://user:password@host) in any logged text, including error messages.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi;
export function maskUrlCredentials(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1***@");
}
const MAX_DEPTH = 10;

export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  return at > 0 ? `${value[0]}***${value.slice(at)}` : "[REDACTED]";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Copies plain objects and arrays, censoring sensitive keys at every depth. Never mutates the input. */
function scrub(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return maskUrlCredentials(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  const out = Array.isArray(value)
    ? value.map((item) => scrub(item, depth + 1, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (key === "email" && typeof item === "string") return [key, maskEmail(item)];
          if (isSensitiveKey(key)) return [key, "[REDACTED]"];
          return [key, scrub(item, depth + 1, seen)];
        }),
      );
  seen.delete(value);
  return out;
}

export function createLogger(opts: { level: LogLevel; name?: string }, destination?: DestinationStream): Logger {
  return pino(
    {
      level: opts.level,
      ...(opts.name ? { name: opts.name } : {}),
      formatters: { log: (obj) => scrub(obj, 0, new WeakSet()) as Record<string, unknown> },
      // Errors are serialised before the formatter runs: mask URL credentials in their message and stack too.
      serializers: {
        err: (err: unknown) => {
          const out = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>;
          for (const k of ["message", "stack"]) if (typeof out[k] === "string") out[k] = maskUrlCredentials(out[k] as string);
          return out;
        },
      },
      redact: {
        paths: REDACT_PATHS,
        censor: (value: unknown, path: string[]) =>
          path[path.length - 1] === "email" && typeof value === "string" ? maskEmail(value) : "[REDACTED]",
      },
    },
    destination,
  );
}
