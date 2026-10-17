/**
 * Verifies the hash chain of the staff audit log (audit SEC-10) and prints today's digest: `<seq>:<hash>` of the latest
 * entry. Run daily and store the digest outside the database (a different account than the database's). Passing an
 * earlier digest also proves that point of the log is unchanged, which catches a chain rewritten end to end.
 *   npm run ops:verify-audit -- [--digest <seq>:<hash> ...]      exits 1 on any break
 */
import { parseArgs } from "node:util";
import { loadWorkerConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { sql } from "drizzle-orm";

const { values } = parseArgs({ options: { digest: { type: "string", multiple: true, default: [] } } });
const config = loadWorkerConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-verify-audit", caPem: config.databaseCaPem });
let ok = true;
try {
  const [v] = await db.withSystem((tx) => tx.execute<{ rows: string; first_broken_seq: string | null; head_hash: string | null }>(sql`select * from platform.verify_staff_audit_chain()`));
  if (v?.first_broken_seq) {
    ok = false;
    console.log(`FAIL | the staff audit log was changed at entry ${v.first_broken_seq} (of ${v.rows}): investigate before trusting it`);
  } else {
    console.log(`PASS | ${v?.rows ?? 0} entries, chain intact`);
  }
  for (const d of values.digest) {
    const [seq, hash] = d.split(":");
    const [row] = await db.withSystem((tx) => tx.execute<{ h: string }>(sql`select row_hash h from staff.audit_log where seq = ${Number(seq)}`));
    const same = row?.h === hash;
    ok &&= same;
    console.log(`${same ? "PASS" : "FAIL"} | earlier digest ${seq}:${(hash ?? "").slice(0, 12)}… ${same ? "still matches" : "no longer matches: the log was rewritten"}`);
  }
  const [head] = await db.withSystem((tx) => tx.execute<{ seq: string; h: string }>(sql`select seq::text, row_hash h from staff.audit_log order by seq desc limit 1`));
  if (head) console.log(`digest ${new Date().toISOString().slice(0, 10)}: ${head.seq}:${head.h}`);
} finally {
  await db.close();
}
process.exitCode = ok ? 0 : 1;
