/* global process, console, document, URL, setTimeout, fetch -- Node script driving a browser */
// Staff portal smoke at /_omega_ (local only, mushin_e2e_team): password + authenticator sign-in through the UI for a Super Admin
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
// A code is accepted once (replay protection), so each sign-in waits for a fresh 30-second step. The API also allows 5
// sign-in calls per address per minute (rate-limit "auth" bucket); a sign-in is two calls (password, code), so before
// each one the journey waits until both fit, or three sign-ins 30 s apart trip the limit (seen 2026-11-15).
const signInCalls = [];
const nextStep = async () => {
  for (;;) {
    while (signInCalls.length && Date.now() - signInCalls[0] > 62_000) signInCalls.shift();
    if (signInCalls.length <= 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1500));
  signInCalls.push(Date.now(), Date.now());
};
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
const coverageCards = {};
const ADMIN_ONLY = ["Subscriptions", "Data Sources", "Data Removals", "Approvals", "Staff Team", "Activity & Security"];
const EVERYONE = ["Overview", "System Health", "Users", "Tickets", "Live Scans", "Creator Checks", "Reported Profiles", "Trials & Stats", "Customer Access", "Settings"];
const nav = (p) => p.getByRole("navigation", { name: "Staff portal" });

// Staff portal (owner, 22 Nov): staff sign in only at /_omega_; the old #/staff and #/admin links show not found.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(`${APP}/_omega_`);
  await p.getByRole("heading", { name: "Staff Sign In" }).waitFor({ timeout: 30000 });
  check("portals", "/_omega_ opens the staff sign-in, marked staff only", await p.getByText("Staff Only", { exact: true }).isVisible());
  const oldLinks = [];
  for (const h of ["#/staff/login", "#/admin/login", "#/admin"]) {
    await p.goto(`${APP}/${h}`);
    await p.waitForTimeout(1500);
    if (await p.getByLabel("Work Email").isVisible().catch(() => false)) oldLinks.push(h);
  }
  check("portals", "the old #/staff and #/admin links no longer open a staff sign-in", oldLinks.length === 0, oldLinks.join(", "));
  await ctx.close();
}

