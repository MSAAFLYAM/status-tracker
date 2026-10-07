/**
 * e2e-live.js — headless test against the DEPLOYED site (GitHub Pages).
 *
 * Checks, on the live URL:
 *   - static: index, manifest MIME + relative start_url/scope/id, icons,
 *     every precache target in sw.js, no root-absolute HTML references
 *   - browser: manifest parses with no errors (install), service worker
 *     scope, beforeinstallprompt, first-run PIN setup
 *   - OFFLINE: network is cut (CDP offline emulation), the page reloads from
 *     the service worker cache, PIN unlocks, other screens render
 *   - hygiene: no 4xx/5xx, zero third-party requests, no page errors
 *
 * Run: node tools/e2e-live.js [url]
 *      LIVE_URL=https://msaaflyam.github.io/status-tracker/ node tools/e2e-live.js
 */
"use strict";

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const BASE =
  process.argv[2] ||
  process.env.LIVE_URL ||
  "https://msaaflyam.github.io/status-tracker/";
const CHROME =
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p)) || process.env.CHROME_PATH;

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("FAILED: " + msg);
  passed++;
  console.log("  ok   " + msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unlock(page) {
  await page.waitForFunction(() => {
    const l = document.getElementById("lock");
    return (l && !l.hidden) || (document.getElementById("app") && document.getElementById("app").innerText.length > 0);
  }, { timeout: 15000 });
  const st = await page.evaluate(() => ({
    vis: !document.getElementById("lock").hidden,
    setup: !!document.getElementById("ack"),
  }));
  if (!st.vis) return;
  await page.evaluate((setup) => {
    if (setup) document.getElementById("ack").checked = true;
    ["1", "2", "3", "4"].forEach((k) => document.querySelector(`#lock [data-k="${k}"]`).click());
    document.querySelector('#lock [data-k="ok"]').click();
  }, st.setup);
  await page.waitForFunction(() => document.getElementById("lock").hidden === true, { timeout: 10000 });
}

const nav = (page, label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("#nav button")].find((x) => x.textContent.includes(label));
    if (b) b.click();
    return !!b;
  }, label);

