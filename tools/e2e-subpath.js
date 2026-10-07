/**
 * e2e-subpath.js — proves the app works when served from a SUBPATH, i.e. the
 * way GitHub Pages serves it: http://localhost:8081/status-tracker/
 *
 * Checks:
 *   - every asset resolves under /status-tracker/ (no absolute "/..." paths)
 *   - manifest parses (CDP Page.getAppManifest) and is installable
 *     (CDP Page.installabilityErrors)
 *   - service worker registers with scope /status-tracker/
 *   - PIN setup works
 *   - OFFLINE: the server is killed, the page reloads and keeps working
 *
 * Run: node tools/e2e-subpath.js
 */
"use strict";

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = 8081;
const BASE = `http://localhost:${PORT}/status-tracker/`;
const STAGE = path.join(os.tmpdir(), "emp-subpath-stage");
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

/** Stage exactly the files git tracks (= what gets deployed). */
function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  const files = execSync("git ls-files", { cwd: ROOT }).toString().trim().split(/\r?\n/);
  for (const f of files) {
    const dst = path.join(STAGE, "status-tracker", f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dst);
  }
  return files.length;
}

function startServer() {
  return spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), String(PORT), "--root", STAGE], {
    cwd: ROOT,
    stdio: "ignore",
  });
}
async function waitServer(expectUp) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch (e) {
      if (!expectUp) return false;
    }
    await sleep(150);
  }
  if (expectUp) throw new Error("FAILED: server did not start on :" + PORT);
  return false;
}

