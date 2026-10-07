import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sha256Hex } from "@mushin/core";
import { tlsOptions } from "./tls";

const LOCK_KEY = 727_001;

export async function migrate(
  url: string,
  opts: { dir?: string; log?: (m: string) => void; caPem?: string | null } = {},
): Promise<string[]> {
  const dir = opts.dir ?? fileURLToPath(new URL("../migrations/", import.meta.url));
  const sql = postgres(url, { max: 1, prepare: false, ssl: tlsOptions(opts.caPem ?? null), onnotice: () => {} });
  try {
    await sql`create schema if not exists platform`;
    await sql`create table if not exists platform.schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const applied = new Map(
      (await sql<{ name: string; checksum: string }[]>`select name, checksum from platform.schema_migrations`).map((r) => [r.name, r.checksum]),
    );
    const ran: string[] = [];
    for (const file of files) {
      const body = await readFile(join(dir, file), "utf8");
      const checksum = sha256Hex(body);
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into platform.schema_migrations (name, checksum) values (${file}, ${checksum})`;
      });
      ran.push(file);
      opts.log?.(`applied ${file}`);
    }
    return ran;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}
