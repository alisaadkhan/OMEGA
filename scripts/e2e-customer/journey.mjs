/* global process, console, URL, fetch, setTimeout, document, localStorage, window, getComputedStyle -- Node script; document/localStorage run inside the browser page */
// Customer E2E journey through the real local UI → API → worker → PostgreSQL (mushin_e2e) → Meilisearch (e2e_ index).
// Usage: node journey.mjs <run-label> <phase: main|after-restart>. Paid providers and LLMs are blank by environment.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Serious and critical WCAG 2 A/AA findings of axe-core on the current page, as "rule-id (count)". */
async function axeFindings(p) {
  // Entry animations fade content in; measuring mid-fade reports contrast for semi-transparent text.
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: AXE });
  const out = await p.evaluate(async () => {
    const r = await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}): ${[...new Set(v.nodes.map((n) => n.html.replace(/\s+/g, " ").slice(0, 110)))].slice(0, 8).join(" ; ")}`);
  });
  return out;
}
/**
 * The page fits the screen: the document and the main area never scroll sideways, and no visible element ends past the
 * screen edge. Decoration clipped by an overflow-hidden parent and deliberate horizontal scrollers (a table, a tab bar
 * with overflow-x auto) are not counted. Returns the offenders, empty when it fits.
 */
const widthOffenders = (p) =>
  p.evaluate(() => {
    const w = window.innerWidth;
    const out = [];
    if (document.documentElement.scrollWidth > w + 1) out.push(`document ${document.documentElement.scrollWidth}px`);
    const main = document.querySelector("main");
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`main scrolls sideways (${main.scrollWidth} > ${main.clientWidth})`);
    const contained = (e) => {
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "hidden" || ox === "clip") return true;
        if ((ox === "auto" || ox === "scroll") && a.tagName !== "MAIN") return true;
      }
      return false;
    };
    for (const e of document.querySelectorAll("body *")) {
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || b.right <= w + 1 || getComputedStyle(e).visibility === "hidden" || contained(e)) continue;
      out.push(`${e.tagName.toLowerCase()} "${(e.textContent || "").trim().slice(0, 30)}" ends at ${Math.round(b.right)}px`);
      if (out.length >= 4) break;
    }
    return out;
  });

const [label = "run", phase = "main"] = process.argv.slice(2);
// Run output (identities, results, logs, screenshots) lives outside the repository.
const here = pathToFileURL(join(process.env.E2E_OUT ?? join(tmpdir(), "mushin-e2e"), "/"));
const ids = JSON.parse(readFileSync(new URL("identities.json", here), "utf8"));
// Supabase project ref (public: first label of VITE_SUPABASE_URL); the browser keeps the session under sb-<ref>-auth-token.
const ref = process.env.E2E_SUPABASE_REF;
if (!ref) throw new Error("Set E2E_SUPABASE_REF");
const shots = new URL(`shots/${label}/`, here);
mkdirSync(shots, { recursive: true });
const PSQL = join(process.env.PG_BIN ?? "", process.platform === "win32" ? "psql.exe" : "psql");
const sql = (q) => execFileSync(PSQL, ["-h", "localhost", "-p", "54330", "-U", "postgres", "-d", "mushin_e2e", "-Atc", q], { encoding: "utf8" }).trim();
const results = [];
const check = (area, name, ok, detail = "") => {
  results.push({ area, name, ok, detail: String(detail).slice(0, 300) });
  console.log(ok ? "PASS" : "FAIL", "|", area, "|", name, detail ? `| ${String(detail).slice(0, 200)}` : "");
};
const api = async (who, method, path, body, extra = {}) => {
  const r = await fetch(`http://localhost:4000${path}`, { method, headers: { authorization: `Bearer ${ids[who].token}`, ...(body ? { "content-type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const session = (who) => ({ access_token: ids[who].token, token_type: "bearer", expires_in: ids[who].exp - Math.floor(Date.now() / 1000), expires_at: ids[who].exp, refresh_token: "e2e-local",
  user: { id: ids[who].sub, aud: "authenticated", role: "authenticated", email: ids[who].email, user_metadata: { full_name: ids[who].name }, app_metadata: {}, created_at: new Date().toISOString() } });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const consoleErrors = [];
