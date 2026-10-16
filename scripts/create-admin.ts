import { parseArgs } from "node:util";
import qrcode from "qrcode-terminal";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createStaffModule, createStaffTokens } from "../apps/api/src/modules/staff/index";

/**
 * Out-of-band staff provisioning with database credentials (never reachable from the API).
 *   npm run create-admin -- --email a@mushin.pk --name "Name" [--role admin|support]
 *   npm run create-admin -- --role super_admin --bootstrap --email owner@mushin.pk --name "Owner" --operator "Owner" --reason "Initial platform owner"
 * A Super Admin is created only with --bootstrap, an operator and a reason; while an active Super Admin exists it also
 * needs --recovery (restoring lost access). Every Super Admin bootstrap is written to the staff audit log.
 */
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "admin" },
    bootstrap: { type: "boolean", default: false },
    recovery: { type: "boolean", default: false },
    operator: { type: "string" },
    reason: { type: "string" },
  },
});

const superAdmin = values.role === "super_admin";
if (!values.email || !values.name || !["admin", "support", "super_admin"].includes(values.role ?? "") || (superAdmin && (!values.bootstrap || !values.operator || !values.reason))) {
  console.error('Usage: npm run create-admin -- --email you@mushin.pk --name "Your Name" [--role admin|support]');
  console.error('       npm run create-admin -- --role super_admin --bootstrap --operator "Your Name" --reason "why" --email ... --name ... [--recovery]');
  process.exit(1);
}

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-create-admin", caPem: config.databaseCaPem });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey, webauthn: config.webauthn });
  const acct = superAdmin
    ? await staff.bootstrapSuperAdmin({ email: values.email, name: values.name, operator: values.operator ?? "", reason: values.reason ?? "", recovery: values.recovery })
    : await staff.createStaffAccount({ email: values.email, name: values.name, role: values.role as "admin" | "support" });
  console.log(`\nCreated ${values.role} ${values.email}`);
  console.log(`Temporary password (shown once): ${acct.password}`);
  console.log("\nScan this QR code with Google Authenticator, Microsoft Authenticator or 1Password:\n");
  qrcode.generate(acct.totpUri, { small: true });
  console.log(`If you cannot scan it, enter this key manually: ${acct.totpSecret}\n`);
  // Audit SEC-07: hand this over separately from the password (in person or another channel); valid for 72 hours, once.
  if (acct.enrolmentCode) console.log(`Security key enrolment code (one use, 72 hours; give it separately): ${acct.enrolmentCode}\n`);
} finally {
  await db.close();
}
