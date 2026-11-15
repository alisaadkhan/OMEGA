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
import { creatorProfileReviews, createDatabase, supportMessages, supportTickets, users, workspaceMembers, workspaces } from "@mushin/db";
import { addCreator } from "../../apps/api/src/modules/creators/test-fixtures";
import { createStaffModule, createStaffTokens } from "../../apps/api/src/modules/staff/index";

if (!/mushin_e2e_team$/.test(process.env["DATABASE_URL"] ?? "")) throw new Error("seed-staff runs only against mushin_e2e_team");
const config = loadApiConfig(process.env);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-e2e-staff-seed", caPem: null });
try {
  const staff = createStaffModule({ db, tokens: createStaffTokens(config.staffJwtSecret), encryptionKey: config.dataEncryptionKey, webauthn: config.webauthn });
  const out: Record<string, { id: string; email: string; password: string; totpSecret: string; role: string; enrolmentCode: string | null }> = {};
  const s1 = await staff.bootstrapSuperAdmin({ email: "owner1@mushin.test", name: "Owner One", operator: "E2E harness", reason: "Staff E2E: first platform owner", recovery: false });
  out["super1"] = { id: s1.id, email: "owner1@mushin.test", password: s1.password, totpSecret: s1.totpSecret, role: "super_admin", enrolmentCode: s1.enrolmentCode };
  const s2 = await staff.bootstrapSuperAdmin({ email: "owner2@mushin.test", name: "Owner Two", operator: "E2E harness", reason: "Staff E2E: second owner for co-sign", recovery: true });
  out["super2"] = { id: s2.id, email: "owner2@mushin.test", password: s2.password, totpSecret: s2.totpSecret, role: "super_admin", enrolmentCode: s2.enrolmentCode };
  for (const [key, role, name] of [["admin", "admin", "Adam Ops"], ["support", "support", "Sam Support"]] as const) {
    const email = `${key}@mushin.test`;
    const a = await staff.createStaffAccount({ email, name, role });
    out[key] = { id: a.id, email, password: a.password, totpSecret: a.totpSecret, role, enrolmentCode: a.enrolmentCode };
  }
  // A customer with a support ticket and a flagged creator (owner directive 2026-11-15 §3 and §5): the journey works the
  // ticket as Support (reply, open → in progress → resolved → closed) and the flag as Super Admin (dismiss).
  const customer = { userId: "77777777-7777-4777-8777-777777777777", workspaceId: "88888888-8888-4888-8888-888888888888" };
  await db.withUser(customer.userId, (tx) => tx.insert(users).values({ id: customer.userId, email: "brand@e2e-staff.test", displayName: "Brand Owner" }).onConflictDoNothing());
  await db.withTenant(customer, async (tx) => {
    await tx.insert(workspaces).values({ id: customer.workspaceId, name: "E2E Brand", ownerUserId: customer.userId }).onConflictDoNothing();
    await tx.insert(workspaceMembers).values({ workspaceId: customer.workspaceId, userId: customer.userId, role: "owner" }).onConflictDoNothing();
  });
  const creatorId = await addCreator(db, { displayName: "E2E Flagged Shop" });
  const ticketId = await db.withTenant(customer, async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ workspaceId: customer.workspaceId, createdBy: customer.userId, subject: "E2E: wrong follower count", category: "creator_data" }).returning({ id: supportTickets.id });
    if (!t) throw new Error("ticket not created");
    await tx.insert(supportMessages).values({ ticketId: t.id, workspaceId: customer.workspaceId, authorKind: "customer", authorUserId: customer.userId, body: "The follower count on this creator looks wrong." });
    await tx.insert(creatorProfileReviews).values({ workspaceId: customer.workspaceId, submittedBy: customer.userId, creatorId, sourceMode: "live_discovery", verdict: "invalid", reason: "not_individual_creator", note: "This is a shop, not a person" });
    return t.id;
  });
  const dir = process.env["E2E_STAFF_OUT"] ?? join(tmpdir(), "mushin-e2e-staff");
  writeFileSync(join(dir, "staff.json"), JSON.stringify({ ...out, fixtures: { ticketId, creatorId } }));
  console.log(`seeded ${Object.keys(out).length} staff accounts`);
} finally {
  await db.close();
}
