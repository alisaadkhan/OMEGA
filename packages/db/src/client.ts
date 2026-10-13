import postgres from "postgres";
import { tlsOptions } from "./tls";

export type Sql = postgres.Sql;

/** Internal: only packages/db may import this (enforced by dependency-cruiser). */
export function createSql(url: string, opts: { max: number; applicationName: string; caPem: string | null }): Sql {
  return postgres(url, {
    max: opts.max,
    prepare: false, // required by Supabase's transaction pooler
    ssl: tlsOptions(opts.caPem, url),
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
    connection: { application_name: opts.applicationName },
  });
}
