/* global process, console, URL, fetch, localStorage, setTimeout */
// "Try to break it" journey (owner instruction 2026-10-26): runs after journey.mjs on the same isolated database
// (mushin_e2e), through the real UI → API → worker → PostgreSQL, with every paid provider blank. Each check has a test
// id that matches docs/completion/TEST_REGISTER.md. Usage: node breakit.mjs <run-label>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const [label = "breakit"] = process.argv.slice(2);
const here = pathToFileURL(join(process.env.E2E_OUT ?? join(tmpdir(), "mushin-e2e"), "/"));
const ids = JSON.parse(readFileSync(new URL("identities.json", here), "utf8"));
const ref = process.env.E2E_SUPABASE_REF ?? "localhost";
const shots = new URL(`shots/${label}/`, here);
mkdirSync(shots, { recursive: true });
const PSQL = join(process.env.PG_BIN ?? "", process.platform === "win32" ? "psql.exe" : "psql");
const sql = (q) => execFileSync(PSQL, ["-h", "localhost", "-p", "54330", "-U", "postgres", "-d", "mushin_e2e", "-Atc", q], { encoding: "utf8" }).trim();
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push({ id, name, ok, detail: String(detail).slice(0, 300) });
  console.log(ok ? "PASS" : "FAIL", "|", id, "|", name, detail ? `| ${String(detail).slice(0, 200)}` : "");
};
const api = async (who, method, path, body, extra = {}) => {
  const r = await fetch(`http://localhost:4000${path}`, { method, headers: { ...(who ? { authorization: `Bearer ${ids[who].token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra }, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
};
const session = (who) => ({ access_token: ids[who].token, token_type: "bearer", expires_in: ids[who].exp - Math.floor(Date.now() / 1000), expires_at: ids[who].exp, refresh_token: "e2e-local",
  user: { id: ids[who].sub, aud: "authenticated", role: "authenticated", email: ids[who].email, user_metadata: { full_name: ids[who].name }, app_metadata: {}, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString() } });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const consoleErrors = [];
const serverErrors = [];
// The first-run welcome is a modal: dismissed in advance except where a check is about it ({ welcome: true }).
async function pageAs(who, viewport = { width: 1440, height: 950 }, { welcome = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (who) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(session(who))]);
  if (who && !welcome) await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `mushin.welcomeDismissed.${ids[who].sub}`);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => consoleErrors.push(`${who}: ${e.message}`));
  p.on("response", (r) => { if (r.status() >= 500 && r.url().includes(":4000")) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return p;
}
const shot = (p, n) => p.screenshot({ path: decodeURIComponent(new URL(`${n}.png`, shots).pathname).replace(/^\/([A-Z]:)/, "$1") }).catch(() => {});
const nav = async (p, name) => {
  await p.getByRole("button", { name, exact: true }).first().click();
  await p.getByRole("heading", { name, exact: true }).first().waitFor({ timeout: 15000 });
};
const ws = (await api("owner", "GET", "/v1/me")).json?.workspace?.id;
const otherWs = (await api("outsider", "GET", "/v1/me")).json?.workspace?.id;
const FX = { main: "fxhomecook", mainName: "Fixture Home Cook" };

// ── Setup: a campaign with the main fixture creator, a revealed contact, on a plan that includes outreach email ──
const camp = await api("owner", "POST", "/v1/campaigns", { name: "Breakit campaign", client: "Shan Foods", status: "draft", platform: null, objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null });
const campaignId = camp.json?.id;
const creatorId = sql(`select p.creator_id from gcp.creator_profiles p where p.handle = '${FX.main}' limit 1`);
await api("owner", "POST", `/v1/campaigns/${campaignId}/creators`, { creatorIds: [creatorId] });
check("SETUP-1", "campaign with the fixture creator exists", Boolean(campaignId) && sql(`select count(*) from wp.campaign_creators where campaign_id = '${campaignId}'`) === "1", camp.status);

// ── WEL: first-run welcome card (design 2026-10-27): shown to an empty workspace, hidden once it has work, dismissal kept ──
{
  const fresh = await pageAs("outsider", undefined, { welcome: true });
  await fresh.goto("http://localhost:5173/#/dashboard");
  await fresh.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 15000 });
  const card = fresh.getByRole("dialog", { name: "Welcome to MUSHIN" });
  // isVisible() does not wait (its timeout is ignored): wait for the card, which appears once the workspace data loads.
  const shown = await card.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
  check("WEL-1", "an empty workspace sees the welcome card, with no claim MUSHIN cannot back (no creator total, no bot detection)", shown && !/3.4M|bot|pod detection|ROI/i.test(await card.innerText().catch(() => "")));
  if (shown) await card.getByRole("button", { name: /Skip for now/ }).click();
  await fresh.reload();
  await fresh.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 15000 });
  await fresh.waitForTimeout(1500);
  check("WEL-2", "a dismissed welcome card stays dismissed after reloading", shown && !(await card.isVisible().catch(() => false)));
  await fresh.context().close();
  const busy = await pageAs("owner", undefined, { welcome: true });
  await busy.goto("http://localhost:5173/#/dashboard");
  await busy.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 15000 });
  await busy.waitForTimeout(1500);
  check("WEL-3", "a workspace with lists or campaigns does not see the welcome card", !(await busy.getByRole("dialog", { name: "Welcome to MUSHIN" }).isVisible().catch(() => false)));
  await busy.context().close();
}

// ── CTY: Pakistan-only catalogue (elig-2): a creator based abroad is kept but unreachable through every customer path ──
{
  const abroad = sql(`select p.creator_id from gcp.creator_profiles p where p.handle = 'fxtorontotech' limit 1`);
  check("CTY-0", "the fixture creator based abroad is stored, with its country decision recorded", Boolean(abroad) && sql(`select country_status || ':' || coalesce(country, '') from gcp.creator_profiles where handle = 'fxtorontotech'`) === "foreign:CA");
  const names = (r) => (r.json?.results ?? []).map((x) => x.displayName);
  const byName = await api("owner", "POST", "/v1/search", { text: "Fixture Toronto Tech", filters: {}, confirmedCost: 50 });
  const byCountry = await api("owner", "POST", "/v1/search", { text: "tech", filters: { creatorCountry: "CA" }, confirmedCost: 50 });
  const byPlatform = await api("owner", "POST", "/v1/search", { text: "Toronto tech reviews", filters: { platform: "youtube", niches: ["Tech"] }, confirmedCost: 50 });
  check("CTY-1", "search by its own name, a country filter or platform/niche filters never returns it", [byName, byCountry, byPlatform].every((r) => r.status === 200 && !names(r).includes("Fixture Toronto Tech")), [byName, byCountry, byPlatform].map((r) => r.status + ":" + names(r).join("|")).join(" / "));
  const byId = await api("owner", "GET", `/v1/creators/${abroad}`);
  check("CTY-2", "opening it by id answers like an unknown id (404)", byId.status === 404, byId.status);
  const byLink = await api("owner", "GET", `/v1/creators/lookup?q=${encodeURIComponent("https://www.youtube.com/@fxtorontotech")}`);
  check("CTY-3", "looking it up by its profile link reveals nothing and offers no add", byLink.status === 200 && (byLink.json?.matches ?? []).length === 0 && byLink.json?.addable === null, JSON.stringify(byLink.json).slice(0, 160));
  const list = await api("owner", "POST", "/v1/lists", { name: `CTY ${randomUUID().slice(0, 6)}`, description: "" });
  const add = await api("owner", "POST", `/v1/lists/${list.json?.id}/members`, { creatorIds: [abroad] }, { "idempotency-key": `brk-${randomUUID()}` });
  check("CTY-4", "adding it to a list through the API is refused with the eligibility reason", add.status >= 400 && add.json?.error?.details?.reason === "creator_ineligible", `${add.status} ${add.json?.error?.details?.reason}`);
  const reveal = await api("owner", "POST", `/v1/creators/${abroad}/reveal`, { confirmedCost: 5 }, { "idempotency-key": `brk-${randomUUID()}` });
  check("CTY-6", "revealing its contacts by id answers like an unknown id (BUG-32)", reveal.status === 404, reveal.status);
  const refresh = await api("owner", "POST", "/v1/discovery/jobs", { kind: "refresh", creatorId: abroad, confirmedCost: 50 }, { "idempotency-key": `brk-${randomUUID()}` });
  check("CTY-7", "Update info on it by id is refused like an unknown id (BUG-32)", refresh.status === 404, refresh.status);
  check("CTY-5", "the creator record still exists (locked, not deleted)", sql(`select count(*) from gcp.creators where id = '${abroad}'`) === "1");
}

// ── ZR: a search that finds no eligible creator is free (owner decision 2026-10-28), also when fired concurrently ──
{
  const ws = sql(`select m.workspace_id from wp.workspace_members m join wp.users u on u.id = m.user_id where u.email = '${ids.owner.email}' and m.role = 'owner' limit 1`);
  const spends = () => sql(`select count(*) from wp.credit_ledger where workspace_id = '${ws}' and kind = 'spend' and action = 'search_existing'`);
  const balance = async () => (await api("owner", "GET", "/v1/billing/summary")).json?.balance?.available;
  const before = { spends: spends(), balance: await balance() };
  const empties = await Promise.all(Array.from({ length: 10 }, (_, i) => api("owner", "POST", "/v1/search", { text: `zzq empty probe ${i} ${randomUUID().slice(0, 6)}`, filters: {}, confirmedCost: 50 })));
  check("ZR-1", "ten concurrent searches with no eligible result answer 200, empty, uncharged and complete", empties.every((r) => r.status === 200 && r.json?.results?.length === 0 && r.json?.charged === false && r.json?.creditsCharged === 0 && r.json?.complete === true), empties.map((r) => `${r.status}:${r.json?.creditsCharged}`).join(","));
  check("ZR-2", "the balance and the ledger are unchanged by empty searches", spends() === before.spends && (await balance()) === before.balance, `${before.spends}→${spends()} ${before.balance}→${await balance()}`);
  // "Toronto" is in no other fixture's text; "Fixture Toronto Tech" also matched every fixture on Meilisearch ("Fixture").
  const abroadOnly = await api("owner", "POST", "/v1/search", { text: "Toronto", filters: {}, confirmedCost: 50 });
  const abroad = sql(`select p.creator_id from gcp.creator_profiles p where p.handle = 'fxtorontotech' limit 1`);
  const abroadIds = (abroadOnly.json?.results ?? []).map((r) => r.id ?? r.creatorId);
  check("ZR-3", "a search whose only match is an excluded (foreign) creator is empty and free", abroadOnly.status === 200 && abroadIds.length === 0 && !abroadIds.includes(abroad) && abroadOnly.json?.charged === false, `${abroadOnly.status} results=${abroadIds.length} charged=${abroadOnly.json?.charged}`);
}

// ── FEE / TA: the search fee before the click; the monthly testing allowance on the Billing page ──
{
  const p = await pageAs("owner");
  await p.goto("http://localhost:5173/#/dashboard");
  await nav(p, "Search & Discovery");
  const note = p.getByTestId("search-fee-note");
  check("FEE-1", "before searching, the page says a search costs its price when it finds creators and nothing when it finds none", /costs \d+ credits when it finds creators; a search that finds none is free/.test(await note.innerText({ timeout: 15000 }).catch(() => "")));
  await p.context().close();
  const summary = await api("outsider", "GET", "/v1/billing/summary");
  const ta = summary.json?.testingAllowance;
  const ws = summary.json ? sql(`select w.id from wp.workspaces w join wp.workspace_members m on m.workspace_id = w.id join wp.users u on u.id = m.user_id where u.email = '${ids.outsider.email}' and m.role = 'owner' limit 1`) : "";
  const grants = ws ? sql(`select count(*) from wp.credit_ledger where workspace_id = '${ws}' and kind = 'grant' and source_ref like 'testing:%'`) : "";
  check("TA-1", "a new account's first workspace shows 500 monthly testing credits, renewing at 00:00 PKT on the 1st, granted once", ta?.monthlyCredits === 500 && /T19:00:00\.000Z$/.test(ta?.renewsAt ?? "") && grants === "1", `${JSON.stringify(ta)} grants=${grants}`);
  const b = await pageAs("outsider");
  await b.goto("http://localhost:5173/#/dashboard");
  await nav(b, "Credits & billing");
  check("TA-2", "the Billing page shows the testing credits left and when they renew", /Testing credits: [\d,]+ of 500 left this month/.test(await b.getByTestId("testing-allowance").innerText({ timeout: 15000 }).catch(() => "")));
  await b.context().close();
}

// ── REV: "Leave a review" at the bottom of the app (plan Phase 12): stored, no email queued ──
{
  const ws = sql(`select m.workspace_id from wp.workspace_members m join wp.users u on u.id = m.user_id where u.email = '${ids.owner.email}' and m.role = 'owner' limit 1`);
  const outbox = () => sql(`select count(*) from platform.outbox`);
  const before = outbox();
  const p = await pageAs("owner");
  await p.goto("http://localhost:5173/#/dashboard");
  await nav(p, "Search & Discovery");
  await p.getByRole("button", { name: "Leave a review" }).click({ timeout: 15000 });
  await p.getByRole("radio", { name: "4 out of 5" }).click();
  await p.getByLabel("Anything to add? (optional)").fill("Breakit review");
  await p.getByRole("button", { name: "Send review" }).click();
  await p.getByText("Thanks for your review").first().waitFor({ timeout: 15000 }).catch(() => {});
  const row = sql(`select rating || ':' || page from wp.product_reviews where workspace_id = '${ws}' and comment = 'Breakit review'`);
  check("REV-1", "a review left at the bottom of the app is stored with its rating and page, and no email is queued", row === "4:search" && outbox() === before, `${row} outbox ${before}→${outbox()}`);
  await p.context().close();
}

// ── OUT: outreach composer through the UI ──
{
  const p = await pageAs("owner");
  await p.goto(`http://localhost:5173/#/dashboard`);
  await nav(p, "Campaigns");
  await p.getByRole("button", { name: /Breakit campaign/ }).first().click();
  await p.getByRole("heading", { name: "Breakit campaign" }).waitFor();
  await p.locator("article", { hasText: FX.mainName }).getByRole("button", { name: "Outreach" }).click();
  const op = p.getByRole("dialog", { name: /Outreach for/ });
  const usage = (await api("owner", "GET", "/v1/outreach/usage")).json;
  if (usage?.mode === "off" || usage?.limit === 0) {
    check("OUT-0", "the composer explains why sending is unavailable and still offers manual outreach", await op.getByText(/Contact them yourself/).waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false), JSON.stringify(usage));
  } else {
    await op.getByLabel("Subject").waitFor({ timeout: 15000 });
    const subject = await op.getByLabel("Subject").inputValue();
    check("OUT-1", "the draft uses the real brand and campaign names", subject.includes("Shan Foods") && subject.includes("Breakit campaign"), subject);
    const body = await op.getByLabel("Message").inputValue();
    check("OUT-2", "the draft never claims a deal is agreed", /Nothing is agreed or confirmed yet/.test(body) && !/you (have been|are) selected/i.test(body));
    // A typed address (no reveal needed), previewed before sending.
    await op.getByLabel("Recipient").selectOption({ label: "Enter another address…" });
    await op.getByLabel(/Email address you have for/).fill("agent@shanfoods.pk");
    await op.getByRole("button", { name: "Preview the email" }).click();
    const preview = op.getByRole("region", { name: "Email preview" });
    await preview.waitFor({ timeout: 15000 });
    const pt = (await preview.innerText()).replace(/\s+/g, " ");
    check("OUT-3", "the preview names the sender transparently, the reply-to person, and has the opt-out footer", /via MUSHIN/.test(pt) && pt.includes(ids.owner.email) && /To stop receiving emails sent through MUSHIN/.test(pt), pt.slice(0, 200));
    check("OUT-4", "the preview warns that a typed address is unverified", /has not checked it/.test(pt));
    const sendBtn = op.getByRole("button", { name: "Send email" });
    check("OUT-5", "Send stays disabled until the person confirms", await sendBtn.isDisabled());
    // Lost response: the server commits the send, the browser never sees the answer, the person clicks again.
    let first = true;
    await p.route("**/v1/campaigns/*/creators/*/emails", async (route) => {
      if (route.request().method() === "POST" && first) {
        first = false;
        await route.fetch(); // reaches the server and is committed
        await route.abort("connectionreset");
      } else await route.continue();
    });
    await op.getByRole("checkbox").check();
    await sendBtn.click();
    await p.waitForTimeout(1500);
    await op.getByRole("checkbox").check().catch(() => {});
    await sendBtn.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(2000);
    const rows = sql(`select count(*) from wp.outreach_emails where campaign_id = '${campaignId}'`);
    check("OUT-6", "a retry after a lost response does not send a second email (same idempotency key)", rows === "1", rows);
    // Double click on a fresh send.
    await p.unroute("**/v1/campaigns/*/creators/*/emails");
    await op.getByLabel("Subject").fill("Second note");
    await op.getByRole("button", { name: "Preview the email" }).click();
    await preview.waitFor();
    await op.getByRole("checkbox").check();
    await sendBtn.dblclick();
    await p.waitForTimeout(2500);
    check("OUT-7", "a double click sends once", sql(`select count(*) from wp.outreach_emails where campaign_id = '${campaignId}' and subject = 'Second note'`) === "1");
    check("OUT-8", "the typed address is stored for this workspace only, unverified, and the creator's own contacts are unchanged",
      sql(`select count(*) from wp.workspace_contacts where workspace_id = '${ws}' and source = 'user_provided' and status = 'unverified'`) === "1" && sql(`select count(*) from wp.workspace_contacts where workspace_id <> '${ws}'`) === "0");
  }
  await shot(p, "out-composer");
  await p.context().close();
}

// ── SEC: cross-workspace access with modified ids (API; hidden buttons are not a control) ──
{
  const outsiderDraft = await api("outsider", "GET", `/v1/campaigns/${campaignId}/creators/${creatorId}/email-draft`);
  check("SEC-1", "another workspace cannot open this campaign's email draft", outsiderDraft.status === 404, outsiderDraft.status);
  const outsiderSend = await api("outsider", "POST", `/v1/campaigns/${campaignId}/creators/${creatorId}/emails`, { manualEmail: "x@shanfoods.pk", subject: "x", body: "y", confirm: true }, { "idempotency-key": `brk-${randomUUID()}` });
  check("SEC-2", "another workspace cannot send through this campaign", [403, 404].includes(outsiderSend.status), outsiderSend.status);
  const imports = await api("owner", "POST", "/v1/imports", { source: "Breakit", csv: `profile_url,email\nhttps://instagram.com/${FX.main},owner-import@shanfoods.pk` }, { "idempotency-key": `brk-${randomUUID()}` });
  const importId = imports.json?.id;
  check("IMP-1", "an import through the API answers row by row", imports.status === 201 && imports.json?.counts?.total === 1, imports.status);
  check("SEC-3", "another workspace cannot read the import", (await api("outsider", "GET", `/v1/imports/${importId}`)).status === 404);
  check("SEC-4", "unauthenticated requests are refused", (await api(null, "GET", "/v1/imports")).status === 401 && (await api(null, "GET", `/v1/campaigns/${campaignId}/creators/${creatorId}/email-draft`)).status === 401);
  const expired = await api("expired", "GET", "/v1/me");
  check("SEC-5", "an expired session is refused", expired.status === 401, expired.status);
  const forged = await api(null, "POST", "/webhooks/resend", JSON.stringify({ type: "email.bounced", data: { email_id: "x" } }), { "content-type": "application/json", "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" });
  check("SEC-6", "a forged email webhook is rejected (or not served in test mode)", [401, 404].includes(forged.status), forged.status);
  const badJson = await api("owner", "POST", "/v1/imports", "{not json", { "idempotency-key": `brk-${randomUUID()}` });
  check("SEC-7", "malformed JSON is a clean 400 without internals", badJson.status === 400 && !/at \w+ \(|node_modules|stack/i.test(badJson.text), badJson.status);
  const inj = await api("owner", "POST", "/v1/search", { text: "food'; drop table gcp.creators; --", filters: {}, confirmedCost: 50 });
  check("SEC-8", "SQL injection text in search is treated as text", [200, 402, 409].includes(inj.status) && sql(`select count(*) > 0 from gcp.creators`) === "t", inj.status);
  const xssName = await api("owner", "POST", "/v1/campaigns", { name: `<img src=x onerror="window.__xss=1">`, client: "", status: "draft", platform: null, objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null });
  const p = await pageAs("owner");
  await p.goto(`http://localhost:5173/#/dashboard`);
  await nav(p, "Campaigns");
  await p.waitForTimeout(1000);
  check("SEC-9", "a campaign name with HTML is shown as text and never runs", xssName.status === 201 && (await p.evaluate(() => globalThis.__xss)) === undefined && (await p.getByText('<img src=x onerror="window.__xss=1">').count()) > 0);
  await p.context().close();
}

// ── IMP: import through the UI ──
{
  const p = await pageAs("owner");
  await p.goto(`http://localhost:5173/#/dashboard`);
  await nav(p, "Shortlists");
  await p.getByRole("button", { name: "Import creators" }).click();
  const csvPath = join(tmpdir(), `breakit-${label}.csv`);
  writeFileSync(csvPath, `profile_url,platform,niche,country\nhttps://youtube.com/@${FX.main},youtube,cooking,Pakistan\nyoutube.com/@${FX.main},,,\nhttps://facebook.com/x,,,\n=HYPERLINK("http://evil"),,,\n`);
  await p.getByLabel("CSV file").setInputFiles(csvPath);
  await p.getByLabel("Where the list comes from").fill("Breakit agency list");
  await p.getByRole("button", { name: "Import", exact: true }).click();
  await p.getByText(/rows: /).waitFor({ timeout: 20000 });
  const t = (await p.getByRole("region", { name: "Import creators" }).innerText()).replace(/\s+/g, " ");
  check("IMP-2", "the UI import reports matched, duplicate and unusable rows", /4 rows: 1 in MUSHIN, 0 not in MUSHIN yet, 2 not usable, 1 duplicates/.test(t), t.slice(t.indexOf("rows:") - 3, t.indexOf("rows:") + 120));
  check("IMP-3", "a formula-like cell is shown as plain text, never evaluated", t.includes('=HYPERLINK("http://evil")'));
  check("IMP-4", "the import never changed the shared catalogue's niches or country", sql(`select count(*) from gcp.creator_attribute_evidence where source not in ('profile_text','post_text','platform_registration','ai_assessment','display_name','account_category')`) === "0");
  await shot(p, "imp-ui");
  await p.context().close();
}

// ── SRCH: city filter hidden; the AI reading only on request ──
{
  const p = await pageAs("owner");
  const interpretCalls = [];
  p.on("request", (r) => { if (r.url().includes("/v1/search/interpret")) interpretCalls.push(r.url()); });
  await p.goto(`http://localhost:5173/#/dashboard`);
  await nav(p, "Search & Discovery");
  const input = p.getByPlaceholder(/Find Pakistani creators/);
  await input.fill("food creators in Lahore");
  await input.press("Enter");
  await p.waitForTimeout(2500);
  check("SRCH-1", "a catalogue search makes no AI call", interpretCalls.length === 0, interpretCalls.length);
  const suggest = p.getByRole("button", { name: "Suggest filters with AI" });
  check("SRCH-2", "the AI reading is offered as a button", await suggest.isVisible());
  const filters = p.getByRole("button", { name: /Filters/ }).first();
  if (await filters.isVisible().catch(() => false)) {
    await filters.click();
    await p.waitForTimeout(500);
    // Owner directive 2026-11-03: the city filter is offered again.
    check("SRCH-3", "the filter panel offers the city filter", (await p.getByText("City", { exact: true }).count()) > 0 && (await p.getByRole("button", { name: "Lahore", exact: true }).count()) > 0);
    await p.keyboard.press("Escape");
  } else check("SRCH-3", "the filter panel offers the city filter", false, "filters button not found");
  const sent = await api("owner", "POST", "/v1/search", { text: "food", filters: { creatorCity: "Karachi" }, confirmedCost: 50 });
  check("SRCH-4", "the server honours an explicit city filter", sent.status === 200, sent.status);
  await p.context().close();
}

// ── CRD: two users spending the last credits at the same time ──
{
  const bal = (await api("outsider", "GET", "/v1/billing/summary")).json?.balance?.available ?? -1;
  const spendsBefore = Number(sql(`select count(*) from wp.credit_ledger where workspace_id = '${otherWs}' and kind = 'spend' and action = 'search_existing'`));
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => api("outsider", "POST", "/v1/search", { text: `food ${i}`, filters: {}, confirmedCost: 50 })));
  const ok = attempts.filter((a) => a.status === 200).length;
  const spendsAfter = Number(sql(`select count(*) from wp.credit_ledger where workspace_id = '${otherWs}' and kind = 'spend' and action = 'search_existing'`));
  const after = (await api("outsider", "GET", "/v1/billing/summary")).json?.balance?.available ?? -1;
  check("CRD-3", "the charges equal the balance change (each answered search charged its price once)", bal - after === ok * 50, `${bal} - ${after} vs ${ok} x 50`);
  check("CRD-1", "12 concurrent paid searches never charge more than answered, never twice", spendsAfter - spendsBefore === ok, `${ok} answered, ${spendsAfter - spendsBefore} charges`);
  check("CRD-2", "the balance never goes negative", after >= 0 && bal >= 0, `${bal} → ${after}`);
}

// ── PAY: a workspace on its trial buys a plan through the mock checkout, double-clicking Pay ──
{
  const plans = (await api("outsider", "GET", "/v1/billing/plans")).json?.plans ?? [];
  const plan = plans.find((x) => x.entitlements?.outreachEmailsPerMonth !== 0);
  const before = (await api("outsider", "GET", "/v1/billing/summary")).json;
  if (plan && before?.status !== "active") {
    const p = await pageAs("outsider");
    await p.goto("http://localhost:5173/#/dashboard");
    await nav(p, "Credits & billing");
    await p.getByRole("button", { name: "Choose a plan" }).last().click();
    await p.getByRole("button", { name: `Choose ${plan.name}` }).click();
    await p.waitForURL(/mock-paddle\/checkout/, { timeout: 20000 });
    await p.getByRole("button", { name: /^Pay / }).dblclick();
    await p.waitForURL(/checkout=success|#\/billing|#\/dashboard/, { timeout: 30000 }).catch(() => {});
    let sub = null;
    for (let i = 0; i < 20; i++) { sub = (await api("outsider", "GET", "/v1/billing/summary")).json; if (sub?.status === "active") break; await new Promise((r) => setTimeout(r, 1000)); }
    const payments = sql(`select count(*) from wp.payments where workspace_id = '${otherWs}'`);
    const grants = sql(`select count(*) from wp.credit_ledger where workspace_id = '${otherWs}' and kind = 'grant' and source_ref like 'monthly:%'`);
    check("PAY-1", "a double-clicked Pay activates the plan once: one payment, one plan credit grant", sub?.status === "active" && payments === "1" && grants === "1", `${sub?.status} payments ${payments} grants ${grants}`);
    check("PAY-2", "the shown balance equals the credit lots", Number(sql(`select coalesce(sum(remaining),0) from wp.credit_lots where workspace_id = '${otherWs}' and (expires_at is null or expires_at > now())`)) === sub.balance.available + sub.balance.reserved);
    await p.context().close();
  } else check("PAY-1", "a plan with outreach email exists and the workspace can buy it", false, JSON.stringify({ plan: plan?.id, status: before?.status }));
}

// ── AUTH: sign-up outcomes through the real page; Supabase Auth's answers are mocked (the local stub has no sign-up) ──
{
  const shapes = {
    fresh: { status: 200, body: { id: "u1", email: "new@shanfoods.pk", identities: [{ id: "i1" }], user_metadata: {} } },
    existingHidden: { status: 200, body: { id: "u2", email: "owner@e2e.test", identities: [], user_metadata: {} } },
    existingError: { status: 422, body: { code: "user_already_exists", error_code: "user_already_exists", msg: "User already registered" } },
    weak: { status: 422, body: { code: "weak_password", error_code: "weak_password", msg: "Password should be at least 6 characters." } },
  };
  const outcome = async (shape, email) => {
    const p = await pageAs(null);
    const sent = [];
    await p.route("**/auth/v1/signup**", async (route) => {
      sent.push(JSON.parse(route.request().postData() ?? "{}").email);
      if (shape === "offline") return route.abort("internetdisconnected");
      const r = shapes[shape];
      await route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
    });
    await p.goto("http://localhost:5173/#/signup");
    await p.getByLabel("Full name").fill("Sana Test");
    await p.getByLabel("Work email").fill(email);
    await p.getByLabel("Password").fill("a-long-passphrase-2026");
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: /Create account|Start/i }).first().click();
    await p.waitForTimeout(1500);
    const text = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    await p.context().close();
    return { text, sent };
  };
  const fresh = await outcome("fresh", "  New@ShanFoods.pk ");
  const hidden = await outcome("existingHidden", "owner@e2e.test");
  const errored = await outcome("existingError", "owner@e2e.test");
  // Owner decision 2026-11-02: an already-registered address is told so (both response shapes), with sign-in and reset.
  const exists = (t) => /This email is already registered/.test(t) && !/Check your inbox at/.test(t) && !/User already registered/.test(t);
  check("AUTH-1", "a new address is asked to verify its email; an already-registered one gets 'already registered', never a false 'account created'", /Check your inbox at new@shanfoods\.pk\. We've sent a confirmation link/.test(fresh.text) && exists(hidden.text) && exists(errored.text), `${fresh.text.slice(0, 80)} | ${hidden.text.slice(0, 80)}`);
  check("AUTH-2", "the address is sent trimmed and lower-cased", fresh.sent[0] === "new@shanfoods.pk", fresh.sent.join(","));
  const weak = await outcome("weak", "weak@shanfoods.pk");
  check("AUTH-3", "a weak password gets a plain message, not the provider's text", /stronger password/.test(weak.text) && !/at least 6 characters/.test(weak.text));
  const offline = await outcome("offline", "offline@shanfoods.pk");
  check("AUTH-4", "a lost connection never claims the account was or was not created", /can't tell whether your account was created/.test(offline.text) && !/Check your inbox at/.test(offline.text));
}

writeFileSync(new URL(`breakit-${label}.json`, here), JSON.stringify({ label, results, consoleErrors, serverErrors }, null, 1));
check("HEALTH-1", "no server error (5xx) during the run", serverErrors.length === 0, serverErrors.slice(0, 3).join(" | "));
check("HEALTH-2", "no uncaught page error during the run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
console.log(JSON.stringify({ label, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
await browser.close();