async function main() {
  console.log(`\n[live] target: ${BASE}`);

  console.log("\n[live] static checks");
  const index = await fetch(BASE);
  assert(index.ok && (index.headers.get("content-type") || "").includes("text/html"), `index responds 200 HTML (${index.status})`);

  const noSlash = await fetch(BASE.replace(/\/$/, ""), { redirect: "manual" });
  assert(
    [301, 302].includes(noSlash.status) && (noSlash.headers.get("location") || "").endsWith("/"),
    `no-trailing-slash redirects to the canonical URL (${noSlash.status} -> ${noSlash.headers.get("location")})`
  );

  const mfRes = await fetch(new URL("manifest.webmanifest", BASE));
  assert(mfRes.ok, `manifest.webmanifest responds (${mfRes.status})`);
  const mfType = mfRes.headers.get("content-type") || "";
  console.log(`       manifest content-type: ${mfType}`);
  const manifest = await mfRes.json();
  assert(
    manifest.start_url === "./" && manifest.scope === "./" && manifest.id === "./",
    `manifest start_url/scope/id are relative -> "${manifest.start_url}"`
  );
  assert(manifest.display === "standalone" && manifest.lang === "ar" && manifest.dir === "rtl", "manifest: standalone, lang=ar, dir=rtl");
  assert(/png|svg|image/.test(mfType) === false, "manifest served as JSON, not an image");
  for (const ic of manifest.icons) {
    const r = await fetch(new URL(ic.src, BASE));
    assert(r.ok, `icon ${ic.src} -> ${r.status}`);
  }

  const swRes = await fetch(new URL("sw.js", BASE));
  assert(swRes.ok, `sw.js responds (${swRes.status})`);
  const swText = await swRes.text();
  const version = (swText.match(/const VERSION = "([^"]+)"/) || [])[1];
  assert(!!version, `deployed service worker version: ${version}`);
  const localSw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const localVersion = (localSw.match(/const VERSION = "([^"]+)"/) || [])[1];
  assert(version === localVersion, `deployed VERSION matches local sw.js (${localVersion})`);
  const assets = [...swText.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert(assets.length >= 20, `precache list has ${assets.length} entries`);
  const localAssets = [...localSw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert(
    JSON.stringify(assets) === JSON.stringify(localAssets),
    "deployed precache list matches the local sw.js (no stale deployment)"
  );
  for (const a of assets) {
    const r = await fetch(new URL(a, BASE));
    assert(r.ok, `precache target ${a} -> ${r.status}`);
  }
  assert(assets.every((a) => !a.startsWith("/")), "precache targets are relative (no leading /)");

  const html = await index.text();
  const rootish = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith("/"));
  assert(rootish.length === 0, `index.html has no root-absolute URLs (${rootish.join(", ") || "none"})`);

  console.log("\n[browser] install + service worker + PIN on the live site");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 412, height: 900, isMobile: true, hasTouch: true },
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const badResponses = [];
  const thirdParty = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("console: " + m.text());
  });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400) badResponses.push(r.status() + " " + u);
    if (!u.startsWith(BASE)) thirdParty.push(u);
  });

  await page.evaluateOnNewDocument(() => {
    window.__bip = new Promise((res) =>
      window.addEventListener(
        "beforeinstallprompt",
        (e) => {
          e.preventDefault();
          res(true);
        },
        { once: true }
      )
    );
  });

  await page.goto(BASE, { waitUntil: "load", timeout: 45000 });

  const cdp = await page.target().createCDPSession();
  const appManifest = await cdp.send("Page.getAppManifest");
  const mfErrors = appManifest.errors || [];
  assert(mfErrors.length === 0, "browser reports no manifest errors" + (mfErrors.length ? ": " + JSON.stringify(mfErrors) : ""));

  await page.evaluate(() => navigator.serviceWorker.ready);
  const scope = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.scope : null;
  });
  assert(scope === BASE, `service worker scope is the live subpath (${scope})`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 });
  assert(true, "service worker controls the page");

  const bipFired = await Promise.race([
    page.evaluate(() => window.__bip).catch(() => false),
    sleep(20000).then(() => false),
  ]);
  assert(bipFired === true, "browser fired beforeinstallprompt (Chrome considers the deployed app installable)");

  await page.waitForFunction(() => !document.getElementById("lock").hidden, { timeout: 15000 });
  assert(await page.evaluate(() => !!document.getElementById("ack")), "forced first-run PIN setup screen appears");
  await unlock(page);
  assert(await page.evaluate(() => document.getElementById("lock").hidden), "PIN saved and app unlocked");
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("لا يوجد أي موظف بعد"),
    "app renders from the live URL"
  );

  assert(await nav(page, "لوحة"), "dashboard tab clicked");
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("لوحة الوضعية"),
    "dashboard renders on the live site"
  );

  console.log("\n[offline] cut the network, reload, unlock");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await unlock(page);
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("بحث"),
    "app reloads and unlocks with the network cut (service worker cache)"
  );
  assert(await nav(page, "استيراد"), "import tab clicked while offline");
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("استيراد CSV"),
    "other screens render offline"
  );

  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log("       network restored");

  console.log("\n[hygiene]");
  assert(badResponses.length === 0, "no 4xx/5xx responses" + (badResponses.length ? " — " + badResponses.join(" | ") : ""));
  assert(thirdParty.length === 0, "zero third-party/external requests (offline-first, no CDNs)" + (thirdParty.length ? " — " + thirdParty.join(" | ") : ""));
  assert(pageErrors.length === 0, "no page errors" + (pageErrors.length ? " — " + pageErrors.join(" | ") : ""));

  await browser.close();
  console.log(`\nLIVE TEST PASSED (${passed} assertions) — ${BASE}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\n" + (err && err.stack ? err.stack : err));
    process.exit(1);
  }
);