const serverErrors = [];
// Campaign member edits refused as stale (409): each one is a lost customer edit unless someone else really edited.
const campaignConflicts = [];
const staffCallsFromCustomerPages = [];
const openPages = [];
const dbg = (m) => appendFileSync(new URL(`debug-${label}-${phase}.log`, here), `${new Date().toISOString()} ${m}\n`);
process.on("uncaughtException", async (e) => { dbg("FATAL " + e.message); for (const [n, q] of openPages.entries()) { await shot(q, `FAILED-${phase}-${n}`); dbg(`page ${n} ${q.url()} :: ${(await q.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600)}`); } process.exit(1); });
async function pageAs(who, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  if (who) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(session(who))]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => consoleErrors.push(`${who}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 4\d\d|AuthApiError|Invalid Refresh Token|supabase\.co/.test(m.text())) consoleErrors.push(`${who}: ${m.text()}`); });
  p.on("response", (r) => { if (r.status() >= 500 && r.url().includes(":4000")) serverErrors.push(`${r.status()} ${r.url()}`); });
  p.on("response", (r) => { if (r.status() === 409 && r.request().method() === "PATCH" && /\/v1\/campaigns\/[^/]+\/creators\//.test(r.url())) campaignConflicts.push(r.url()); });
  p.on("request", (r) => { if (r.url().includes("/admin/v1/")) staffCallsFromCustomerPages.push(r.url()); });
  openPages.push(p);
  p.on("close", () => openPages.splice(openPages.indexOf(p), 1));
  p.on("console", (m) => dbg(`[${who}] console.${m.type()} ${m.text().slice(0, 200)}`));
  p.on("requestfailed", (r) => dbg(`[${who}] requestfailed ${r.url()} ${r.failure()?.errorText}`));
  p.on("response", (r) => { if (!/\.(tsx?|css|js|svg|png|woff2?)(\?|$)|@vite|node_modules/.test(r.url())) dbg(`[${who}] ${r.status()} ${r.request().method()} ${r.url()}`); });
  return p;
}
const shot = (p, n) => p.screenshot({ path: decodeURIComponent(new URL(`${n}.png`, shots).pathname).replace(/^\/([A-Z]:)/, "$1") }).catch(() => {});
const mainText = async (p) => (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
const nav = async (p, name) => {
  // Small screens keep the navigation in a drawer behind the top bar's menu button.
  const drawer = p.getByRole("button", { name: "Open navigation" });
  if (await drawer.isVisible().catch(() => false)) await drawer.click();
  await p.getByRole("button", { name, exact: true }).first().click();
  await p.getByRole("heading", { name, exact: true }).first().waitFor({ timeout: 15000 });
};
const menu = async (p, item) => {
  await p.getByRole("button", { name: "Account menu" }).click();
  await p.getByRole("menuitem", { name: item }).click();
  await p.getByRole("heading", { name: item === "Support" ? "Support" : item, exact: true }).first().waitFor({ timeout: 15000 });
};
async function search(p, text) {
  if (!(await p.getByPlaceholder(/Find Pakistani creators/).isVisible().catch(() => false))) await nav(p, "Search");
  await p.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Search Existing Creators/.test(x.textContent ?? "")); return !!b && !b.disabled; }, null, { timeout: 15000 });
  const input = p.getByPlaceholder(/Find Pakistani creators/);
  await input.fill(text);
  await input.press("Enter");
  await p.waitForTimeout(300);
  await p.waitForFunction(() => !/Searching existing creator profiles/.test(document.body.innerText), null, { timeout: 30000 });
  return mainText(p);
}
const SEARCH_PRICE = 50;
const apiSearch = (who, text, filters = {}, cursor) => api(who, "POST", "/v1/search", { text, filters, confirmedCost: SEARCH_PRICE, ...(cursor ? { cursor } : {}) });
const searchSpends = (ws) => Number(sql(`select count(*) from wp.credit_ledger where workspace_id = '${ws}' and action = 'search_existing' and kind = 'spend'`));
const handles = (t) => [...new Set(t.match(/@[a-z0-9._]+/gi) ?? [])];
async function openProfile(p, handle) {
  await search(p, handle);
  await p.getByText(`@${handle}`).first().click();
  const panel = p.getByRole("dialog", { name: "Creator profile" });
  await panel.waitFor();
  return panel;
}
const closeAll = async (p) => { for (let i = 0; i < 2; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(250); } };

if (phase === "main") {
  // ── Setup through the API: first sign-in provisions each workspace; teammates are added by fixture ──
  for (const who of ["owner", "outsider"]) await api(who, "GET", "/v1/me");
  const ws = sql(`select workspace_id from wp.workspace_members where user_id = '${ids.owner.sub}'`);
  // Invitations are not implemented, so admin and member join the owner's workspace through a database fixture.
  sql(`insert into wp.users (id, email, display_name) values ('${ids.admin.sub}', '${ids.admin.email}', '${ids.admin.name}'), ('${ids.member.sub}', '${ids.member.email}', '${ids.member.name}');
       insert into wp.workspace_members (workspace_id, user_id, role) values ('${ws}', '${ids.admin.sub}', 'admin'), ('${ws}', '${ids.member.sub}', 'member');`);
  writeFileSync(new URL(`state-${label}.json`, here), JSON.stringify({ ws }));
  check("setup", "admin and member resolve into the owner's workspace", (await api("admin", "GET", "/v1/me")).json?.workspace.id === ws && (await api("member", "GET", "/v1/me")).json?.workspace.role === "member");

  // ── 1. Auth: protected route, session restore, direct URL, expired session ──
  let p = await pageAs(null);
  await p.goto("http://localhost:5173/#/dashboard");
  await p.waitForTimeout(2500);
  check("auth", "signed-out user is sent from the dashboard to login", /#\/login/.test(p.url()), p.url());
  await p.context().close();
  const exp = await pageAs("expired");
  await exp.goto("http://localhost:5173/#/dashboard");
  await exp.waitForTimeout(4000);
  check("auth", "expired session is refused by the API", (await api("expired", "GET", "/v1/me")).status === 401);
  check("auth", "expired session ends on the login page", /#\/login/.test(exp.url()), exp.url());
  await exp.context().close();

  p = await pageAs("owner");
  await p.goto("http://localhost:5173/#/dashboard");
  await p.getByRole("heading", { name: /Welcome back, Olivia/ }).waitFor({ timeout: 30000 });
  await p.getByRole("region", { name: "Lists" }).getByText("No lists yet").waitFor({ timeout: 20000 });
  await p.waitForTimeout(1500);
  await shot(p, "01-dashboard");
  let t = await mainText(p);
  check("dashboard", "first visit: real trial balance and honest empty cards", (await api("owner", "GET", "/v1/billing/summary")).json.balance.available === 200 && /No lists yet/.test(t) && /No campaigns yet/.test(t) && !/\bSample\b|Illustrative/.test(t));
  // F-7/F-8: badges follow the server (meter and status), never fixed text; a trial is never shown as "Inactive".
  const billSum = (await api("owner", "GET", "/v1/billing/summary")).json;
  const creditBadgeText = (await p.getByTestId("credit-badge").innerText().catch(() => "")).trim();
  const subBadgeText = (await p.getByTestId("subscription-badge").innerText().catch(() => "")).trim();
  const meterLabel = { normal: "Healthy", amber: "Running low", red: "Very low" }[billSum.balance.meter];
  check("dashboard", "credit and subscription badges match the server's meter and status", creditBadgeText === meterLabel && billSum.status === "trialing" && subBadgeText === "Trial" && !/Inactive/.test(t), `credit "${creditBadgeText}" (meter ${billSum.balance.meter}); subscription "${subBadgeText}" (${billSum.status})`);
  check("dashboard", "page title and description name MUSHIN, not template text", /MUSHIN/.test(await p.title()) && !/High-End SaaS/.test(await p.title()), await p.title());
  await p.reload();
  await p.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 30000 });
  check("auth", "reload on a direct dashboard URL restores the session", p.url().includes("#/dashboard"));
  // Test fixture: 1,000 labelled pilot credits (a lot plus its ledger grant, as the billing engine writes them).
  sql(`with lot as (insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values ('${ws}', 'adjustment', 1000, 1000, now() + interval '30 days') returning id)
       insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, source_ref, note) select '${ws}', 1000, 'grant', id, 'e2e-pilot-${label}', 'E2E pilot credits (test fixture)' from lot`);

  // ── 2. Settings ──
  await menu(p, "Settings");
  await p.getByLabel("Your name").fill("Olivia Owner QA");
  await p.getByRole("button", { name: "Save profile" }).click();
  await p.waitForTimeout(1000);
  check("settings", "profile name persists in the database", sql(`select display_name from wp.users where id = '${ids.owner.sub}'`) === "Olivia Owner QA");
  await p.getByRole("button", { name: "Workspace & team" }).click();
  await p.getByLabel("Workspace name").fill(`E2E Brand ${label}`);
  await p.getByRole("button", { name: "Save name" }).click();
  await p.waitForTimeout(1000);
  check("settings", "workspace rename persists", sql(`select name from wp.workspaces where id = '${ws}'`) === `E2E Brand ${label}`);
  const team = await p.getByRole("region", { name: "Team" }).innerText();
  check("settings", "team lists owner, admin and member with roles", /Olivia Owner QA[\s\S]*owner/i.test(team) && team.includes("Adam Admin") && team.includes("Mona Member"));
  await shot(p, "02-settings");

  // ── 3. Brain 1 catalog search (Meilisearch backend, LLM unavailable) ──
  await nav(p, "Search");
  await p.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Search Existing Creators/.test(x.textContent ?? "")); return !!b && !b.disabled; }, null, { timeout: 15000 });
  const spendsBefore = searchSpends(ws);
  // Opening the page searches nothing (it would be a paid search the user did not ask for).
  const nothingOnOpen = searchSpends(ws) === spendsBefore && !/creators? match/.test(await mainText(p));
  const priceShown = (await p.getByRole("button", { name: /Search Existing Creators/ }).first().innerText()).includes("50 cr");
  t = await search(p, "food");
  const spentOnce = searchSpends(ws) === spendsBefore + 1;
  const apiFood = (await apiSearch("owner", "food")).json;
  check("search", "text search shows exactly the API's creators", apiFood.total > 0 && apiFood.results.every((r) => handles(t).includes(`@${r.handle}`)), `API ${apiFood.total}, UI ${handles(t).length}`);
  check("search", "AI reading unavailable does not block search (INT-002)", apiFood.total > 0);
  // CAT-005: every result explains where "food" matched, and the card shows that explanation.
  const explained = apiFood.results.filter((r) => r.matchedOn.some((m) => m.term === "food"));
  // mainText collapses whitespace, so count the label itself (one per explained card).
  const matchedLines = (t.match(/Matched: /g) ?? []).length;
  check("search", "each result says where the query matched (API matchedOn shown on the card)", apiFood.results.length > 0 && explained.length === apiFood.results.length && matchedLines >= Math.min(explained.length, 10), `explained ${explained.length}/${apiFood.results.length}; card lines ${matchedLines}`);
  const LABELS = { email_unverified: "Email available · Unverified", email_verified: "Email available · Verified", email_invalid: "Email invalid", phone_unverified: "Phone available · Unverified", none: "No contact info" };
  check("search", "every card states contact availability from the API, never a value or an unproven claim", apiFood.results.every((r) => r.contactAvailability in LABELS && t.includes(LABELS[r.contactAvailability])) && !/Contact on file|Contactable/.test(t) && !/[a-z0-9._%+-]+@[a-z0-9-]+[.][a-z]{2,}/i.test(t), [...new Set(apiFood.results.map((r) => r.contactAvailability))].join(", "));
  // Creator eligibility (elig-1): every result meets the 10,000 minimum; a food creator below it is absent, cannot be saved
  // through the API, and its profile says why. Vicky Panda (5,990 YouTube subscribers) matches "food" but is below.
  const smallId = sql("select c.id from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id where p.handle = 'vicky.pandafood'");
  check("eligibility", "every search result meets the 10,000-follower minimum; a matching creator below it is absent", apiFood.results.length > 0 && apiFood.results.every((r) => r.eligibility.eligible && r.eligibility.qualifyingPlatforms.length > 0) && !apiFood.results.some((r) => r.handle === "vicky.pandafood") && !handles(t).includes("@vicky.pandafood"), `results ${apiFood.results.length}`);
  const anyList = (await api("owner", "POST", "/v1/lists", { name: `Elig ${label}`, description: "" })).json;
  const refused = await api("owner", "POST", `/v1/lists/${anyList.id}/members`, { creatorIds: [smallId] });
  check("eligibility", "the API refuses to save a creator below the minimum (direct call)", refused.status === 400 && refused.json?.error?.details?.reason === "creator_ineligible", `${refused.status} ${JSON.stringify(refused.json?.error?.details ?? {})}`);
  const smallProfile = (await api("owner", "GET", `/v1/creators/${smallId}`)).json;
  check("eligibility", "the profile states the creator is below the minimum, with the reason", smallProfile.eligibility?.eligible === false && smallProfile.eligibility.reasons.includes("below_follower_minimum"), JSON.stringify(smallProfile.eligibility?.reasons));
  await api("owner", "DELETE", `/v1/lists/${anyList.id}`);
  // The next page (by cursor) when there is one, otherwise the same search again: neither is a new paid search.
  const page2 = (await apiSearch("owner", "food", {}, apiFood.nextCursor)).json;
  check("pricing", "search button shows the server price; a search is charged once; repeat and next page are free", priceShown && nothingOnOpen && spentOnce && apiFood.charged === false && page2.charged === false && searchSpends(ws) === spendsBefore + 1, `spends ${spendsBefore}→${searchSpends(ws)}; api charged ${apiFood.charged}/${page2.charged}`);
  const lahore = (await apiSearch("owner", "Lahore")).json;
  check("search", "different queries give different, query-related results", lahore.results.map((r) => r.id).join() !== apiFood.results.map((r) => r.id).join());
  check("search", "partial handle finds the creator", handles(await search(p, "realwowbo")).includes("@realwowboy"));
  await p.getByRole("button", { name: "youtube", exact: true }).first().click();
  const yt = (await apiSearch("owner", "food", { platform: "youtube" })).json;
  t = await search(p, "food");
  check("search", "platform filter applied (API and UI)", yt.results.every((r) => r.platform === "youtube") && handles(t).every((h) => yt.results.some((r) => `@${r.handle}` === h)));
  await p.getByRole("button", { name: "All platforms", exact: true }).first().click().catch(() => {});
  t = await search(p, "zzqx nothing matches this");
  check("search", "empty result is explained and offers live discovery", /No creators match/.test(t) && /Find new creators/i.test(t));
  check("search", "malformed input is rejected by the API", (await apiSearch("owner", "x".repeat(400))).status === 400);
  const panel = await openProfile(p, "realwowboy");
  const rw = (await apiSearch("owner", "realwowboy")).json.results[0];
  const prof = (await api("owner", "GET", `/v1/creators/${rw.id}`)).json;
  check("profile", "profile shows the stored creator, no contact values", (await panel.innerText()).includes(prof.displayName) && prof.contacts.every((c) => c.value === null));
  check("profile", "profile states contact availability and each contact source and check state", (await panel.innerText()).includes(LABELS[prof.contactAvailability]) && prof.contacts.every((c) => c.source && c.firstSeenAt && c.status), prof.contactAvailability);
  await shot(p, "03-profile");

  // ── 4. Lists ──
  await panel.getByRole("button", { name: /^Save/ }).click();
  const saveMenu = p.getByRole("dialog", { name: "Save to lists" });
  await saveMenu.getByLabel("New list name").fill("Food shortlist");
  await saveMenu.getByRole("button", { name: "Add" }).click();
  await p.waitForTimeout(1500);
  await closeAll(p);
  const fb = await openProfile(p, "foodiesbyashirr");
  await fb.getByRole("button", { name: /^Save/ }).click();
  await p.getByRole("dialog", { name: "Save to lists" }).getByRole("menuitemcheckbox", { name: /Food shortlist/ }).click();
  await p.waitForTimeout(1500);
  await closeAll(p);
  let list = (await api("owner", "GET", "/v1/lists")).json.lists.find((l) => l.name === "Food shortlist");
  check("lists", "two creators saved from profiles", list?.count === 2);
  await nav(p, "Lists");
  await p.getByRole("button", { name: /Food shortlist/ }).first().click();
  await p.getByText("@realwowboy").first().waitFor();
  await p.getByRole("button", { name: "Add note" }).first().click();
  await p.getByLabel(/Note for/).fill("Shortlisted for Eid");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(1200);
  check("lists", "note persists", sql(`select count(*) from wp.list_members where note = 'Shortlisted for Eid'`) === "1");
  await p.getByRole("button", { name: "Mark as favourite" }).first().click();
  await p.waitForTimeout(1000);
  check("lists", "favourite persists", sql(`select favorite from wp.lists where name = 'Food shortlist'`) === "t");
  check("lists", "duplicate name refused by the API", (await api("owner", "POST", "/v1/lists", { name: "food shortlist" })).status === 409);

  // ── 5. Campaigns + outreach ──
  await nav(p, "Campaigns");
  await p.getByRole("button", { name: "New campaign" }).first().click();
  await p.getByLabel("Campaign name").fill("Eid food push");
  await p.getByLabel("Budget (PKR)").fill("300000");
  await p.getByLabel("Start date").fill("2026-11-01");
  await p.getByLabel("End date").fill("2026-11-30");
  await p.getByRole("button", { name: "Create campaign" }).click();
  await p.getByRole("heading", { name: "Eid food push" }).waitFor();
  const k = (await api("owner", "GET", "/v1/campaigns")).json.campaigns.find((c) => c.name === "Eid food push");
  // Add both list members from the list page bulk bar.
  await nav(p, "Lists");
  await p.getByRole("button", { name: /Food shortlist/ }).first().click();
  await p.getByLabel("Select all").check();
  await p.getByRole("button", { name: /Add 2 to a campaign/ }).click();
  // Wait for the add itself, not a fixed delay: under load it took over 4 s (run fix3-1, harness defect T-3).
  const added = p.waitForResponse((r) => r.request().method() === "POST" && /\/v1\/campaigns\/[^/]+\/creators$/.test(r.url()), { timeout: 30000 });
  await p.getByRole("dialog", { name: "Add to campaign" }).getByRole("button", { name: /Eid food push/ }).click();
  await added;
  check("campaigns", "creators added from a list selection", (await api("owner", "GET", `/v1/campaigns/${k.id}`)).json.creatorCount === 2);
  await nav(p, "Campaigns");
  await p.getByRole("button", { name: /Eid food push/ }).first().click();
  await p.getByRole("heading", { name: "Eid food push" }).waitFor();
  const card = (n) => p.locator("article", { hasText: n });
  await card("Realwowboy").getByLabel("Stage").selectOption("negotiating");
  await p.waitForTimeout(1000);
  await card("Realwowboy").getByTitle("Edit fee").click();
  await card("Realwowboy").getByLabel("Fee in rupees").fill("40000");
  await card("Realwowboy").getByLabel("Fee in rupees").press("Enter");
  await p.waitForTimeout(1000);
  await card("Realwowboy").getByLabel("Stage").selectOption("confirmed");
  await p.waitForTimeout(1000);
  await card("Foodies by Ashir").getByRole("button", { name: "Mark declined" }).click();
  await p.waitForTimeout(1200);
  let kd = (await api("owner", "GET", `/v1/campaigns/${k.id}`)).json;
  check("campaigns", "stage, fee (agreed) and declined outcome persist; totals exclude declined", kd.stageCounts.confirmed === 1 && kd.declinedCount === 1 && kd.agreedFeesMinor === 4_000_000);
  check("campaigns", "one person editing a campaign never gets a stale-version conflict (fee saved once)", campaignConflicts.length === 0, campaignConflicts.slice(0, 2).join(" | "));
  await card("Realwowboy").getByRole("button", { name: "Outreach" }).click();
  const op = p.getByRole("dialog", { name: /Outreach for/ });
  await op.getByLabel("Channel").selectOption("email");
  await op.getByLabel("What happened").selectOption("agreed");
  await op.getByRole("button", { name: "Log outreach" }).click();
  await p.waitForTimeout(1500);
  await shot(p, "04b-outreach");
  await op.getByRole("listitem").first().waitFor();
  check("campaigns", "outreach logged with author", sql(`select count(*) from wp.outreach_events where outcome = 'agreed' and logged_by = '${ids.owner.sub}'`) === "1");
  await closeAll(p);
  await shot(p, "04-campaign");

  // ── 6. Brain 2 live discovery with paid providers blank ──
  // An unaffordable size is checked on the outsider's own 200-credit trial; the owner's snapshot follows the paid search.
  const outsiderPage = await pageAs("outsider");
  await outsiderPage.goto("http://localhost:5173/#/dashboard");
  await outsiderPage.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 30000 });
  await search(outsiderPage, "Lahore food vlogger"); // 200 trial credits - 50 = 150 left
  await outsiderPage.getByRole("button", { name: /Find New Creators/ }).first().click();
  await outsiderPage.getByRole("button", { name: "Up to 15", exact: true }).click();
  await outsiderPage.waitForFunction(() => { const d = document.querySelector("div.max-w-md"); return !!d && /\d+ credits/.test(d.textContent ?? "") && !/Preparing/.test(d.textContent ?? ""); }, null, { timeout: 30000 });
  const outsiderQuote = (await outsiderPage.locator("div.max-w-md").innerText()).replace(/\s+/g, " ");
  check("discovery", "size above the balance cannot be confirmed (insufficient credits)", /200 credits/.test(outsiderQuote) && (await outsiderPage.getByRole("button", { name: /Confirm · at most/ }).isDisabled()), outsiderQuote.slice(0, 160));
  await outsiderPage.context().close();
  await search(p, "Lahore food vlogger");
  const before = (await api("owner", "GET", "/v1/billing/summary")).json.balance;
  await p.getByRole("button", { name: /Find New Creators/ }).first().click();
  await p.getByRole("button", { name: "Up to 5", exact: true }).click();
  await p.waitForFunction(() => { const d = document.querySelector("div.max-w-md"); return !!d && /\d+ credits/.test(d.textContent ?? "") && !/Preparing/.test(d.textContent ?? ""); }, null, { timeout: 30000 });
  const quote = (await p.locator("div.max-w-md").innerText()).replace(/\s+/g, " ");
  const jobsBefore = sql(`select count(*) from wp.discovery_jobs`);
  check("discovery", "quote names platforms and price before anything is reserved", /Platforms searched/.test(quote) && /\d+ credits/.test(quote) && jobsBefore === "0", `jobs ${jobsBefore}; ${quote.slice(0, 200)}`);
  await p.getByRole("button", { name: /Confirm · at most/ }).click();
  let final = "";
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(2000);
    final = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    if (sql(`select count(*) from wp.discovery_jobs where status in ('completed','failed')`) === "1" && /returned/i.test(final)) break;
  }
  const after = (await api("owner", "GET", "/v1/billing/summary")).json.balance;
  const job = sql(`select status || '|' || coalesce(outcome,'') || '|' || credits_charged from wp.discovery_jobs`);
  check("discovery", "provider unavailable: job fails honestly and every credit returns", /^failed\|failed\|0$/.test(job) && after.available === before.available && after.reserved === 0 && /returned/i.test(final), `${job}; ${before.available}→${after.available}`);
  check("discovery", "ledger: reserve and release net to zero", sql(`select coalesce(sum(case when kind='reserve' then amount when kind='release' then -amount else 0 end),0) from wp.credit_ledger where workspace_id = '${ws}' and action = 'find_new'`) === "0");
  const est = (await api("owner", "POST", "/v1/discovery/estimates", { search: { text: "bridal makeup", filters: { platform: "youtube", creatorCity: "Lahore" } }, maxNew: 5 }, { "idempotency-key": `e2e-est-${label}` })).json;
  const s1 = await api("owner", "POST", "/v1/discovery/jobs", { kind: "live", estimateId: est.estimateId }, { "idempotency-key": `e2e-a-${label}` });
  const s2 = await api("owner", "POST", "/v1/discovery/jobs", { kind: "live", estimateId: est.estimateId }, { "idempotency-key": `e2e-b-${label}` });
  if (!s1.json?.job) console.log("DEBUG est", JSON.stringify(est).slice(0, 300), JSON.stringify(s1.json).slice(0, 300));
  check("discovery", "confirming the same quote twice starts one job and one reservation", s1.json?.job?.id && s1.json.job.id === s2.json?.job?.id, `${s1.status}/${s2.status}`);
  check("discovery", "an estimate cannot be tampered with (unknown id refused)", (await api("owner", "POST", "/v1/discovery/jobs", { kind: "live", estimateId: "00000000-0000-4000-8000-000000000000" }, { "idempotency-key": `e2e-c-${label}` })).status >= 400);
  for (let i = 0; i < 20 && sql(`select count(*) from wp.discovery_jobs where status in ('queued','running')`) !== "0"; i++) await new Promise((r) => setTimeout(r, 1500));
  check("discovery", "second run also refunded; nothing left reserved", (await api("owner", "GET", "/v1/billing/summary")).json.balance.reserved === 0);

  // ── 7. Billing with the mock payment provider (development mode) ──
  await nav(p, "Credits & billing");
  await p.getByRole("button", { name: "Choose a plan" }).last().click();
  const planName = (await api("owner", "GET", "/v1/billing/plans")).json.plans[0].name;
  await p.getByRole("button", { name: `Choose ${planName}` }).click();
  await p.waitForURL(/mock-paddle\/checkout/, { timeout: 20000 });
  await p.getByRole("button", { name: /^Pay / }).click();
  await p.waitForURL(/checkout=success|#\/billing|#\/dashboard/, { timeout: 30000 });
  let sub = null;
  for (let i = 0; i < 20; i++) { sub = (await api("owner", "GET", "/v1/billing/summary")).json; if (sub.status === "active") break; await new Promise((r) => setTimeout(r, 1000)); }
  check("billing", "mock checkout activates the plan and grants its credits (provider mocked)", sub.status === "active" && sub.plan?.name === planName && sub.balance.available > 200, `${sub.status} ${sub.plan?.name} ${sub.balance.available}`);
  check("billing", "balance equals the ledger", Number(sql(`select coalesce(sum(remaining),0) from wp.credit_lots where workspace_id = '${ws}' and (expires_at is null or expires_at > now())`)) === sub.balance.available + sub.balance.reserved, `lots vs ${sub.balance.available}`);
  await shot(p, "05-billing");

  // ── 8. Dashboard, analytics, activity agree with the records ──
  // Inner sections have no URLs of their own: return to the dashboard through the sidebar.
  await p.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await p.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 30000 });
  await p.getByRole("region", { name: "Lists" }).getByText("Food shortlist").waitFor({ timeout: 15000 });
  t = await mainText(p);
  // The API counts days in Pakistan time (Asia/Karachi), so the range is computed there too.
  const pkDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(ms));
  const today = pkDate(Date.now());
  const from = pkDate(Date.now() - 29 * 86_400_000);
  const sum = (await api("owner", "GET", `/v1/analytics/summary?from=${from}&to=${today}`)).json;
  check("dashboard", "dashboard cards equal API and database", t.includes("Food shortlist") && t.includes("Eid food push") && sum.outreach.total === 1 && sum.pipeline.byStage.confirmed === 1 && sum.lists.savedCreators === 2, `text has list ${t.includes("Food shortlist")} campaign ${t.includes("Eid food push")}; api outreach ${sum.outreach.total} confirmed ${sum.pipeline.byStage.confirmed} saved ${sum.lists.savedCreators}; range ${from}..${today}`);
  const feed = (await api("owner", "GET", "/v1/activity?limit=50")).json.events.map((e) => e.text).join(" | ");
  check("activity", "activity shows real actions only (feed and dashboard card)", /logged that Realwowboy agreed/.test(feed) && /created the campaign Eid food push/.test(feed) && /Find New Creators run/.test(t) && !/SSO group sync|auto top-up/.test(t));

  // ── 9. Support ──
  await menu(p, "Support");
  await p.getByRole("button", { name: "New request" }).click();
  await p.getByLabel("Subject").fill("Find New Creators failed");
  await p.getByLabel("What happened?").fill("The run said provider unavailable.");
  await p.getByRole("button", { name: "Send request" }).click();
  await p.getByRole("region", { name: "Find New Creators failed" }).waitFor();
  check("support", "request stored for the workspace", sql(`select count(*) from wp.support_tickets where workspace_id = '${ws}'`) === "1");

  // ── 10. Roles (UI where it matters; every restriction also checked directly against the API) ──
  const adm = await pageAs("admin");
  await adm.goto("http://localhost:5173/#/dashboard");
  await adm.getByRole("heading", { name: /Welcome back, Adam/ }).waitFor({ timeout: 30000 });
  await menu(adm, "Settings");
  await adm.getByRole("button", { name: "Workspace & team" }).click();
  check("roles", "admin can rename the workspace (UI enabled, API 200)", !(await adm.getByLabel("Workspace name").isDisabled()) && (await api("admin", "PATCH", "/v1/workspace", { name: `E2E Brand ${label}` })).status === 200);
  check("roles", "admin sees the shared lists and campaigns", (await api("admin", "GET", "/v1/lists")).json.lists.some((l) => l.name === "Food shortlist") && (await api("admin", "GET", "/v1/campaigns")).json.campaigns.length === 1);
  check("roles", "admin may view the ledger (documented owner/admin)", (await api("admin", "GET", "/v1/billing/ledger?limit=5")).status === 200);
  await adm.context().close();

  const mem = await pageAs("member");
  await mem.goto("http://localhost:5173/#/dashboard");
  await mem.getByRole("heading", { name: /Welcome back, Mona/ }).waitFor({ timeout: 30000 });
  await menu(mem, "Settings");
  await mem.getByRole("button", { name: "Workspace & team" }).click();
  check("roles", "member cannot rename: UI disabled and API 403", (await mem.getByLabel("Workspace name").isDisabled()) && (await api("member", "PATCH", "/v1/workspace", { name: "Hijack" })).status === 403);
  check("roles", "member cannot read the ledger or buy (API 403)", (await api("member", "GET", "/v1/billing/ledger?limit=5")).status === 403 && (await api("member", "POST", "/v1/billing/checkout", { kind: "topup", packId: "x" }, { "idempotency-key": `e2e-m-${label}` })).status === 403);
  await mem.goto("http://localhost:5173/#/dashboard");
  await nav(mem, "Credits & billing");
  check("roles", "member's billing page offers no purchase controls", (await mem.getByRole("button", { name: /Choose a plan|Change plan|Buy/ }).count()) === 0);
  check("roles", "member can work with lists (create via API)", (await api("member", "POST", "/v1/lists", { name: "Member picks" })).status === 201);
  await mem.context().close();

  const listId = (await api("owner", "GET", "/v1/lists")).json.lists.find((l) => l.name === "Food shortlist").id;
  const ticketId = sql(`select id from wp.support_tickets where workspace_id = '${ws}'`);
  const outsiderBlocked = [
    (await api("outsider", "GET", `/v1/lists/${listId}`)).status,
    (await api("outsider", "PATCH", `/v1/lists/${listId}`, { name: "x" })).status,
    (await api("outsider", "GET", `/v1/campaigns/${k.id}`)).status,
    (await api("outsider", "POST", `/v1/campaigns/${k.id}/creators`, { creatorIds: [rw.id] })).status,
    (await api("outsider", "GET", `/v1/support/tickets/${ticketId}`)).status,
  ];
  check("isolation", "another workspace gets 404 on every private record (no data leak)", outsiderBlocked.every((s) => s === 404), outsiderBlocked.join(","));
  check("isolation", "another workspace's activity, lists and analytics are empty", (await api("outsider", "GET", "/v1/activity")).json.events.length === 0 && (await api("outsider", "GET", "/v1/lists")).json.lists.length === 0);
  check("isolation", "the catalog itself stays globally searchable", (await apiSearch("outsider", "food")).json.total === apiFood.total);

  // ── 11. Sign out ──
  await p.getByRole("button", { name: "Account menu" }).click();
  await p.getByRole("menuitem", { name: /Sign out|Log out/ }).click().catch(() => {});
  await p.waitForTimeout(2500);
  await p.goto("http://localhost:5173/#/dashboard");
  await p.waitForTimeout(2500);
  check("auth", "after sign-out the dashboard is not reachable", /#\/(login|landing)?$|#\/login/.test(p.url()) || !(await p.getByRole("heading", { name: /Welcome back/ }).isVisible().catch(() => false)), p.url());
  await p.context().close();
} else {
  // ── After restarting the API and worker: everything persisted and search still answers ──
  const p = await pageAs("owner");
  await p.goto("http://localhost:5173/#/dashboard");
  await p.getByRole("heading", { name: /Welcome back, Olivia/ }).waitFor({ timeout: 30000 });
  await nav(p, "Lists");
  await p.getByRole("button", { name: /Food shortlist/ }).first().click();
  await p.getByText("Shortlisted for Eid").waitFor({ timeout: 15000 });
  check("restart", "list, members and note persist after API/worker restart", true);
  await nav(p, "Campaigns");
  await p.getByRole("button", { name: /Eid food push/ }).first().click();
  await p.getByRole("heading", { name: "Eid food push" }).waitFor();
  check("restart", "campaign pipeline persists", /Rs 40,000 agreed/.test(await mainText(p)));
  check("restart", "catalog search answers after restart (index reconciled)", (await apiSearch("owner", "food")).json.total > 0 && sql(`select count(*) from wp.credit_reservations where status = 'held'`) === "0");
  // Accessibility (axe-core, WCAG 2.1 A/AA, serious and critical) on the main customer pages at desktop width.
  for (const name of ["Search", "Lists", "Campaigns"]) {
    await nav(p, name);
    await p.waitForTimeout(400);
    const found = await axeFindings(p);
    check("a11y", `${name}: no serious or critical WCAG 2.1 A/AA issues (desktop)`, found.length === 0, found.join(" | "));
  }
  await p.context().close();

  // ── Phone width (390 × 844): pages fit without sideways scrolling, navigation works, and axe passes ──
  const phone = { width: 390, height: 844 };
  const pub = await pageAs(null, phone);
  for (const route of ["#/", "#/login"]) {
    await pub.goto(`http://localhost:5173/${route}`);
    await pub.waitForTimeout(1500);
    const off = await widthOffenders(pub);
    check("phone", `${route} fits a 390 px screen`, off.length === 0, off.join(" | "));
    const found = await axeFindings(pub);
    check("a11y", `${route}: no serious or critical WCAG 2.1 A/AA issues (phone)`, found.length === 0, found.join(" | "));
  }
  await pub.context().close();
  const m = await pageAs("owner", phone);
  await m.goto("http://localhost:5173/#/dashboard");
  await m.getByRole("heading", { name: /Welcome back, Olivia/ }).waitFor({ timeout: 30000 });
  check("phone", "dashboard fits a 390 px screen", (await widthOffenders(m)).length === 0, (await widthOffenders(m)).join(" | "));
  for (const name of ["Search", "Lists", "Campaigns", "Billing"]) {
    let reached = true;
    try {
      await nav(m, name === "Billing" ? "Credits & billing" : name);
    } catch (err) {
      reached = false;
      await shot(m, `phone-${name}`);
      check("phone", `${name} can be reached on a 390 px screen`, false, err instanceof Error ? err.message.split("\n")[0] : "");
    }
    if (!reached) continue;
    await m.waitForTimeout(400);
    if (name === "Search") await search(m, "food");
    await shot(m, `phone-${name}`);
    check("phone", `${name} fits a 390 px screen`, (await widthOffenders(m)).length === 0, (await widthOffenders(m)).join(" | "));
    const found = await axeFindings(m);
    check("a11y", `${name}: no serious or critical WCAG 2.1 A/AA issues (phone)`, found.length === 0, found.join(" | "));
  }
  await m.context().close();
}

check("health", "no console errors in the browser", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("health", "customer pages send no staff (admin) requests", staffCallsFromCustomerPages.length === 0, staffCallsFromCustomerPages.slice(0, 2).join(" | "));
check("health", "no 5xx responses from the API", serverErrors.length === 0, serverErrors.slice(0, 3).join(" | "));
await browser.close();
const passed = results.filter((r) => r.ok).length;
appendFileSync(new URL("results.jsonl", here), `${JSON.stringify({ label, phase, at: new Date().toISOString(), passed, failed: results.length - passed, results })}\n`);
console.log(JSON.stringify({ label, phase, passed, failed: results.length - passed }));
