import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { hashPassword } from "../apps/api/src/modules/staff/passwords";
import * as repo from "../apps/api/src/modules/staff/repository";

/**
 * Out-of-band staff password reset (owner, 22 Nov), with database credentials only: never reachable from the API.
 *   npm run set-staff-password -- --email you@x.com --password '...' --operator "Your Name" [--two-factor off]
 * Signs the person out everywhere, clears any sign-in pause, and is written to the staff audit log. `--two-factor off`
 * also turns the authenticator code off, so they can sign in with the password and set it up again in Settings.
 */
const { values } = parseArgs({ options: { email: { type: "string" }, password: { type: "string" }, operator: { type: "string" }, "two-factor": { type: "string" } } });
const email = values.email?.trim().toLowerCase();
const password = values.password ?? "";
if (!email || password.length < 12 || !values.operator?.trim() || (values["two-factor"] !== undefined && values["two-factor"] !== "off")) {
  console.error('Usage: npm run set-staff-password -- --email you@x.com --password "at least 12 characters" --operator "Your Name" [--two-factor off]');
  process.exit(1);
}

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-set-staff-password", caPem: config.databaseCaPem });
try {
  const hash = await hashPassword(password);
  const twoFactorOff = values["two-factor"] === "off";
  const done = await db.withSystem(async (tx) => {
    const staff = await repo.findStaffByEmail(tx, email);
    if (!staff || staff.status !== "active") return false;
    await tx.execute(sql`update staff.staff_users set password_hash = ${hash}, failed_login_count = 0, locked_until = null, updated_at = now()
      ${twoFactorOff ? sql`, totp_enabled = false, totp_pending_encrypted = null` : sql``} where id = ${staff.id}`);
    await tx.execute(sql`update staff.staff_sessions set revoked_at = now() where staff_id = ${staff.id} and revoked_at is null`);
    await repo.audit(tx, { staffId: null, action: "staff.password.reset", targetType: "staff", targetId: staff.id, metadata: { operator: values.operator?.trim(), twoFactorOff }, ip: null, requestId: null });
    return true;
  });
  console.log(done ? `Password set for ${email}${twoFactorOff ? "; two-factor sign-in is off" : ""}. Existing sessions were signed out.` : `No active staff account with the email ${email}.`);
  if (!done) process.exitCode = 1;
} finally {
  await db.close();
}