for (const who of ["super1", "support"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  p.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`${who} ${r.status()} ${r.url()}`); });
  p.on("pageerror", (e) => pageErrors.push(`${who}: ${e.message}`));
  await p.goto(`${APP}/_omega_`);
  await p.getByLabel("Work Email").waitFor({ timeout: 30000 });
  if (who === "super1") { const f = await axeFindings(p); check("a11y", "Staff sign-in page: no serious or critical WCAG 2.2 A/AA issues", f.length === 0, f.join(" | ")); }
  await nextStep();
  await p.getByLabel("Work Email").fill(staff[who].email);
  await p.getByLabel("Password", { exact: true }).fill(staff[who].password);
  await p.getByRole("button", { name: "Sign In", exact: true }).click();
  // Seeded accounts have two-factor on, so the code is asked for in a second step (0094).
  await p.getByLabel("6-Digit Authenticator Code").waitFor({ timeout: 20000 });
  await p.getByLabel("6-Digit Authenticator Code").fill(await generate({ secret: staff[who].totpSecret }));
  await p.getByRole("button", { name: "Verify Code", exact: true }).click();
  await nav(p).waitFor({ timeout: 30000 });
  const role = staff[who].role === "super_admin" ? "Super Admin" : "Support";
  check("staff", `${role} signs in with password and authenticator code`, await p.getByText(role, { exact: true }).first().isVisible());
  // Each role lands on its own workspace (owner directive 2026-11-15 §2): Support on the support queue, admins on the overview.
  const landing = who === "support" ? "Tickets" : "Overview";
  await p.getByRole("heading", { name: landing, level: 1 }).waitFor({ timeout: 20000 }).catch(() => {});
  check("portals", `${role} lands on ${landing} after signing in`, await p.getByRole("heading", { name: landing, level: 1 }).isVisible().catch(() => false));
  if (who === "support") await nav(p).getByRole("button", { name: "Overview", exact: true }).click();
  const card = p.getByRole("region", { name: "Creator eligibility coverage" });
  await card.getByText(/creators in the search catalogue qualify/).waitFor({ timeout: 20000 }).catch(() => {});
  coverageCards[who] = (await card.innerText().catch(() => "")).replace(/\s+/g, " ");

  if (who === "super1") {
    // Admin sections need a security key. Chrome's virtual authenticator stands in for a hardware key (WebAuthn).
    const open = async (name) => { await nav(p).getByRole("button", { name, exact: true }).click(); await p.waitForTimeout(1000); };
    await open("Staff Team");
    check("security", "without a security key, admin sections ask for one and show no data", await p.getByRole("button", { name: "Security key needed" }).isVisible() && !(await p.getByText(staff.support.email).isVisible().catch(() => false)));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await open("Settings");
    await p.getByLabel("Enrolment code").fill(staff.super1.enrolmentCode); // issued with the account, out of band (audit SEC-07)
    await p.getByLabel("Name").fill("E2E virtual key");
    await p.getByRole("button", { name: "Add security key" }).click();
    await p.getByText("E2E virtual key").first().waitFor({ timeout: 20000 });
    check("security", "a Super Admin registers a security key in Settings", true);
    check("security", "Settings shows two-factor sign-in as on, with a way to turn it off", await p.getByRole("region", { name: "Two-factor sign-in" }).getByText("On", { exact: true }).isVisible().catch(() => false) && await p.getByRole("button", { name: "Turn off" }).isVisible().catch(() => false));
    await p.getByRole("button", { name: "Confirm security key" }).click();
    await p.getByText("Security key confirmed", { exact: true }).waitFor({ timeout: 20000 }).catch(() => {});
    await open("Staff Team");
    await p.getByText(staff.support.email).first().waitFor({ timeout: 20000 }).catch(() => {});
    check("security", "after confirming with the key, the staff directory lists every staff account", (await Promise.all(["super1", "super2", "admin", "support"].map((k) => p.getByText(staff[k].email).first().isVisible().catch(() => false)))).every(Boolean));
    // Creator flags (owner directive 2026-11-15 §3): the seeded customer flag is listed and dismissed in one step.
    // Users (owner, 22 Nov): the seeded customer account opens with its plan, credits and people.
    await open("Users");
    await p.locator("tbody tr").first().click();
    const drawer = p.getByRole("dialog");
    await drawer.getByText("Credit history").waitFor({ timeout: 20000 }).catch(() => {});
    const drawerText = (await drawer.innerText().catch(() => "")).replace(/\s+/g, " ");
    check("users", "a Super Admin opens an account: plan, credits, credit history, people, add credits and assign plan", ["Plan", "Credits", "Credit history", "People", "Add credits", "Assign plan"].every((t) => drawerText.toUpperCase().includes(t.toUpperCase())), drawerText.slice(0, 200));
    await drawer.getByRole("button", { name: "Close" }).click();
    await open("Subscriptions");
    check("users", "Subscriptions shows the plan distribution from the database", await p.getByRole("region", { name: "Plan distribution" }).isVisible().catch(() => false));
    // Trash and Ban (owner, 23 Nov): a Trash filter, and Move to Trash / Ban on the selected creator.
    await open("Creator Checks");
    await p.getByRole("button", { name: /^Trash/ }).first().waitFor({ timeout: 15000 }).catch(() => {});
    const trashPill = await p.getByRole("button", { name: /^Trash/ }).first().isVisible().catch(() => false);
    const trashBtns = (await p.getByRole("button", { name: "Move to Trash" }).count()) > 0 && (await p.getByRole("button", { name: "Ban", exact: true }).count()) > 0;
    check("creators", "Creator Checks has a Trash filter and Move to Trash / Ban actions", trashPill && trashBtns, `pill=${trashPill} buttons=${trashBtns}`);
    await open("Reported Profiles");
    const flag = p.getByRole("listitem", { name: "Flag on E2E Flagged Shop" });
    await flag.waitFor({ timeout: 20000 }).catch(() => {});
    const flagText = (await flag.innerText().catch(() => "")).replace(/\s+/g, " ");
    check("flags", "the customer's flag is listed with its reason, note and source, without the submitter", /Not an individual creator/.test(flagText) && flagText.includes("This is a shop, not a person") && /Live Discovery/.test(flagText) && !flagText.includes("brand@e2e-staff.test"), flagText.slice(0, 200));
    await flag.getByLabel("Decision note for E2E Flagged Shop").fill("Checked: a person runs this account");
    await flag.getByRole("button", { name: "Dismiss", exact: true }).click();
    await p.getByText("Flag dismissed").first().waitFor({ timeout: 20000 }).catch(() => {});
    check("flags", "a Super Admin dismisses the flag with a note (after the security-key confirmation)", await p.getByText("Flag dismissed").first().isVisible().catch(() => false));
    await open("Activity & Security");
    await p.getByLabel("Action starts with").fill("staff.super_admin");
    await p.getByRole("button", { name: "Filter" }).click();
    const rows = p.locator("tbody tr").filter({ hasText: "staff.super_admin.bootstrapped" });
    await rows.first().waitFor({ timeout: 20000 }).catch(() => {});
    const auditText = (await p.locator("tbody").innerText().catch(() => "")).replace(/\s+/g, " ");
    check("audit", "the audit log shows both Super Admin bootstraps with operator and reason", (await rows.count()) === 2 && auditText.includes("Staff E2E: first platform owner") && auditText.includes("Staff E2E: second owner for co-sign"), auditText.slice(0, 200));
  }
  const offered = [];
  for (const name of [...EVERYONE, ...ADMIN_ONLY]) if (await nav(p).getByRole("button", { name, exact: true }).isVisible().catch(() => false)) offered.push(name);
  const expected = who === "support" ? EVERYONE : [...EVERYONE, ...ADMIN_ONLY];
  check("staff", `${role} is offered exactly the sections of the role`, expected.every((n) => offered.includes(n)) && offered.length === expected.length, offered.join(", "));
  for (const name of offered) {
    await nav(p).getByRole("button", { name, exact: true }).click();
    await p.waitForTimeout(1200);
    // A toast caught mid-fade is reported at partial opacity; scan the settled page.
    for (const b of await p.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
    await p.waitForTimeout(400);
    const found = await axeFindings(p);
    check("a11y", `${role} › ${name}: no serious or critical WCAG 2.2 A/AA issues`, found.length === 0, found.join(" | "));
  }
  if (who === "support") {
    // Phone width (overnight directive §2 Persona C: 375×812): every section reachable and clean under axe.
    await p.setViewportSize({ width: 375, height: 812 });
    const unreachable = [];
    const issues = [];
    for (const name of offered) {
      await p.getByRole("button", { name: "Open menu" }).click().catch(() => {});
      const b = nav(p).getByRole("button", { name, exact: true });
      if (!(await b.isVisible().catch(() => false))) { unreachable.push(name); continue; }
      await b.click();
      await p.waitForTimeout(1000);
      for (const d of await p.getByRole("button", { name: "Dismiss" }).all()) await d.click().catch(() => {});
      await p.waitForTimeout(300);
      issues.push(...(await axeFindings(p)).map((f) => `${name}: ${f}`));
    }
    check("a11y", "Support console at 375×812: every section reachable from the menu", unreachable.length === 0, unreachable.join(", "));
    check("a11y", "Support console at 375×812: no serious or critical WCAG 2.2 A/AA issues", issues.length === 0, issues.slice(0, 5).join(" | "));
  }
  await ctx.close();
}

