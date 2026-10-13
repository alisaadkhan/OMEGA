import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { readCaFile } from "@mushin/core";
import { createDatabase, type Db } from "./database";
import { tlsOptions } from "./tls";

export function testDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests run only against the test database.");
  return assertDisposableTestDatabaseUrl(url);
}

/** Integration setup truncates application schemas, so only a clearly named local disposable DB is accepted. */
export function assertDisposableTestDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid local disposable PostgreSQL URL.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Integration tests require PostgreSQL; TEST_DATABASE_URL was not accepted.");
  }
  if (!localHosts.has(parsed.hostname) || !/(test|disposable)/i.test(database)) {
    throw new Error("Refusing integration setup: TEST_DATABASE_URL must point to localhost and a database named with 'test' or 'disposable'. The suite truncates application tables.");
  }
  return value;
}

export function testCaPem(): string | null {
  return readCaFile(process.env["TEST_DATABASE_SSL_CA_FILE"]);
}

export function createTestDatabase(): Db {
  return createDatabase(testDatabaseUrl(), { max: 4, applicationName: "mushin-test", caPem: testCaPem() });
}

/** Runs SQL as the database owner (test setup only). */
export async function ownerQuery<T extends Record<string, unknown>>(text: string): Promise<T[]> {
  const url = testDatabaseUrl();
  const sql = postgres(url, { max: 1, prepare: false, ssl: tlsOptions(testCaPem(), url), onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * For `expect(p).rejects.toSatisfy(dbError(/…/))`: drizzle wraps database errors as "Failed query: …" and keeps the
 * Postgres message in `cause`, so this matches the error or anything in its cause chain.
 */
export function dbError(pattern: RegExp): (err: unknown) => boolean {
  return (err) => {
    for (let e: unknown = err; e instanceof Error; e = e.cause) if (pattern.test(e.message)) return true;
    return false;
  };
}

/** Config tables hold migration seeds; tests must not wipe them. */
const KEEP = ["schema_migrations", "plans", "topup_packs", "credit_action_costs", "billing_settings", "niches", "search_settings", "enrichment_settings"];

/** Empties every app table except seeded config (owner privilege; app roles cannot truncate append-only tables). */
export async function resetTables(): Promise<void> {
  const rows = await ownerQuery<{ t: string }>(
    `select format('%I.%I', schemaname, tablename) as t from pg_tables
     where schemaname in ('wp','staff','platform','gcp')
       and not (schemaname = 'platform' and tablename in (${KEEP.map((k) => `'${k}'`).join(", ")}))`,
  );
  if (rows.length) await ownerQuery(`truncate ${rows.map((r) => r.t).join(", ")} restart identity cascade`);
}

/** A user + workspace + owner membership, created as the owner (bypassing the API). */
export async function createTestWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await ownerQuery(`
    insert into wp.users (id, email) values ('${userId}', '${userId}@test.mushin.pk');
    insert into wp.workspaces (id, name, owner_user_id) values ('${workspaceId}', 'Test workspace', '${userId}');
    insert into wp.workspace_members (workspace_id, user_id, role) values ('${workspaceId}', '${userId}', 'owner');`);
  return { userId, workspaceId };
}
