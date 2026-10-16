import { parseArgs } from "node:util";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createStaffModule, createStaffTokens } from "../apps/api/src/modules/staff/index";

/**
 * A new one-time code for an Admin's or Super Admin's first security key (audit SEC-07): after a lost key (once the
 * old keys are revoked) or an expired code. Out of band, with database credentials; never reachable from the API.
 * Any earlier unused code of that person stops working. Audited with the operator and reason.
 *   npm run issue-enrolment-code -- --email admin@mushin.pk --operator "Your Name" --reason "Lost key reported 2026-10-17"
 */
const { values } = parseArgs({ options: { email: { type: "string" }, operator: { type: "string" }, reason: { type: "string" } } });
if (!values.email || !values.operator || !values.reason) {
  console.error('Usage: npm run issue-enrolment-code -- --email admin@mushin.pk --operator "Your Name" --reason "why (12+ characters)"');
  process.exit(1);
}
const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-issue-enrolment-code", caPem: config.databaseCaPem });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey, webauthn: config.webauthn });
  const { code, expiresAt } = await staff.issueEnrolmentCode({ email: values.email, operator: values.operator, reason: values.reason });
  console.log(`\nEnrolment code for ${values.email} (one use, until ${expiresAt.toISOString()}): ${code}`);
  console.log("Give it to them in person or over a channel other than the one their password went through.\n");
} finally {
  await db.close();
}
