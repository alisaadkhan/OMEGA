/* global process, console, document, URL, setTimeout, fetch -- Node script driving a browser */
// Staff console smoke (local only, mushin_e2e_team): password + authenticator sign-in through the UI for a Super Admin
// and a Support account, every console section each role is offered, role limits in the UI and the API, axe-core
// (WCAG 2.2 A/AA, serious and critical) on each section, and no 5xx. Security keys (WebAuthn step-up) are not
// exercised here: they need a real or virtual authenticator.  Usage: node journey.mjs <label>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { generate } from "otplib";

const label = process.argv[2] ?? "staff";
const out = process.env.E2E_STAFF_OUT ?? join(tmpdir(), "mushin-e2e-staff");
mkdirSync(out, { recursive: true });
const staff = JSON.parse(readFileSync(join(out, "staff.json"), "utf8"));
const APP = "http://localhost:5174";
const API = "http://localhost:4100";
// Browser driver and axe-core come from the customer harness's local install (scripts/e2e-customer: npm install).
const harness = createRequire(new URL("../e2e-customer/package.json", import.meta.url));
const { chromium } = harness("playwright-core");
const AXE = readFileSync(harness.resolve("axe-core/axe.min.js"), "utf8");
const results = [];
const check = (area, name, ok, detail = "") => {
  results.push({ area, name, ok, detail: String(detail).slice(0, 300) });
  console.log(ok ? "PASS" : "FAIL", "|", area, "|", name, detail ? `| ${String(detail).slice(0, 200)}` : "");
};
async function axeFindings(p) {
  if (!(await p.evaluate(() => typeof globalThis.axe !== "undefined"))) await p.addScriptTag({ content: AXE });
  return p.evaluate(async () => {
    const r = await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } });
    // The offending element's markup is captured in the same pass: a toast can be gone a moment later.
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}) ${v.nodes.map((n) => n.html.slice(0, 160)).join(" ; ")}`);
  });
}
// A code is accepted once (replay protection), so each sign-in waits for a fresh 30-second step.
const nextStep = () => new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1500));
async function apiToken(who) {
  await nextStep();
  const login = await fetch(`${API}/admin/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: staff[who].email, password: staff[who].password }) });
  const { challengeToken } = await login.json();
  const totp = await fetch(`${API}/admin/v1/auth/totp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeToken, code: await generate({ secret: staff[who].totpSecret }) }) });
  return (await totp.json()).accessToken;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const serverErrors = [];
const pageErrors = [];
const ADMIN_ONLY = ["Providers", "Removal requests", "Approvals", "Staff", "Audit log"];
const EVERYONE = ["Overview", "Jobs", "Workspaces", "Workspace access", "Support queue", "Security"];

for (const who of ["super1", "support"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  p.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`${who} ${r.status()} ${r.url()}`); });
  p.on("pageerror", (e) => pageErrors.push(`${who}: ${e.message}`));
  await p.goto(`${APP}/#/admin/login`);
  await p.getByLabel("Staff email").waitFor({ timeout: 30000 });
  if (who === "super1") { const f = await axeFindings(p); check("a11y", "Staff sign-in page: no serious or critical WCAG 2.2 A/AA issues", f.length === 0, f.join(" | ")); }
  await nextStep();
  await p.getByLabel("Staff email").fill(staff[who].email);
  await p.getByLabel("Password").fill(staff[who].password);
  await p.getByRole("button", { name: /sign in|continue/i }).click();
  const codeField = p.getByLabel("6-digit code from your authenticator app");
  await codeField.waitFor({ timeout: 20000 });
  await codeField.fill(await generate({ secret: staff[who].totpSecret }));
  await p.getByRole("button", { name: /verify|sign in|continue/i }).click();
  await p.getByText("MUSHIN · OPS").waitFor({ timeout: 30000 });
  const role = staff[who].role === "super_admin" ? "Super Admin" : "Support";
  check("staff", `${role} signs in with password and authenticator code`, await p.getByText(role, { exact: true }).first().isVisible());

  if (who === "super1") {
    // Admin sections need a security key. Chrome's virtual authenticator stands in for a hardware key (WebAuthn).
    const open = async (name) => { await p.getByRole("button", { name, exact: true }).first().click(); await p.waitForTimeout(1000); };
    await open("Staff");
    check("security", "without a security key, admin sections ask for one and show no data", await p.getByText("Admin actions need a security key. Register one first.").first().isVisible() && !(await p.getByText(staff.support.email).isVisible().catch(() => false)));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await open("Security");
    await p.getByLabel("Name").fill("E2E virtual key");
    await p.getByRole("button", { name: "Add security key" }).click();
    await p.getByText("E2E virtual key").first().waitFor({ timeout: 20000 });
    check("security", "a Super Admin registers a security key in Security", true);
    await p.getByRole("button", { name: "Confirm with security key" }).first().click();
    await p.getByText("Admin actions need your security key.").first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
    await open("Staff");
    await p.getByText(staff.support.email).first().waitFor({ timeout: 20000 }).catch(() => {});
    check("security", "after confirming with the key, the staff directory lists every staff account", (await Promise.all(["super1", "super2", "admin", "support"].map((k) => p.getByText(staff[k].email).first().isVisible().catch(() => false)))).every(Boolean));
    await open("Audit log");
    await p.getByLabel("Action starts with").fill("staff.super_admin");
    await p.getByRole("button", { name: "Filter" }).click();
    const rows = p.locator("tbody tr").filter({ hasText: "staff.super_admin.bootstrapped" });
    await rows.first().waitFor({ timeout: 20000 }).catch(() => {});
    const auditText = (await p.locator("tbody").innerText().catch(() => "")).replace(/\s+/g, " ");
    check("audit", "the audit log shows both Super Admin bootstraps with operator and reason", (await rows.count()) === 2 && auditText.includes("Staff E2E: first platform owner") && auditText.includes("Staff E2E: second owner for co-sign"), auditText.slice(0, 200));
  }
  const offered = [];
  for (const name of [...EVERYONE, ...ADMIN_ONLY]) if (await p.getByRole("button", { name, exact: true }).first().isVisible().catch(() => false)) offered.push(name);
  const expected = who === "support" ? EVERYONE : [...EVERYONE, ...ADMIN_ONLY];
  check("staff", `${role} is offered exactly the sections of the role`, expected.every((n) => offered.includes(n)) && offered.length === expected.length, offered.join(", "));
  for (const name of offered) {
    await p.getByRole("button", { name, exact: true }).first().click();
    await p.waitForTimeout(1200);
    // A toast caught mid-fade is reported at partial opacity; scan the settled page.
    for (const b of await p.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
    await p.waitForTimeout(400);
    const found = await axeFindings(p);
    check("a11y", `${role} › ${name}: no serious or critical WCAG 2.2 A/AA issues`, found.length === 0, found.join(" | "));
  }
  await ctx.close();
}

const supportToken = await apiToken("support");
const blocked = await Promise.all(["/admin/v1/staff", "/admin/v1/audit", "/admin/v1/ops/provider-controls"].map(async (path) => (await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${supportToken}` } })).status));
check("roles", "Support is refused staff management, the audit log and provider controls (API 403)", blocked.every((s) => s === 403), blocked.join(","));
const adminToken = await apiToken("admin");
const keyless = await fetch(`${API}/admin/v1/staff`, { headers: { authorization: `Bearer ${adminToken}` } });
check("security", "an Admin session without a security-key confirmation is refused admin reads (API 403 hardware_key_required)", keyless.status === 403 && (await keyless.json()).error?.details?.reason === "hardware_key_required");
check("health", "no 5xx responses", serverErrors.length === 0, serverErrors.join(" | "));
check("health", "no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
writeFileSync(join(out, `results-${label}.json`), JSON.stringify({ label, at: new Date().toISOString(), passed: results.length - failed, failed, results }));
console.log(JSON.stringify({ label, passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
