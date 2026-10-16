/* global process, console, fetch, setTimeout, URL -- Node script */
// Password recovery in a real browser against the LOCAL Supabase stack (audit UX-02): the "Forgot password" form, the
// recovery email caught by the local Mailpit, the link opened in the same browser (PKCE code exchange), the new password
// saved on #/reset-password, and the link refused when used again. Nothing leaves this machine.
//   Needs: `supabase start`, and the frontend on :5175 built against the local stack (see recovery-check.sh).
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const status = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) throw new Error("recovery-check runs against the local Supabase stack only");
const AUTH = `${status.API_URL}/auth/v1`;
const MAIL = status.INBUCKET_URL ?? status.MAILPIT_URL ?? "http://127.0.0.1:54324";
const serviceKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
const anonKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const APP = process.env.RECOVERY_APP_URL ?? "http://localhost:5175";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(ok ? "PASS" : "FAIL", "|", name, detail ? `| ${detail}` : "");
};
const signIn = (email, password) =>
  fetch(`${AUTH}/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => r.status);

const email = `recovery-${randomUUID().slice(0, 8)}@example.com`;
const oldPassword = `Old-${randomUUID()}`;
const newPassword = `New-${randomUUID()}`;
const created = await fetch(`${AUTH}/admin/users`, {
  method: "POST",
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
  body: JSON.stringify({ email, password: oldPassword, email_confirm: true }),
});
check("a confirmed test user exists", created.status === 200, `${created.status}`);

async function recoveryLink() {
  for (let i = 0; i < 30; i++) {
    const found = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
    const id = found.messages?.[0]?.ID;
    if (id) {
      const msg = await fetch(`${MAIL}/api/v1/message/${id}`).then((r) => r.json());
      const m = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP}/#/forgot`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 15_000 });
  check("the Forgot password form sends a recovery email", true);

  const link = await recoveryLink();
  check("the recovery email reaches the local mailbox with a link", Boolean(link));
  const redirect = link ? new URL(link).searchParams.get("redirect_to") : null;
  check("the link returns to the set-new-password route", redirect === `${APP}/#/reset-password`, String(redirect));

  await page.goto(link);
  await page.getByText("Set a new password").waitFor({ timeout: 15_000 });
  const landed = new URL(page.url());
  check("following the link signs the person in on #/reset-password, with the one-time code removed from the address", landed.hash === "#/reset-password" && !landed.search.includes("code="), page.url().replace(/code=[^&#]+/, "code=…"));

  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat the new password").fill(`${newPassword}x`);
  await page.getByRole("button", { name: "Save new password" }).click();
  check("mismatched passwords are refused on the page", await page.getByRole("alert").filter({ hasText: "do not match" }).isVisible());

  await page.getByLabel("Repeat the new password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.waitForURL(/#\/dashboard/, { timeout: 15_000 });
  check("saving the new password continues to the dashboard", true);
  check("the new password signs in", (await signIn(email, newPassword)) === 200);
  check("the old password no longer signs in", (await signIn(email, oldPassword)) >= 400);

  const other = await (await browser.newContext()).newPage();
  await other.goto(link);
  await other.getByText("This link no longer works").waitFor({ timeout: 15_000 });
  await other.getByText("invalid or has expired").waitFor({ timeout: 5_000 }).catch(() => {});
  check("the used link is refused with the reason and offers a new one", (await other.getByText("invalid or has expired").isVisible()) && (await other.getByRole("button", { name: "Request a new link" }).isVisible()) && new URL(other.url()).hash === "#/reset-password", other.url());
} catch (err) {
  check("browser flow completed", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ check: "password-recovery", passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
