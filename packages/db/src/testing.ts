import postgres from "postgres";
import { readCaFile } from "@mushin/core";
import { createDatabase, type Db } from "./database";
import { tlsOptions } from "./tls";

export function testDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests run only against the test database.");
  return url;
}

export function testCaPem(): string | null {
  return readCaFile(process.env["TEST_DATABASE_SSL_CA_FILE"]);
}

export function createTestDatabase(): Db {
  return createDatabase(testDatabaseUrl(), { max: 4, applicationName: "mushin-test", caPem: testCaPem() });
}

/** Runs SQL as the database owner (test setup only). */
export async function ownerQuery<T extends Record<string, unknown>>(text: string): Promise<T[]> {
  const sql = postgres(testDatabaseUrl(), { max: 1, prepare: false, ssl: tlsOptions(testCaPem()), onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Empties every app table (owner privilege; app roles cannot truncate append-only tables). */
export async function resetTables(): Promise<void> {
  const rows = await ownerQuery<{ t: string }>(
    `select format('%I.%I', schemaname, tablename) as t from pg_tables
     where schemaname in ('wp','staff','platform') and tablename <> 'schema_migrations'`,
  );
  if (rows.length) await ownerQuery(`truncate ${rows.map((r) => r.t).join(", ")} restart identity cascade`);
}