const supportToken = await apiToken("support");
const coverage = await (await fetch(`${API}/admin/v1/ops/eligibility`, { headers: { authorization: `Bearer ${supportToken}` } })).json();
check("eligibility", "the Overview coverage card shows the API's counts to Super Admin and Support (counts only)",
  coverage.total > 0 && ["super1", "support"].every((w) => coverageCards[w]?.includes(`${coverage.eligible} of ${coverage.total} creators in the search catalogue qualify`)) && !(coverageCards.support ?? "@").includes("@"),
  `${coverage.eligible}/${coverage.total} | ${(coverageCards.support ?? "").slice(0, 160)}`);
const blocked = await Promise.all(["/admin/v1/staff", "/admin/v1/audit", "/admin/v1/ops/provider-controls"].map(async (path) => (await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${supportToken}` } })).status));
check("roles", "Support is refused staff management, the audit log and provider controls (API 403)", blocked.every((s) => s === 403), blocked.join(","));
// Catalogue review (owner directive 2026-11-03): Support sees the queue but cannot decide a country or a minor flag.
const reviewRead = await fetch(`${API}/admin/v1/catalogue/review?kind=country`, { headers: { authorization: `Bearer ${supportToken}` } });
const reviewDecide = await fetch(`${API}/admin/v1/catalogue/creators/00000000-0000-4000-8000-000000000000/country`, { method: "POST", headers: { authorization: `Bearer ${supportToken}`, "content-type": "application/json" }, body: JSON.stringify({ country: "PK", evidence: "Staff E2E: should be refused" }) });
check("roles", "Support can read the catalogue review queue but not decide a country (API 200 / 403)", reviewRead.status === 200 && reviewDecide.status === 403, `${reviewRead.status}/${reviewDecide.status}`);
// Creator flags: Support reads the queue (the dismissed flag is there) but cannot decide one.
const flagsRead = await fetch(`${API}/admin/v1/catalogue/flags?status=dismissed`, { headers: { authorization: `Bearer ${supportToken}` } });
const dismissed = flagsRead.status === 200 ? (await flagsRead.json()).items : [];
const flagDecide = await fetch(`${API}/admin/v1/catalogue/flags/00000000-0000-4000-8000-000000000000/decision`, { method: "POST", headers: { authorization: `Bearer ${supportToken}`, "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss", note: "not allowed" }) });
check("flags", "Support reads the flag queue (dismissed flag listed with the decision) but cannot decide (API 200 / 403)",
  flagsRead.status === 200 && dismissed.some((f) => f.creatorId === staff.fixtures.creatorId && /a person runs this account/.test(f.resolution ?? "")) && flagDecide.status === 403, `${flagsRead.status}/${flagDecide.status}`);
// Support ticket workflow (owner directive 2026-11-15 §5): open the customer's ticket, read the thread, reply, then
// open → in progress → resolved → closed.
const sAuth = { authorization: `Bearer ${supportToken}`, "content-type": "application/json" };
const ticketList = await (await fetch(`${API}/admin/v1/support/tickets`, { headers: sAuth })).json();
const thread = await (await fetch(`${API}/admin/v1/support/tickets/${staff.fixtures.ticketId}`, { headers: sAuth })).json();
check("support", "Support finds the customer's ticket and reads its thread", ticketList.tickets?.some((t) => t.id === staff.fixtures.ticketId) && thread.messages?.some((m) => m.authorKind === "customer" && /follower count/.test(m.body)));
const steps = [];
for (const body of [{ body: "Thanks, we are checking this creator now.", status: "in_progress" }, { status: "resolved" }, { status: "closed" }]) {
  const r = await fetch(`${API}/admin/v1/support/tickets/${staff.fixtures.ticketId}`, { method: "PATCH", headers: sAuth, body: JSON.stringify(body) });
  steps.push(`${r.status}:${r.status < 300 ? (await r.json()).status : ""}`);
}
const after = await (await fetch(`${API}/admin/v1/support/tickets/${staff.fixtures.ticketId}`, { headers: sAuth })).json();
check("support", "Support replies and moves the ticket open → in progress → resolved → closed", steps.join(",") === "200:in_progress,200:resolved,200:closed" && after.status === "closed" && after.messages?.some((m) => m.authorKind === "staff" && /checking this creator/.test(m.body)), steps.join(","));
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
