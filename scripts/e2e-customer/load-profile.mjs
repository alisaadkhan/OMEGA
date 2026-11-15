// Measures how the deployed site loads on a normal connection and on throttled mobile networks (real-world testing brief
// §4, §9): time to the first contentful paint, to the page's main heading and to network idle, and the bytes
// downloaded. Read-only: it opens public pages only.
//   node scripts/e2e-customer/load-profile.mjs https://omega-api-kappa.vercel.app
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "https://omega-api-kappa.vercel.app";
// Chrome DevTools presets (download/upload bytes per second, round-trip ms).
const NETWORKS = {
  "desktop (no throttling)": null,
  "slow 4G": { download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8, latency: 150 },
  "fast 3G": { download: (1.5 * 1024 * 1024) / 8 / 1.5, upload: (750 * 1024) / 8, latency: 562.5 },
};
const PAGES = { landing: "/", login: "/#/login", signup: "/#/signup" };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const [netName, net] of Object.entries(NETWORKS)) {
  for (const [pageName, path] of Object.entries(PAGES)) {
    const context = await browser.newContext(net ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 800 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (net) await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: net.download, uploadThroughput: net.upload, latency: net.latency });
    let bytes = 0;
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    const t0 = Date.now();
    // The app polls in the background, so "network idle" never comes: measure the load event and the first heading.
    await page.goto(base + path, { waitUntil: "load", timeout: 120_000 });
    const loaded = Date.now() - t0;
    const heading = await page.locator("h1, h2").first().textContent({ timeout: 60_000 }).catch(() => null);
    const headingMs = Date.now() - t0;
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null);
    console.log(JSON.stringify({ network: netName, page: pageName, firstContentfulPaintMs: fcp === null ? null : Math.round(fcp), loadEventMs: loaded, headingVisibleMs: headingMs, downloadedKB: Math.round(bytes / 1024), heading: heading?.trim().slice(0, 40) ?? null }));
    await context.close();
  }
}
await browser.close();
