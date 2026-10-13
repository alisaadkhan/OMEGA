import type { ConnectionOptions } from "node:tls";

/**
 * TLS options for postgres.js and pg (pg-boss).
 * With Supabase's CA certificate the server certificate is verified.
 * Without it (development only — production config requires the CA) traffic is still encrypted,
 * but the certificate is not verified; callers must log `UNVERIFIED_TLS_WARNING` at startup.
 */
export function tlsOptions(caPem: string | null, url?: string): ConnectionOptions | false {
  // Local PostgreSQL commonly has SSL disabled. Never weaken TLS for remote hosts.
  if (url && !caPem) {
    try {
      const host = new URL(url).hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    } catch {
      // Let the PostgreSQL client report malformed connection strings.
    }
  }
  return caPem ? { ca: caPem, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export const UNVERIFIED_TLS_WARNING =
  "DATABASE_SSL_CA_FILE is not set: database traffic is encrypted but the server certificate is NOT verified (development only)";
