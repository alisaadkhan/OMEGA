import { readCaFile } from "@mushin/core";
import { migrate } from "./migrate";
import { assertDisposableTestDatabaseUrl } from "./testing";
import { UNVERIFIED_TLS_WARNING } from "./tls";

const test = process.argv.includes("--test");
const name = test ? "TEST_DATABASE_URL" : "DIRECT_URL";
const url = process.env[name];

if (!url || !/^postgres(ql)?:\/\//.test(url) || /@host:\d+\//.test(url)) {
  console.error(`${name} is missing or still a placeholder in .env (use the session pooler URL, port 5432).`);
  process.exit(1);
}
// `--test` targets the throwaway integration database only: never a hosted project left in TEST_DATABASE_URL.
if (test) {
  try {
    assertDisposableTestDatabaseUrl(url);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const caPem = readCaFile(process.env[test ? "TEST_DATABASE_SSL_CA_FILE" : "DATABASE_SSL_CA_FILE"]);
if (!caPem) console.warn(UNVERIFIED_TLS_WARNING);
const ran = await migrate(url, { log: (m) => console.log(m), caPem });
console.log(ran.length ? `done: ${ran.length} migration(s) applied` : "already up to date");
