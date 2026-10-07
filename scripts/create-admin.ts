import { parseArgs } from "node:util";
import qrcode from "qrcode-terminal";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createStaffModule, createStaffTokens } from "../apps/api/src/modules/staff/index";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "admin" } },
});

if (!values.email || !values.name || (values.role !== "admin" && values.role !== "support")) {
  console.error('Usage: npm run create-admin -- --email you@mushin.pk --name "Your Name" [--role admin|support]');
  process.exit(1);
}

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-create-admin", caPem: config.databaseCaPem });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey });
  const acct = await staff.createStaffAccount({ email: values.email, name: values.name, role: values.role });
  console.log(`\nCreated ${values.role} ${values.email}`);
  console.log(`Temporary password (shown once): ${acct.password}`);
  console.log("\nScan this QR code with Google Authenticator, Microsoft Authenticator or 1Password:\n");
  qrcode.generate(acct.totpUri, { small: true });
  console.log(`If you cannot scan it, enter this key manually: ${acct.totpSecret}\n`);
} finally {
  await db.close();
}
