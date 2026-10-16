/* global process, console, fetch, URL, document, window -- Node script; the page callbacks run in the browser */
// The production build under its own security headers (audit SEC-14): serves frontend/dist with the headers from
// dist/_headers exactly as the static host would, opens the public pages in Chrome and fails on any Content-Security-
// Policy violation or a page that does not render. Local only. Usage: node csp-check.mjs  (after `vite build`)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(import.meta.dirname, "../../frontend/dist");
const rules = [];
let current = null;
for (const line of readFileSync(join(DIST, "_headers"), "utf8").split("\n")) {
  if (!line.trim()) continue;
  if (!line.startsWith(" ")) rules.push((current = { path: line.trim(), headers: {} }));
  else if (current) {
    const i = line.indexOf(":");
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
const matches = (pattern, path) => (pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  for (const r of rules) if (matches(r.path, path)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  if (path.startsWith("/api/")) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Authentication required", requestId: "csp" } }));
  }
  const file = join(DIST, path === "/" ? "index.html" : path);
  const body = existsSync(file) && file.startsWith(DIST) ? readFileSync(file) : readFileSync(join(DIST, "index.html"));
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/html" });
  res.end(body);
}).listen(4610, "127.0.0.1");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", "|", name, detail ? `| ${detail}` : "");
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const head = await fetch("http://127.0.0.1:4610/");
  check("the page is served with the policy and no-cache", Boolean(head.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")) && head.headers.get("cache-control") === "no-cache");
  const pages = [["landing", "/"], ["sign in", "/#/login"], ["sign up", "/#/signup"], ["terms", "/#/terms"], ["reset password", "/#/reset-password"], ["staff sign-in", "/#/admin/login"]];
  for (const [name, path] of pages) {
    const page = await browser.newPage();
    const violations = [];
    page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text().slice(0, 160)));
    page.on("pageerror", (e) => violations.push(`page error: ${e.message.slice(0, 200)}`));
    await page.exposeFunction("__cspViolation", (v) => violations.push(v));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(`${e.violatedDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`)));
    await page.goto(`http://127.0.0.1:4610${path}`, { waitUntil: "networkidle" });
    const text = (await page.evaluate(() => document.getElementById("root")?.innerText ?? "")).trim();
    check(`${name} renders under the policy without violations`, text.length > 20 && violations.length === 0, violations[0] ?? `${text.length} chars`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(JSON.stringify({ check: "spa-security-headers", passed: results.length - failed, failed }));
process.exit(failed ? 1 : 0);
