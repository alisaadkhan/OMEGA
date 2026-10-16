/**
 * Creates the staff accounts for the staff/team E2E in mushin_e2e_team (local only): two Super Admins through the
 * bootstrap path (the second as an audited recovery, so two people can co-sign), one Admin and one Support. Writes their
 * one-time passwords and TOTP secrets to <E2E_STAFF_OUT>/staff.json for the journey (a disposable local database).
 *   node --env-file-if-exists=.env --import tsx scripts/e2e-staff/seed-staff.ts   (with scripts/e2e-staff/env.sh sourced)
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApiConfig } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { createStaffModule, createStaffTokens } from "../../apps/api/src/modules/staff/index";

if (!/mushin_e2e_team$/.test(process.env["DATABASE_URL"] ?? "")) throw new Error("seed-staff runs only against mushin_e2e_team");
const config = loadApiConfig(process.env);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-e2e-staff-seed", caPem: null });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey, webauthn: config.webauthn });
  const out: Record<string, { id: string; email: string; password: string; totpSecret: string; role: string }> = {};
  const s1 = await staff.bootstrapSuperAdmin({ email: "owner1@mushin.test", name: "Owner One", operator: "E2E harness", reason: "Staff E2E: first platform owner", recovery: false });
  out["super1"] = { id: s1.id, email: "owner1@mushin.test", password: s1.password, totpSecret: s1.totpSecret, role: "super_admin" };
  const s2 = await staff.bootstrapSuperAdmin({ email: "owner2@mushin.test", name: "Owner Two", operator: "E2E harness", reason: "Staff E2E: second owner for co-sign", recovery: true });
  out["super2"] = { id: s2.id, email: "owner2@mushin.test", password: s2.password, totpSecret: s2.totpSecret, role: "super_admin" };
  for (const [key, role, name] of [["admin", "admin", "Adam Ops"], ["support", "support", "Sam Support"]] as const) {
    const email = `${key}@mushin.test`;
    const a = await staff.createStaffAccount({ email, name, role });
    out[key] = { id: a.id, email, password: a.password, totpSecret: a.totpSecret, role };
  }
  const dir = process.env["E2E_STAFF_OUT"] ?? join(tmpdir(), "mushin-e2e-staff");
  writeFileSync(join(dir, "staff.json"), JSON.stringify(out));
  console.log(`seeded ${Object.keys(out).length} staff accounts`);
} finally {
  await db.close();
}
