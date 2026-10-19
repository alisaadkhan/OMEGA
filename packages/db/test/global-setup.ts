import { assertTruncatableTestDatabaseUrl, ownerQuery } from "../src/testing";
import { migrate } from "../src/migrate";
import { testCaPem } from "../src/testing";

export default async function setup(): Promise<void> {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Add the test project's session pooler URL to .env.");
  await migrate(assertTruncatableTestDatabaseUrl(url), { caPem: testCaPem() });
  // Test fixture: the credit tests compute balances from a 200-credit trial (the allowance before 0050). The shipped
  // allowance, 2,500 (owner decision 2026-10-19), is asserted against migration 0050 in trial-allowance.test.ts and
  // used by trials.int.test.ts, which sets it for its own run.
  await ownerQuery(`update platform.billing_settings set trial_credits = 200`);
}
