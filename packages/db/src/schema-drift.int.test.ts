import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ALL_TABLES } from "./schema";
import { ownerQuery } from "./testing";

describe("Drizzle schema matches the database", () => {
  for (const table of ALL_TABLES) {
    const cfg = getTableConfig(table);
    it(`${cfg.schema}.${cfg.name}`, async () => {
      const cols = await ownerQuery<{ column_name: string; is_nullable: "YES" | "NO" }>(`
        select column_name, is_nullable from information_schema.columns
        where table_schema = '${cfg.schema}' and table_name = '${cfg.name}' order by column_name`);
      const live = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable === "NO"]));
      const declared = Object.fromEntries(cfg.columns.map((c) => [c.name, c.notNull]));
      expect(declared).toEqual(live);
    });
  }
});
