import { assertDisposableTestDatabaseUrl } from "../src/testing";
import { migrate } from "../src/migrate";
import { testCaPem } from "../src/testing";

export default async function setup(): Promise<void> {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Add the test project's session pooler URL to .env.");
  await migrate(assertDisposableTestDatabaseUrl(url), { caPem: testCaPem() });
}
