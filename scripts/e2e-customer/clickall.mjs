/* global process, console, URL, document, localStorage, location -- Node script; document/localStorage run inside the browser page */
/**
 * Every-button check (owner, 17 Nov: "test every button"). For each customer page it lists every visible, enabled
 * control, then clicks each one on a freshly loaded page and records what happened: a request to the API, a route change,
 * a dialog, menu or toast, a change of the page's text, a download. A control with no visible effect, a page error or
 * a 5xx is reported. Runs after journey.mjs on the disposable E2E database (it may delete things there).
 *   node clickall.mjs <label>   (env as run.sh: E2E_OUT, E2E_SUPABASE_REF)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [label = "clickall"] = process.argv.slice(2);
const here = pathToFileURL(join(process.env.E2E_OUT ?? join(tmpdir(), "mushin-e2e"), "/"));
const ids = JSON.parse(readFileSync(new URL("identities.json", here), "utf8"));
const ref = process.env.E2E_SUPABASE_REF;
const APP = "http://localhost:5173/#/dashboard";
const who = "owner";
const session = { access_token: ids[who].token, token_type: "bearer", expires_in: ids[who].exp - Math.floor(Date.now() / 1000), expires_at: ids[who].exp, refresh_token: "e2e-local",
  user: { id: ids[who].sub, aud: "authenticated", role: "authenticated", email: ids[who].email, user_metadata: { full_name: ids[who].name }, app_metadata: {}, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString() } };

/** How to reach each page from a fresh dashboard. */
const SIDEBAR = { Dashboard: "Dashboard", Search: "Search", Shortlists: "Shortlists", Campaigns: "Campaigns", Inbox: "Inbox", Billing: "Credits & Billing", Settings: "Settings", Support: "Support" };
const PAGES = [
  ...Object.keys(SIDEBAR).map((name) => ({ name, go: async (p) => openSidebar(p, SIDEBAR[name]) })),
  { name: "Campaign detail", go: async (p) => { await openSidebar(p, "Campaigns"); await p.getByText("Eid food push").first().click(); await p.waitForTimeout(1200); } },
  { name: "Shortlist detail", go: async (p) => { await openSidebar(p, "Shortlists"); await p.getByText("Food shortlist").first().click(); await p.waitForTimeout(1200); } },
  ...["Password & sessions", "Support access", "Privacy & data", "Notifications"].map((tab) => ({ name: `Settings › ${tab}`, go: async (p) => { await openSidebar(p, "Settings"); await p.getByRole("button", { name: tab }).first().click(); await p.waitForTimeout(800); } })),
];
/** Controls that would end the session or leave the app; their link or action is checked without following it. */
const SKIP = /^(Sign out|Back to website)$/;

