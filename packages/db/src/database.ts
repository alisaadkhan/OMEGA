import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createSql } from "./client";
import * as schema from "./schema";

type DrizzleDb = PostgresJsDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

declare const scope: unique symbol;
export type TenantTx = DbTx & { readonly [scope]: "tenant" };
export type UserTx = DbTx & { readonly [scope]: "user" };
export type SystemTx = DbTx & { readonly [scope]: "system" };

export type Db = {
  withTenant<T>(ctx: { userId: string; workspaceId: string }, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T>;
  withSystem<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;
  /** Worker/system code acting inside one workspace: role mushin_worker, workspace RLS context, no user. */
  withWorkspace<T>(workspaceId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  listen(channel: string, onNotify: () => void): Promise<() => Promise<void>>;
  ping(): Promise<"ok">;
  close(): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(name: string, value: string) {
  if (!UUID.test(value)) throw new Error(`${name} must be a uuid`);
}

/**
 * `listenUrl`: LISTEN needs a connection the pooler keeps for one client (session mode). When `url` is the
 * transaction pooler, pass the session URL here and LISTEN gets one dedicated connection of its own.
 */
export function createDatabase(url: string, opts: { max: number; applicationName: string; caPem?: string | null; listenUrl?: string }): Db {
  const client = createSql(url, { max: opts.max, applicationName: opts.applicationName, caPem: opts.caPem ?? null });
  let listener: ReturnType<typeof createSql> | null = null;
  const listenClient = () =>
    opts.listenUrl
      ? (listener ??= createSql(opts.listenUrl, { max: 1, applicationName: `${opts.applicationName}-listen`, caPem: opts.caPem ?? null }))
      : client;
  const db = drizzle(client, { schema });

  function run<T>(role: "mushin_app" | "mushin_worker", settings: { workspaceId?: string; userId?: string }, fn: (tx: DbTx) => Promise<T>) {
    return db.transaction(async (tx) => {
      // One round trip for the role and the RLS context: set_config('role', …, true) is SET LOCAL ROLE (membership is
      // checked the same way). Each statement costs a full round trip to a remote database (search audit 2026-10-22).
      await tx.execute(
        sql`select set_config('role', ${role}, true), set_config('app.workspace_id', ${settings.workspaceId ?? ""}, true), set_config('app.user_id', ${settings.userId ?? ""}, true)`,
      );
      return fn(tx);
    });
  }

  return {
    async withTenant(ctx, fn) {
      assertUuid("userId", ctx.userId);
      assertUuid("workspaceId", ctx.workspaceId);
      return run("mushin_app", ctx, (tx) => fn(tx as TenantTx));
    },
    async withUser(userId, fn) {
      assertUuid("userId", userId);
      return run("mushin_app", { userId }, (tx) => fn(tx as UserTx));
    },
    withSystem(fn) {
      return run("mushin_worker", {}, (tx) => fn(tx as SystemTx));
    },
    async withWorkspace(workspaceId, fn) {
      assertUuid("workspaceId", workspaceId);
      return run("mushin_worker", { workspaceId }, (tx) => fn(tx as TenantTx));
    },
    async listen(channel, onNotify) {
      const sub = await listenClient().listen(channel, () => onNotify());
      return () => sub.unlisten();
    },
    async ping() {
      await client`select 1`;
      return "ok";
    },
    async close() {
      await client.end({ timeout: 5 });
      if (listener) await listener.end({ timeout: 5 });
    },
  };
}
