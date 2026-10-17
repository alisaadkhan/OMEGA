import { parseArgs } from "node:util";
import postgres from "postgres";
import { readCaFile } from "@mushin/core";
import { rotateEncryptionKey, tlsOptions, UNVERIFIED_TLS_WARNING } from "@mushin/db";

/**
 * DATA_ENCRYPTION_KEY rotation (audit SEC-09; completes SEC-01 step "rotate the encryption key"). Re-encrypts creator
 * contacts, removal-request emails and staff TOTP secrets under the new key. Values are never printed.
 *
 * Procedure (short maintenance window):
 *   1. Generate the new key: npm run env:secrets (or `openssl rand -base64 32`). Keep the old one until step 5.
 *   2. Stop the API and the worker (they hold one key and would write values the other key cannot read).
 *   3. Dry run:  DATA_ENCRYPTION_KEY=<new> DATA_ENCRYPTION_KEY_PREVIOUS=<old> npm run rotate-encryption-key
 *      It must report 0 undecryptable values. If not, find the missing old key before going on.
 *   4. Apply:    same with -- --apply --operator "Name" --reason "why". Writes a staff audit entry (counts and key ids).
 *   5. Put the new key in the API and worker configuration, start them, check sign-in (TOTP) and a contact reveal.
 *      Then destroy every copy of the old key.
 * Needs DIRECT_URL (database owner, session pooler).
 */
const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, operator: { type: "string" }, reason: { type: "string" } } });
const decode = (name: string, b64: string) => {
  const k = Buffer.from(b64.trim(), "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
};
const newKey = decode("DATA_ENCRYPTION_KEY", process.env["DATA_ENCRYPTION_KEY"] ?? "");
const previousKeys = (process.env["DATA_ENCRYPTION_KEY_PREVIOUS"] ?? "").split(",").filter((s) => s.trim()).map((s) => decode("DATA_ENCRYPTION_KEY_PREVIOUS", s));
if (previousKeys.length === 0) throw new Error("set DATA_ENCRYPTION_KEY_PREVIOUS to the old key (comma-separated if several)");
if (values.apply && (!values.operator || (values.reason ?? "").trim().length < 12)) throw new Error('--apply needs --operator "Name" and --reason (12+ characters)');
const url = process.env["DIRECT_URL"] ?? "";
const caPem = readCaFile(process.env["DATABASE_SSL_CA_FILE"]);
if (!caPem) console.warn(UNVERIFIED_TLS_WARNING);
const sql = postgres(url, { max: 2, prepare: false, ssl: tlsOptions(caPem, url), onnotice: () => {} });
try {
  const report = await rotateEncryptionKey(sql, { newKey, previousKeys, apply: values.apply });
  console.table(report.columns.map((c) => ({ column: `${c.table}.${c.column}`, rows: c.rows, byKey: JSON.stringify(c.byKey), undecryptable: c.undecryptable, reencrypted: c.reencrypted })));
  const blocked = report.columns.some((c) => c.undecryptable > 0);
  if (blocked) {
    console.error("Refused: some values open with none of the given keys. Nothing was changed.");
    process.exitCode = 1;
  } else if (report.apply) {
    await sql`insert into staff.audit_log (action, metadata) values ('platform.encryption_key_rotated', ${sql.json({ operator: values.operator, reason: values.reason, newKeyId: report.newKeyId, columns: report.columns.map((c) => ({ column: `${c.table}.${c.column}`, reencrypted: c.reencrypted })) })})`;
    console.log(`Done: every value now uses key ${report.newKeyId}. Configure the API and worker with the new key, then destroy the old one.`);
  } else {
    console.log(`Dry run: nothing changed. New key id ${report.newKeyId}. Re-run with -- --apply --operator ... --reason ... to re-encrypt.`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