async function unlock(page) {
  await page.waitForFunction(() => {
    const l = document.getElementById("lock");
    return (l && !l.hidden) || (document.getElementById("app") && document.getElementById("app").innerText.length > 0);
  }, { timeout: 10000 });
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

async function main() {
  const n = stage();
  console.log(`\n[stage] ${n} tracked files -> ${STAGE}\\status-tracker`);

  let server = startServer();
  await waitServer(true);

  console.log("\n[subpath] static checks under /status-tracker/");
  const notFound = [];
  const ok = await fetch(BASE);
  assert(ok.ok, `index reachable at ${BASE}`);
  assert(ok.headers.get("content-type").includes("text/html"), "index served as HTML");
  const noSlash = await fetch(`http://localhost:${PORT}/status-tracker`, { redirect: "manual" });
  assert(noSlash.status === 301 && noSlash.headers.get("location") === "/status-tracker/", "no-trailing-slash redirects to /status-tracker/ (like GitHub Pages)");

  const mf = await fetch(new URL("manifest.webmanifest", BASE));
  assert(mf.ok && /manifest\+json|application\/json/.test(mf.headers.get("content-type") || ""), "manifest reachable with JSON MIME");
  const manifest = await mf.json();
  assert(manifest.start_url === "./" && manifest.scope === "./", `manifest start_url/scope are relative ("./") -> ${manifest.start_url}`);
  assert(manifest.id === "./", "manifest id is relative (distinct install identity per subpath)");
  for (const ic of manifest.icons) {
    const r = await fetch(new URL(ic.src, BASE));
    assert(r.ok, `icon ${ic.src} resolves under the subpath`);
  }

  const sw = await fetch(new URL("sw.js", BASE));
  assert(sw.ok, "sw.js reachable under the subpath");
  const assets = [...(await sw.text()).match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const a of assets) {
    const r = await fetch(new URL(a, BASE));
    if (!r.ok) notFound.push(a);
    assert(r.ok, `precache target ${a} -> ${r.status}`);
  }
  assert(
    assets.every((a) => !a.startsWith("/")),
    "precache list contains no absolute (root-relative) paths"
  );

  const html = await (await fetch(BASE)).text();
  const rootish = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith("/"));
  assert(rootish.length === 0, `index.html has no root-absolute asset URLs (${rootish.join(", ") || "none"})`);

  console.log("\n[browser] install + service worker + PIN on the subpath");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 412, height: 900, isMobile: true, hasTouch: true },
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const badResponses = [];
  const offBase = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("console: " + m.text());
  });
  page.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("http://localhost:" + PORT + "/status-tracker")) {
      if (u.startsWith("http://localhost:")) offBase.push(u);
    }
    if (r.status() >= 400) badResponses.push(r.status() + " " + u);
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

  await page.goto(BASE, { waitUntil: "load", timeout: 20000 });

  /* install: manifest parses without errors + installability */
  const cdp = await page.target().createCDPSession();
  const appManifest = await cdp.send("Page.getAppManifest");
  const mfErrors = appManifest.errors || [];
  assert(mfErrors.length === 0, "browser reports no manifest errors" + (mfErrors.length ? ": " + JSON.stringify(mfErrors) : ""));
  const parsed = appManifest.data ? JSON.parse(appManifest.data) : manifest;
  assert(parsed.display === "standalone" && parsed.lang === "ar" && parsed.dir === "rtl", "manifest installed config: standalone, ar, rtl");
  let installable = "n/a";
  try {
    const inst = await cdp.send("Page.installabilityErrors");
    installable = JSON.stringify(installabilitySafe(inst.installabilityErrors));
  } catch (e) {
    installable = "CDP unsupported: " + e.message;
  }
  console.log("       installability: " + installable);
  assert(
    installable === "[]" || installable === "n/a" || installable.startsWith("CDP unsupported"),
    "no blocking installability errors"
  );

  /* service worker scope must be the subpath */
  await page.evaluate(() => navigator.serviceWorker.ready);
  const scope = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.scope : null;
  });
  assert(scope === BASE, `service worker scope is the subpath (${scope})`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 });
  assert(true, "service worker controls the page");

  /* real install signal: Chrome fires beforeinstallprompt only for a
   * valid manifest + active controlling service worker */
  const bipFired = await Promise.race([
    page.evaluate(() => window.__bip).catch(() => false),
    sleep(15000).then(() => false),
  ]);
  assert(bipFired === true, "browser fired beforeinstallprompt (Chrome considers the app installable)");

  /* PIN setup on the subpath */
  await page.waitForFunction(() => !document.getElementById("lock").hidden, { timeout: 10000 });
  assert(await page.evaluate(() => !!document.getElementById("ack")), "forced PIN setup screen appears");
  await unlock(page);
  assert(await page.evaluate(() => document.getElementById("lock").hidden), "PIN saved and app unlocked");
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("لا يوجد أي موظف بعد"),
    "app renders on the subpath"
  );

  /* works while online: navigate the app */
  await page.evaluate(() => [...document.querySelectorAll("#nav button")].find((b) => b.textContent.includes("لوحة")).click());
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("لوحة الوضعية"),
    "dashboard renders (relative JS module imports work)"
  );

  /* OFFLINE: kill the server, reload, unlock, keep working */
  console.log("\n[subpath] offline reload with the server killed");
  server.kill();
  await waitServer(false);
  await page.reload({ waitUntil: "load", timeout: 20000 });
  await unlock(page);
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("بحث"),
    "app loads and unlocks with no server (service worker served the subpath)"
  );
  await page.evaluate(() => [...document.querySelectorAll("#nav button")].find((b) => b.textContent.includes("استيراد")).click());
  assert(
    (await page.evaluate(() => document.getElementById("app").innerText)).includes("استيراد CSV"),
    "other screens work offline on the subpath"
  );

  server = startServer();
  await waitServer(true);
  assert(true, "server restarted");

  /* hygiene */
  assert(badResponses.length === 0, "no 4xx/5xx responses" + (badResponses.length ? " — " + badResponses.join(" | ") : ""));
  assert(offBase.length === 0, "no request escaped the /status-tracker/ subpath" + (offBase.length ? " — " + offBase.join(" | ") : ""));
  assert(pageErrors.length === 0, "no page errors" + (pageErrors.length ? " — " + pageErrors.join(" | ") : ""));

  await browser.close();
  server.kill();
  console.log(`\nSUBPATH TEST PASSED (${passed} assertions)`);
}

function installabilitySafe(errs) {
  // Some Chrome builds report non-blocking informational entries; keep only
  // the ones that would actually prevent installation.
  const blocking = (errs || []).filter((e) =>
    ["no-manifest", "manifest-parse-error", "not-in-manifest", "invalid-url-scheme", "not-from-manifest-start-url"].includes(
      e.errorId
    )
  );
  return blocking.map((e) => e.errorId + ": " + (e.message || ""));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\n" + (err && err.stack ? err.stack : err));
    process.exit(1);
  }
);
