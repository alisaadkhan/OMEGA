/**
 * Credential containment (audit H §3 step 4): after rotating STAFF_JWT_SECRET, end every staff session and step-up so
 * nothing minted before the rotation keeps working. Audited (staff.sessions.revoked_all). Every staff member signs in
 * again with password + authenticator and repeats the security-key step-up.
 *   node --env-file-if-exists=.env --import tsx scripts/revoke-staff-sessions.ts --reason "STAFF_JWT_SECRET rotated 2026-10-17"
 * Uses DIRECT_URL (owner role) from the environment; prints counts only.
 */
import { parseArgs } from "node:util";
import postgres from "postgres";

const { values } = parseArgs({ options: { reason: { type: "string" } } });
const url = process.env["DIRECT_URL"];
if (!url || !values.reason || values.reason.trim().length < 8) {
  console.error('usage: revoke-staff-sessions.ts --reason "<why, at least 8 characters>" (DIRECT_URL must be set)');
  process.exit(2);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const [r] = await sql<{ v: { sessions: number; stepUps: number } }[]>`select staff.revoke_all_sessions(${values.reason}) v`;
  console.log(`revoked ${r?.v.sessions ?? 0} staff sessions and ${r?.v.stepUps ?? 0} step-ups (audited)`);
} finally {
  await sql.end({ timeout: 5 });
}
