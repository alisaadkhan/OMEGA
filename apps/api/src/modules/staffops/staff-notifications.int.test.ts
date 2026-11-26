import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockEmailProvider } from "@mushin/integrations";
import { buildTestApp } from "../../test-support/app";
import { TEST_KEY } from "../creators/test-fixtures";
import { createStaffModule, createStaffTokens, type StaffPrincipal } from "../staff/index";
import { TEST_WEBAUTHN } from "../staff/test-fixtures";
import { createStaffMailer, registerStaffNotificationRoutes } from "./staff-notifications";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

async function setup() {
  const staff = createStaffModule({ db, tokens: createStaffTokens("r".repeat(48)), encryptionKey: TEST_KEY, webauthn: TEST_WEBAUTHN });
  const app = await buildTestApp({
    modules: [
      staff.module,
      {
        name: "staff-notifications",
        register: (a) =>
          registerStaffNotificationRoutes(a, {
            db,
            r: staff.requireStaff,
            staffOf: (req) => req.staff as StaffPrincipal,
          }),
      },
    ],
  });
  const token = async (role: "admin" | "support") => {
    const email = `${role}-${randomUUID().slice(0, 6)}@mushin.pk`;
    const acct = await staff.createStaffAccount({ email, name: `${role} person`, role });
    const { challengeToken } = (await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email, password: acct.password } })).json();
    const res = await app.inject({ method: "POST", url: "/admin/v1/auth/totp", payload: { challengeToken, code: await generate({ secret: acct.totpSecret }) } });
    return { email, headers: { authorization: `Bearer ${(res.json() as { accessToken: string }).accessToken}` } };
  };
  return { app, token };
}

type List = { notifications: { kind: string; title: string; body: string; link: string | null; read: boolean }[]; unread: number; emailOn: boolean };

describe("staff notifications (owner, 25 Nov, 0106)", () => {
  it("notifies on a new user, trial form and ticket; Support sees tickets only; reading clears the count", async () => {
    const { app, token } = await setup();
    const admin = await token("admin");
    const support = await token("support");
    const [u] = await ownerQuery<{ id: string }>(`insert into wp.users (id, email, display_name) values (gen_random_uuid(), 'nida@brand.pk', 'Nida') returning id`);
    const [w] = await ownerQuery<{ id: string }>(`insert into wp.workspaces (name, owner_user_id) values ('Nida Brand', '${u?.id}') returning id`);
    await ownerQuery(`insert into platform.trial_requests (contact_name, business_name, phone, callback_window, consent_text, consent_at) values ('Nida', 'Nida Brand', '+923001234567', 'morning', 'ok', now())`);
    await ownerQuery(`insert into wp.support_tickets (workspace_id, created_by, subject, category) values ('${w?.id}', '${u?.id}', 'Cannot export', 'other')`);

    const seen = (await app.inject({ method: "GET", url: "/admin/v1/notifications", headers: admin.headers })).json() as List;
    expect(seen.notifications.map((n) => n.kind).sort()).toEqual(["new_user", "ticket", "trial_request"]);
    expect(seen.notifications.find((n) => n.kind === "new_user")).toMatchObject({ title: "New user signed up", body: "nida@brand.pk", link: "#users" });
    expect(seen.unread).toBe(3);
    const bySupport = (await app.inject({ method: "GET", url: "/admin/v1/notifications", headers: support.headers })).json() as List;
    expect(bySupport.notifications.map((n) => n.kind)).toEqual(["ticket"]);

    expect((await app.inject({ method: "POST", url: "/admin/v1/notifications/read", headers: admin.headers, payload: {} })).statusCode).toBe(204);
    expect(((await app.inject({ method: "GET", url: "/admin/v1/notifications", headers: admin.headers })).json() as List).unread).toBe(0);
    // Each person's read state is their own.
    expect(((await app.inject({ method: "GET", url: "/admin/v1/notifications", headers: support.headers })).json() as List).unread).toBe(1);
  });

  it("emails each staff member once, skips those who turned email off, and keeps nothing waiting", async () => {
    const { app, token } = await setup();
    const admin = await token("admin");
    const quiet = await token("admin");
    expect((await app.inject({ method: "PUT", url: "/admin/v1/notifications/email", headers: quiet.headers, payload: { on: false } })).statusCode).toBe(204);
    await ownerQuery(`insert into wp.users (id, email, display_name) values (gen_random_uuid(), 'ali@brand.pk', 'Ali')`);
    const provider = new MockEmailProvider();
    const mailer = createStaffMailer({ db, provider, from: "MUSHIN <alerts@mushin.pk>", appUrl: "https://app.test", logger });
    expect(await mailer.drain()).toEqual({ sent: 1, failed: 0 });
    expect(provider.sent.map((m) => [m.to, m.subject])).toEqual([[admin.email, "[MUSHIN staff] New user signed up"]]);
    expect(await mailer.drain()).toEqual({ sent: 0, failed: 0 });
  });

  it("never emails a staff member disabled after the notification was made", async () => {
    const { token } = await setup();
    const gone = await token("admin");
    await ownerQuery(`insert into wp.users (id, email, display_name) values (gen_random_uuid(), 'sara@brand.pk', 'Sara')`);
    await ownerQuery(`update staff.staff_users set status = 'disabled' where email = '${gone.email}'`);
    const provider = new MockEmailProvider();
    const mailer = createStaffMailer({ db, provider, from: "MUSHIN <alerts@mushin.pk>", appUrl: "https://app.test", logger });
    expect(await mailer.drain()).toEqual({ sent: 0, failed: 0 });
    expect(provider.sent).toEqual([]);
    expect(await ownerQuery(`select status from staff.notification_emails`)).toEqual([{ status: "failed" }]);
  });
});
