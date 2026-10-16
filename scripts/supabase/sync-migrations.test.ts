import { describe, expect, it } from "vitest";
import { plan, PRELUDE_NAME, supabaseName } from "./sync-migrations";

/** The Supabase CLI copy of the migrations must never drift from packages/db/migrations. */
describe("supabase/migrations", () => {
  it("names each migration with the CLI's timestamp, in the same order", () => {
    expect(supabaseName("0001_foundation.sql")).toBe("20261001000001_foundation.sql");
    expect(supabaseName("0040_data_exports.sql")).toBe("20261001000040_data_exports.sql");
    expect(() => supabaseName("bad.sql")).toThrow();
    const names = plan().map((p) => p.name);
    expect(names[0]).toBe(PRELUDE_NAME);
    expect([...names].sort()).toEqual(names);
  });

  it("holds an identical copy of every migration (run scripts/supabase/sync-migrations.ts after adding one)", () => {
    expect(plan().filter((p) => p.current !== p.body).map((p) => p.name)).toEqual([]);
  });
});