async function openSidebar(p, label) {
  await p.getByRole("navigation", { name: "Main" }).getByRole("button", { name: label, exact: true }).click();
  await p.waitForTimeout(1200);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript(([k, v, a, b]) => { localStorage.setItem(k, v); localStorage.setItem(a, "1"); localStorage.setItem(b, "1"); }, [`sb-${ref}-auth-token`, JSON.stringify(session), `mushin.welcomeDismissed.${ids[who].sub}`, `mushin.onboarded.${ids[who].sub}`]);
  const p = await ctx.newPage();
  const log = { api: [], errors: [], downloads: 0 };
  p.on("request", (r) => { if (r.url().includes(":4000") && !r.url().includes("/health")) log.api.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  p.on("response", (r) => { if (r.url().includes(":4000") && r.status() >= 500) log.errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on("pageerror", (e) => log.errors.push(`page error: ${e.message.slice(0, 160)}`));
  p.on("download", () => { log.downloads += 1; });
  await p.goto(APP);
  await p.getByRole("heading", { name: /Welcome back/ }).first().waitFor({ timeout: 30000 }).catch(() => {});
  return { p, ctx, log };
}

/** Visible, enabled controls in document order, as stable keys "label#n" (n-th control with that label). */
const controlsOf = (p) =>
  p.evaluate(() => {
    const seen = new Map();
    const out = [];
    for (const e of document.querySelectorAll("button, [role=button], [role=switch], [role=tab], [role=checkbox], a[href], select, input[type=file]")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || e.closest("[aria-hidden=true]") || e.disabled || e.getAttribute("aria-disabled") === "true") continue;
      const text = (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.tagName).replace(/\s+/g, " ").trim().slice(0, 60);
      const n = seen.get(text) ?? 0;
      seen.set(text, n + 1);
      out.push({ key: `${text}#${n}`, text, n, tag: e.tagName.toLowerCase(), href: e.getAttribute("href") });
    }
    return out;
  });

const snapshot = (p) => p.evaluate(() => ({ url: location.href, text: document.body.innerText.length + ":" + document.body.innerText.slice(0, 4000), dialogs: document.querySelectorAll("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=status],[role=alert]").length }));

const report = [];
for (const page of PAGES) {
  let first;
  try {
    first = await freshPage();
    await page.go(first.p);
  } catch (e) {
    report.push({ page: page.name, control: "(open page)", verdict: "FAIL", detail: e.message.slice(0, 160) });
    await first?.ctx.close();
    continue;
  }
  const controls = await controlsOf(first.p);
  await first.ctx.close();
  console.log(`${page.name}: ${controls.length} controls`);
  for (const c of controls) {
    if (SKIP.test(c.text)) { report.push({ page: page.name, control: c.text, verdict: "SKIP", detail: "leaves the app; covered by journey.mjs" }); continue; }
    if (c.tag === "a" && c.href && !c.href.startsWith("#") && !c.href.startsWith("/")) { report.push({ page: page.name, control: c.text, verdict: "LINK", detail: c.href }); continue; }
    const { p, ctx, log } = await freshPage();
    try {
      await page.go(p);
      const before = await snapshot(p);
      const apiBefore = log.api.length;
      const handle = (await p.evaluateHandle(({ text, n }) => {
        const all = [...document.querySelectorAll("button, [role=button], [role=switch], [role=tab], [role=checkbox], a[href], select, input[type=file]")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.closest("[aria-hidden=true]") && !e.disabled && e.getAttribute("aria-disabled") !== "true" && (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.tagName).replace(/\s+/g, " ").trim().slice(0, 60) === text;
        });
        return all[n] ?? null;
      }, c)).asElement();
      if (!handle) { report.push({ page: page.name, control: c.text, verdict: "GONE", detail: "not found on a fresh page" }); continue; }
      if (c.tag === "select") {
        const options = await handle.evaluate((s) => [...s.options].map((o) => o.value));
        if (options.length > 1) await handle.selectOption(options[options.length - 1]);
      } else if (c.tag === "input") {
        report.push({ page: page.name, control: c.text, verdict: "FILE", detail: "file input (upload covered by journey.mjs)" });
        continue;
      } else {
        await handle.click({ timeout: 5000 });
      }
      await p.waitForTimeout(1500);
      const after = await snapshot(p);
      const effects = [];
      if (log.api.length > apiBefore) effects.push(`api: ${[...new Set(log.api.slice(apiBefore))].slice(0, 3).join(", ")}`);
      if (after.url !== before.url) effects.push(`route → ${after.url.split("#")[1] ?? after.url}`);
      if (after.dialogs !== before.dialogs) effects.push("dialog/menu/toast");
      if (after.text !== before.text) effects.push("page changed");
      if (log.downloads) effects.push("download");
      const errors = [...new Set(log.errors)];
      report.push({ page: page.name, control: c.text, verdict: errors.length ? "ERROR" : effects.length ? "OK" : "NO EFFECT", detail: errors.length ? errors.join(" | ") : effects.join("; ") });
    } catch (e) {
      report.push({ page: page.name, control: c.text, verdict: "FAIL", detail: e.message.split("\n")[0].slice(0, 160) });
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
const out = new URL(`clickall-${label}.json`, here);
writeFileSync(out, JSON.stringify(report, null, 1));
const bad = report.filter((r) => ["ERROR", "NO EFFECT", "FAIL", "GONE"].includes(r.verdict));
console.log(JSON.stringify({ controls: report.length, ok: report.filter((r) => r.verdict === "OK").length, problems: bad.length }));
for (const r of bad) console.log(`${r.verdict} | ${r.page} | ${r.control} | ${r.detail}`);
console.log(`report: ${decodeURIComponent(out.pathname)}`);
