import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("./migrate-cli.ts", import.meta.url));

describe("db:migrate:test", () => {
  it("refuses a hosted TEST_DATABASE_URL before connecting (it would push every migration to that project)", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", cli, "--test"], {
      env: { ...process.env, TEST_DATABASE_URL: "postgresql://postgres.abc:x@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("must point to localhost");
  });
});
