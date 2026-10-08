/**
 * e2e.js — headless-Chrome test run against a local server.
 * Covers the acceptance tests from the spec:
 *   1. works offline (airplane mode) after the first load
 *   2. searching a last name returns everyone with that name
 *   3. 30-day leave from today => status + return date; past leave => "يعمل"
 *   4. التقاعد needs no date and no duration, and stays
 *   5. export -> wipe -> restore brings everything back (photos included)
 *   6. CSV with ";" and Arabic headers imports correctly
 * Plus: forced PIN setup, dashboard, label/type renaming, manifest + precache.
 *
 * Run: node tools/e2e.js   (starts/stops its own server on port 8123)
 */
"use strict";

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = 8123;
const BASE = `http://localhost:${PORT}/`;
const DL = path.join(os.tmpdir(), "emp-e2e-dl");
const SAMPLE = path.join(ROOT, "sample-fake.csv");
const PHOTO = path.join(ROOT, "icons", "icon-192.png");
const PIN = "1234";

const CHROME =
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => fs.existsSync(p)) || process.env.CHROME_PATH;

/* ------------------------------------------------------------- helpers ---- */

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("FAILED: " + msg);
  passed++;
  console.log("  ok   " + msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function txt(page, sel = "#app") {
  return page.$eval(sel, (e) => e.innerText);
}
async function hasTxt(page, s, sel = "#app") {
  return (await txt(page, sel)).includes(s);
}
async function assertTxt(page, s, sel = "#app", msg) {
  assert(await hasTxt(page, s, sel), msg || `screen contains "${s}"`);
}
async function closeAlert(page) {
  await page.waitForFunction(() => !!document.querySelector(".modal"), { timeout: 6000 });
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.includes("حسنًا"))?.click());
  await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 6000 });
}
async function click(page, sel, idx = 0) {
  const r = await page.evaluate(
    (sel, idx) => {
      const els = [...document.querySelectorAll(sel)];
      if (!els[idx]) return false;
      els[idx].click();
      return true;
    },
    sel,
    idx
  );
  assert(r, `click ${sel}[${idx}]`);
}
async function clickText(page, sel, text) {
  // The handler may render the target asynchronously (file reads, IDB writes),
  // so poll briefly instead of failing on the first miss.
  let r = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    r = await page.evaluate(
      (sel, text) => {
        const el = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(text));
        if (!el) return false;
        el.click();
        return true;
      },
      sel,
      text
    );
    if (r) break;
    await sleep(120);
  }
  assert(r, `click ${sel} containing "${text}"`);
}
async function setVal(page, sel, value) {
  await page.$eval(
    sel,
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );
}

async function unlock(page) {
  await page.waitForFunction(
    () => {
      const l = document.getElementById("lock");
      return (l && !l.hidden) || (document.getElementById("app") && document.getElementById("app").innerText.length > 0);
    },
    { timeout: 10000 }
  );
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
async function open(page, url = BASE) {
  await page.goto(url, { waitUntil: "load", timeout: 15000 });
  await unlock(page);
}
async function search(page, q) {
  await setVal(page, "#q", q);
  await clickText(page, "#app [data-a='go']", "بحث");
}
async function openEmployee(page, q) {
  await search(page, q);
  await click(page, ".card[data-id]", 0);
}
async function waitForFile(pattern, timeout = 10000) {
  const re = new RegExp(pattern);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hit = fs.readdirSync(DL).find((n) => re.test(n));
    if (hit) return path.join(DL, hit);
    await sleep(150);
  }
  throw new Error("FAILED: no file downloaded matching " + pattern);
}

function startServer() {
  const s = spawn(process.execPath, [path.join(ROOT, "tools", "serve.js"), String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
    detached: false,
  });
  return s;
}
async function waitServer(up) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch (e) {
      if (!up) return false;
    }
    await sleep(150);
  }
  if (up) throw new Error("FAILED: server did not start");
  return false;
}

/* ------------------------------------------------------------ test cases --- */

async function staticChecks() {
  console.log("\n[static] manifest, icons, precache list");
  const res = await fetch(BASE + "manifest.webmanifest");
  assert(res.ok, "manifest reachable");
  assert(/manifest\+json|application\/json/.test(res.headers.get("content-type") || ""), "manifest MIME type is JSON-ish");
  const m = await res.json();
  assert(m.lang === "ar" && m.dir === "rtl", "manifest lang=ar dir=rtl");
  assert(m.display === "standalone", "manifest display=standalone");
  assert(m.background_color === "#000000" && m.theme_color === "#000000", "manifest black background/theme");
  assert(m.icons.length === 3, "manifest has 3 icons (192, 512, maskable)");
  const purposes = m.icons.map((i) => i.purpose).join(" ");
  assert(purposes.includes("maskable") && purposes.includes("any"), "maskable + any icon purposes");
  for (const ic of m.icons) {
    const r = await fetch(new URL(ic.src, BASE));
    assert(r.ok, `icon ${ic.src} reachable`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a", `${ic.src} is a PNG`);
    assert(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` === ic.sizes, `${ic.src} size matches manifest`);
  }

  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert(!!block, "sw.js declares a precache list");
  const assets = [...block[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert(assets.length >= 20, `precache list has ${assets.length} entries`);
  for (const a of assets) {
    const r = await fetch(new URL(a, BASE));
    assert(r.ok, `precache target ${a} returns ${r.status}`);
  }
  const indexHtml = await (await fetch(BASE + "index.html")).text();
  assert(indexHtml.includes('lang="ar"') && indexHtml.includes('dir="rtl"'), "index.html is Arabic RTL");
  /* the CSP meta tag contains the word "Security"; scan the rest of the file */
  const indexScan = indexHtml.replace(/<meta[^>]*content-security-policy[^>]*>/gi, "");
  assert(!/security|gouv|maroc|minist/i.test(indexScan), "index.html has no institution name");

  /* security: Content-Security-Policy */
  const cspMeta = indexHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i);
  assert(!!cspMeta, "index.html ships a Content-Security-Policy meta tag");
  const csp = cspMeta ? cspMeta[1] : "";
  assert(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), "CSP: object-src 'none' + base-uri 'none'");
  assert(!/unsafe-inline|unsafe-eval/.test(csp), "CSP contains no unsafe-inline / unsafe-eval anywhere");
  assert(/script-src 'self'/.test(csp) && /style-src 'self'/.test(csp), "CSP: script-src and style-src are 'self' only");
  assert(/img-src[^;]*data:/.test(csp), "CSP allows data: images (photos) and nothing remote");
  assert(!/<script(?![^>]*\bsrc=)/i.test(indexHtml), "index.html has no inline <script> block");
  assert(!/\son[a-z]+\s*=\s*["']/i.test(indexHtml), "index.html has no inline event-handler attribute");
}

async function main() {
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });

  let server = startServer();
  await waitServer(true);
  await staticChecks();

  console.log("\n[browser] launch");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 412, height: 900, isMobile: true, hasTouch: true },
    args: ["--disable-dev-shm-usage", "--window-size=430,930"],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });

  /* 0. first launch => forced PIN setup, with the no-recovery warning */
  console.log("\n[PIN] forced setup on first launch");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !document.getElementById("lock").hidden, { timeout: 10000 });
  assert(true, "lock screen shows on first launch");
  assert(await hasTxt(page, "إنشاء رمز القفل", "#lock"), "screen is in setup mode");
  assert(await hasTxt(page, "لا يوجد استرجاع", "#lock"), "clear no-recovery warning is shown");
  await page.evaluate(() => document.querySelector('#lock [data-k="ok"]').click());
  await assertTxt(page, "أكّد أنك تفهم", "#lock", "cannot skip the acknowledgement");
  await unlock(page);
  assert(await page.evaluate(() => document.getElementById("lock").hidden), "PIN saved, app unlocked");
  await assertTxt(page, "لا يوجد أي موظف بعد", "#app", "empty state on first run");

  /* service worker */
  console.log("\n[offline] service worker install");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 });
  assert(true, "service worker is active and controls the page");

  /* 6. CSV with ";" and Arabic headers */
  console.log("\n[CSV] import sample-fake.csv (semicolon, Arabic headers)");
  await clickText(page, "#nav button", "استيراد CSV");
  await (await page.$("#csv")).uploadFile(SAMPLE);
  await page.waitForFunction(() => /تمت معالجة/.test(document.querySelector("#msg").innerText), { timeout: 8000 });
  await assertTxt(page, "جديد: 10، محدّث: 0", "#msg", "10 rows created");
  await clickText(page, "#nav button", "بحث");
  await assertTxt(page, "10 / 10 موظف", "#app", "10 employees in the list");

  /* re-import => updates on same matricule, no duplicates */
  await clickText(page, "#nav button", "استيراد CSV");
  await (await page.$("#csv")).uploadFile(SAMPLE);
  await page.waitForFunction(() => /جديد: 0، محدّث: 10/.test(document.querySelector("#msg").innerText), { timeout: 8000 });
  assert(true, "second import updates existing matricules");
  await clickText(page, "#nav button", "بحث");
  await assertTxt(page, "10 / 10 موظف", "#app", "still 10 employees (no duplicates)");

  /* extra fake rows for search tests (written outside the repo) */
  const searchCsv = path.join(DL, "search-fake.csv");
  fs.writeFileSync(
    searchCsv,
    "\uFEFFالرقم المهني;الاسم العائلي;الاسم الشخصي;الرتبة\n" +
      "FAKE-1001;العلوي;محمد;متدرّب تجريبي\n" +
      "FAKE-1002;العلوي;سعاد;متدرّبة تجريبية\n" +
      "FAKE-1003;أسد;علي;متدرّب تجريبي\n",
    "utf8"
  );
  await clickText(page, "#nav button", "استيراد CSV");
  await (await page.$("#csv")).uploadFile(searchCsv);
  await page.waitForFunction(() => /جديد: 3/.test(document.querySelector("#msg").innerText), { timeout: 8000 });
  assert(true, "extra fake rows imported");

  /* 2. search: last name, word order, hamza normalization, matricule */
  console.log("\n[search] acceptance test 2");
  await clickText(page, "#nav button", "بحث");
  await search(page, "العلوي");
  await assertTxt(page, "2 / 13 موظف", "#app", "search العلوي returns everyone with that last name");
  await search(page, "العلوي محمد");
  await assertTxt(page, "1 / 13 موظف", "#app", "search by full name in any word order");
  await search(page, "محمد العلوي");
  await assertTxt(page, "1 / 13 موظف", "#app", "…and the other word order too");
  await search(page, "اسد");
  await assertTxt(page, "1 / 13 موظف", "#app", "hamza normalization (أسد found as اسد)");
  await search(page, "FAKE-1001");
  await assertTxt(page, "1 / 13 موظف", "#app", "search by professional number");

  /* dashboard before any absence */
  console.log("\n[dashboard]");
  await clickText(page, "#nav button", "لوحة");
  await assertTxt(page, "13", "#app", "dashboard shows total headcount");
  await assertTxt(page, "لا يوجد أي غائب اليوم", "#app", "nobody absent yet");

  /* 3. 30-day leave from today => status + return date */
  console.log("\n[status] acceptance test 3");
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0001");
  await setVal(page, "#ps", todayStr());
  await setVal(page, "#pd", "30");
  await clickText(page, "#app [data-a='addp']", "إضافة");
  await assertTxt(page, "عطلة إدارية داخل التراب الوطني", "#app", "status shows the leave type");
  await assertTxt(page, "يعود إلى العمل: " + addDays(todayStr(), 30), "#app", "return date = start + 30 days");

  /* past leave => still "يعمل" */
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0002");
  await setVal(page, "#ps", addDays(todayStr(), -10));
  await setVal(page, "#pd", "5");
  await clickText(page, "#app [data-a='addp']", "إضافة");
  await assertTxt(page, "يعمل", "#app", "a finished past leave shows يعمل");

  /* 4. التقاعد: no date, no duration, stays */
  console.log("\n[status] acceptance test 4 — التقاعد");
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0003");
  await page.select("#pt", "t11");
  await sleep(120);
  assert(await page.$eval("#pr", (e) => e.hidden), "choosing التقاعد hides date + duration inputs");
  await clickText(page, "#app [data-a='addp']", "إضافة");
  await assertTxt(page, "التقاعد", "#app", "status shows التقاعد");
  assert(!(await hasTxt(page, "يعود إلى العمل", "#app")), "no return date for التقاعد");
  await page.reload({ waitUntil: "load" });
  await unlock(page);
  await openEmployee(page, "FAKE-0003");
  await assertTxt(page, "التقاعد", "#app", "التقاعد survives a reload (never stored, still computed)");

  /* short leave to exercise "returns due in 7 days" */
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0004");
  await setVal(page, "#ps", todayStr());
  await setVal(page, "#pd", "3");
  await clickText(page, "#app [data-a='addp']", "إضافة");
  await clickText(page, "#nav button", "لوحة");
  await assertTxt(page, "يعودون خلال 7 أيام", "#app", "dashboard: returns due within 7 days section");
  await assertTxt(page, addDays(todayStr(), 3), "#app", "…employee returning in 3 days is listed with the date");
  await assertTxt(page, "الغيابون حسب النوع", "#app", "dashboard: away grouped by type");

  /* period editing */
  console.log("\n[periods] edit a period");
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0001");
  await click(page, "[data-a='editp']", 0);
  await setVal(page, "#pd", "45");
  await clickText(page, "#app [data-a='addp']", "حفظ التعديل");
  await assertTxt(page, "يعود إلى العمل: " + addDays(todayStr(), 45), "#app", "edited duration updates the return date");
  await click(page, "[data-a='rmp']", 0);
  await assertTxt(page, "يعمل", "#app", "deleting the period restores يعمل");

  /* settings: rename leave type + field label (stored on device only) */
  console.log("\n[settings] editable types and labels");
  await clickText(page, "#nav button", "إعدادات");
  await setVal(page, "#nm_t01", "عطلة إدارية (معدلة)");
  await clickText(page, "#app [data-a='savetypes']", "حفظ الأنواع");
  await closeAlert(page);
  await setVal(page, "#lab_joined", "تاريخ الالتحاق (مخصص)");
  await clickText(page, "#app [data-a='savelabels']", "حفظ التسميات");
  await closeAlert(page);
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0001");
  await assertTxt(page, "تاريخ الالتحاق (مخصص)", "#app", "renamed field label appears in the detail view");

  /* photo */
  console.log("\n[photo] add a photo, keep it in export/restore");
  await clickText(page, "#app [data-a='edit']", "تعديل");
  await (await page.$("#f_img")).uploadFile(PHOTO);
  await clickText(page, "#app [data-a='save']", "حفظ");
  await page.waitForFunction(() => !!document.querySelector("#app img.ph"), { timeout: 5000 });
  assert(true, "photo shown on the detail card");

  /* font-size toggle */
  console.log("\n[ui] font-size toggle");
  await click(page, "#fontbtn", 0);
  assert(
    (await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)) === "18px",
    "font-size toggle enlarges the text"
  );

  /* CSP hygiene: rendered views must never contain inline styles or handlers */
  console.log("\n[security] rendered markup: no inline styles, no inline handlers");
  for (const tab of ["لوحة", "إعدادات", "استيراد CSV", "بحث"]) {
    await clickText(page, "#nav button", tab);
    const h = await page.evaluate(() => ({
      styles: document.querySelectorAll("#app [style]").length,
      handlers: [...document.querySelectorAll("#app *")].filter((el) =>
        [...el.attributes].some((a) => /^on/i.test(a.name))
      ).length,
    }));
    assert(h.styles === 0, `${tab}: no inline style attributes (CSP style-src 'self')`);
    assert(h.handlers === 0, `${tab}: no inline event-handler attributes`);
  }

  /* 5. export -> wipe -> restore */
  console.log("\n[backup] acceptance test 5");
  await clickText(page, "#nav button", "إعدادات");
  await clickText(page, "#app [data-a='export']", "تنزيل نسخة");
  const bak = await waitForFile(/^backup-\d{4}-\d{2}-\d{2}\.json$/);
  const bakObj = JSON.parse(fs.readFileSync(bak, "utf8"));
  assert(bakObj.kind === "emp-backup", "backup file has the right format");
  assert(bakObj.employees.length === 13, "backup contains all 13 employees");
  assert(
    bakObj.employees.some((e) => String(e.photo || "").startsWith("data:image/jpeg")),
    "backup contains the photo"
  );
  await closeAlert(page);

  await clickText(page, "#app [data-a='wipe']", "مسح");
  await clickText(page, "#app [data-a='wipe']", "تأكيد");
  await clickText(page, ".modal button", "مسح نهائي");
  await sleep(300);
  await clickText(page, "#nav button", "بحث");
  await assertTxt(page, "لا يوجد أي موظف بعد", "#app", "data wiped");
  await assertTxt(page, "0 / 0 موظف", "#app", "list is empty after wipe");

  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(bak);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  try {
    await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), {
      timeout: 8000,
    });
  } catch (e) {
    const state = await page.evaluate(() => ({
      app: document.getElementById("app").innerText.slice(0, 300),
      modals: [...document.querySelectorAll(".modal")].map((m) => m.innerText.slice(0, 300)),
    }));
    console.log("DEBUG after restore:", JSON.stringify(state, null, 2));
    throw e;
  }
  assert(true, "restore brings all 13 employees back");
  await openEmployee(page, "FAKE-0001");
  await page.waitForSelector("#app img.ph", { timeout: 5000 });
  assert(true, "photo came back after restore");

  /* security regression: the crafted backup from the audit must be neutralized */
  console.log("\n[security] crafted backup (XSS payload in photo/name) is neutralized");
  const legitBak = JSON.parse(fs.readFileSync(bak, "utf8"));
  const evilBak = {
    ...legitBak,
    employees: legitBak.employees.concat([
      {
        id: "evil1",
        mat: "EVIL-1",
        nom: '<img src=x onerror="window.__xss=1">',
        prenom: 'اختبار"><script>window.__xss=1</script>',
        grade: 'ت"; alert(1); "',
        addr: '"; window.__xss=1; "',
        periods: [],
        photo: 'x" onerror="window.__xss=1',
      },
    ]),
  };
  const evilPath = path.join(DL, "evil-backup.json");
  fs.writeFileSync(evilPath, JSON.stringify(evilBak), "utf8");
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(evilPath);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  /* M4: the dropped photo is reported, not silently ignored */
  await page.waitForFunction(() => document.body.innerText.includes("الصور المحذوفة: 1"), { timeout: 8000 });
  assert(true, "the invalid photo drop is reported to the user");
  await clickText(page, ".modal button", "حسنًا");
  await sleep(300);
  const hygiene = await page.evaluate(() => ({
    fired: !!window.__xss,
    onerrorImgs: document.querySelectorAll("[onerror]").length,
    scripts: document.querySelectorAll("#app script").length,
    handlerAttrs: [...document.querySelectorAll("#app *")].filter((el) =>
      [...el.attributes].some((a) => /^on/i.test(a.name))
    ).length,
  }));
  assert(!hygiene.fired, "no XSS payload executed on restore or render");
  assert(hygiene.onerrorImgs === 0, "the crafted photo never lands as an <img onerror> element");
  assert(hygiene.scripts === 0, "no <script> element injected");
  assert(hygiene.handlerAttrs === 0, "no inline handler attribute anywhere in the app");
  await openEmployee(page, "EVIL-1");
  assert(await hasTxt(page, "onerror"), "the hostile name is displayed as plain text, not markup");
  assert(
    (await page.evaluate(() => document.querySelectorAll("#app img.ph").length)) === 0,
    "the invalid photo was dropped and replaced by the placeholder"
  );
  await page.evaluate(() => delete window.__xss);

  /* back to the legitimate data set */
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(bak);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert(true, "legitimate backup restored again after the attack test");
  await openEmployee(page, "FAKE-0001");
  await page.waitForSelector("#app img.ph", { timeout: 5000 });
  assert(true, "photo still intact after the attack test");

  /* ---------------- M4: strict schema validation on restore ---------------- */
  console.log("\n[security] restore validates the schema (reject / clean / report)");

  /* (a) a backup where nothing is valid must NOT wipe the current data */
  const junkBak = { ...legitBak, employees: ["junk", 42, null, { periods: "x" }] };
  const junkPath = path.join(DL, "junk-backup.json");
  fs.writeFileSync(junkPath, JSON.stringify(junkBak), "utf8");
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(junkPath);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await page.waitForFunction(() => document.body.innerText.includes("لا يوجد أي سجل صالح"), { timeout: 8000 });
  assert(true, "an all-invalid backup is refused instead of wiping the data");
  assert(await hasTxt(page, "لم يتغيّر شيء", "body"), "the refusal says nothing was changed");
  await clickText(page, ".modal button", "حسنًا");
  await clickText(page, "#nav button", "بحث");
  await search(page, ""); // V.q still holds the previous query; clear it for the count
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert(true, "data untouched after the refused restore");

  /* (b) mixed backup: some records rejected, some fields/periods cleaned, all reported */
  const mDate = todayStr();
  const mixedBak = {
    ...legitBak,
    employees: legitBak.employees.concat([
      { id: "bad1", periods: "nope", nom: "مرفوض" }, // rejected: periods not an array
      "just a string", // rejected: not an object
      { nom: "بلا معرّف", periods: [] }, // rejected: missing id
      {
        id: "ok1",
        mat: "CLEAN-1",
        nom: 12345, // cleaned: number -> string
        prenom: true, // cleaned: boolean -> string
        periods: [
          { pid: "p1", tid: "t01", type: "عطلة", start: "not-a-date", days: 5, nd: false }, // dropped
          { pid: "p2", tid: "t01", type: "عطلة", start: mDate, days: 5, nd: false }, // kept
          "junk", // dropped
        ],
      },
      { id: "ok2", mat: "X".repeat(500), nom: "طويل جدًا", periods: [] }, // cleaned: mat capped at 64
      { id: legitBak.employees[0].id, mat: "DUP", nom: "مكرر", periods: [] }, // rejected: duplicate id
    ]),
  };
  const mixedPath = path.join(DL, "mixed-backup.json");
  fs.writeFileSync(mixedPath, JSON.stringify(mixedBak), "utf8");
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(mixedPath);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  assert(await hasTxt(page, "رُفضت 4 سجلات", "body"), "the confirm dialog warns about rejected records");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => document.body.innerText.includes("السجلات المتجاهلة: 4"), { timeout: 8000 });
  assert(true, "report lists the rejected record count");
  assert(await hasTxt(page, "قائمة الأرصدة غير صالحة", "body"), "report gives the rejection reason");
  assert(await hasTxt(page, "السجل 14", "body"), "report identifies the offending record");
  assert(await hasTxt(page, "الأرصدة المتجاهلة: 2", "body"), "report lists the dropped periods");
  assert(await hasTxt(page, "الحقول المنظَّفة: 3", "body"), "report lists the cleaned fields");
  await clickText(page, ".modal button", "حسنًا");
  await page.waitForFunction(() => /15 \/ 15 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert(true, "15 valid employees kept (13 + 2 cleaned)");

  await clickText(page, "#nav button", "لوحة");
  assert(await hasTxt(page, "لوحة الوضعية"), "dashboard renders after a hostile restore");
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "CLEAN-1");
  assert(await hasTxt(page, "من " + mDate), "only the valid period survived validation");
  await clickText(page, "#nav button", "بحث");
  const homeTxt = await page.evaluate(() => document.getElementById("app").innerText);
  assert(!/X{65}/.test(homeTxt), "over-long field was capped to the schema limit");

  /* (c) a clean backup reports nothing and restores silently */
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(bak);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert((await page.$(".modal")) === null, "a clean restore raises no report dialog");

  /* ---------------- M4: CSV cells are cleaned and reported ---------------- */
  console.log("\n[security] CSV import cleans hostile cells");
  const csvDirty =
    "\uFEFF" +
    ["الرقم المهني;الاسم العائلي;الاسم الشخصي;العنوان", `CSV-1;${"ن".repeat(300)};اختبار\u0007عنوان;شارع الاختبار`].join(
      "\r\n"
    );
  const csvPath = path.join(DL, "dirty.csv");
  fs.writeFileSync(csvPath, csvDirty, "utf8");
  await clickText(page, "#nav button", "استيراد CSV");
  await (await page.$("#csv")).uploadFile(csvPath);
  await page.waitForFunction(() => document.getElementById("msg").innerText.includes("تمت معالجة 1"), {
    timeout: 8000,
  });
  assert(await hasTxt(page, "تم تنظيف 1"), "the CSV report shows the cleaned row");
  await clickText(page, ".modal button", "حسنًا");
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "CSV-1");
  const hdr = await page.evaluate(() => (document.querySelector("#app h2") || { textContent: "" }).textContent);
  const hdrLen = hdr.length;
  assert(hdrLen >= 100 && hdrLen <= 115, `the 300-char name was capped (header shows ${hdrLen} chars)`);
  assert(!/[\u0000-\u001F\u007F]/.test(hdr), "control characters were stripped from the imported values");

  /* back to the legitimate data set for the offline test */
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(bak);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert(true, "13/13 restored before the offline test");

  /* ---------------- M5: save failures are visible, DB failure blocks -------- */
  console.log("\n[storage] save failures surface an Arabic error; DB failure blocks");

  /* (a) a failing save must show a visible Arabic error, never a fake success */
  await clickText(page, "#nav button", "إعدادات");
  await page.evaluate(() => {
    window.__origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    };
  });
  await clickText(page, "#app [data-a='savelabels']", "حفظ التسميات");
  await page.waitForFunction(() => document.body.innerText.includes("المساحة ممتلئة"), { timeout: 8000 });
  assert(true, "a failed save shows a visible Arabic error");
  assert(
    !(await page.evaluate(() => document.body.innerText.includes("تم حفظ التسميات"))),
    "no fake success message after a failed save"
  );
  await clickText(page, ".modal button", "حسنًا");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__origPut;
  });
  assert(await hasTxt(page, "الإعدادات"), "the settings screen survived the failed save");

  /* (b) if IndexedDB cannot open: blocking screen, never a misleading empty app */
  await page.evaluate(() => localStorage.setItem("failIDB", "1"));
  await page.evaluateOnNewDocument(() => {
    try {
      if (localStorage.getItem("failIDB") === "1" && window.indexedDB) {
        indexedDB.open = function () {
          const req = { error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
          setTimeout(() => {
            req.error = new Error("blocked");
            if (req.onerror) req.onerror({ target: req });
          }, 0);
          return req;
        };
      }
    } catch (e) {
      /* ignore */
    }
  });
  await page.reload({ waitUntil: "load", timeout: 15000 });
  await page.waitForFunction(() => document.getElementById("app").innerText.includes("تعذّر فتح قاعدة البيانات"), {
    timeout: 10000,
  });
  assert(true, "a blocking error screen replaces the empty app");
  assert(
    (await page.evaluate(() => document.getElementById("nav").style.display)) === "none",
    "navigation is hidden on the blocking screen"
  );
  assert(
    !(await page.evaluate(() => document.getElementById("app").innerText.includes("لا يوجد أي موظف"))),
    "no misleading empty state is shown"
  );
  assert(!!(await page.$("#retrybtn")), "a retry button is offered");

  /* recover */
  await page.evaluate(() => localStorage.removeItem("failIDB"));
  await page.reload({ waitUntil: "load", timeout: 15000 });
  await unlock(page);
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), {
    timeout: 10000,
  });
  assert(true, "the app boots normally after the database recovers");

  /* ---------------- M3: types in use cannot be deleted ---------------- */
  console.log("\n[types] deleting a type in use offers archive instead");

  /* (a) t01 is used by FAKE-0002 and FAKE-0004 periods */
  await clickText(page, "#nav button", "إعدادات");
  await clickText(page, "#app [data-a='delty'][data-t='t01']", "حذف");
  await page.waitForFunction(() => document.body.innerText.includes("النوع في الاستعمال"), { timeout: 8000 });
  assert(true, "deleting a type in use is refused with an explanation");
  assert(await hasTxt(page, "الأرشفة", "body"), "an archive is offered instead of deletion");
  await clickText(page, ".modal button", "أرشفة");
  await page.waitForFunction(() => document.getElementById("app").innerText.includes("مؤرشف"), { timeout: 8000 });
  assert(true, "the type card is marked as archived");
  assert(!!(await page.$("#app [data-a='unarch'][data-t='t01']")), "an unarchive button appears");

  /* (b) archived: hidden for new entries, kept on old periods */
  await clickText(page, "#nav button", "بحث");
  await openEmployee(page, "FAKE-0004");
  assert(await hasTxt(page, "عطلة إدارية (معدلة)"), "old periods still show the archived type name");
  const opts = await page.$eval("#pt", (s) => [...s.options].map((o) => o.value));
  assert(!opts.includes("t01"), "archived type is hidden from the new-entry select");
  assert(opts.includes("t11"), "other types stay selectable");
  await click(page, "[data-a='editp']", 0);
  await sleep(150);
  assert(
    (await page.$eval("#pt", (s) => s.value)) === "t01",
    "editing the old period keeps its archived type selected"
  );

  /* (c) unarchive brings it back */
  await clickText(page, "#nav button", "إعدادات");
  await clickText(page, "#app [data-a='unarch'][data-t='t01']", "إلغاء الأرشفة");
  assert(!(await hasTxt(page, "مؤرشف")), "the type comes back from the archive");

  /* ---------------- M3: dashboard falls back to the stored name ---------- */
  console.log("\n[dashboard] orphan type falls back to the stored name");
  const orphanBak = {
    ...legitBak,
    employees: legitBak.employees.concat([
      {
        id: "orph1",
        mat: "ORPH-1",
        nom: "غائب",
        prenom: "بلا",
        periods: [{ pid: "po", tid: "zzz99", type: "مخصوصة غير موجودة", start: todayStr(), days: 5, nd: false }],
      },
    ]),
  };
  const orphanPath = path.join(DL, "orphan-backup.json");
  fs.writeFileSync(orphanPath, JSON.stringify(orphanBak), "utf8");
  await (await page.$("#rfile")).uploadFile(orphanPath);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => /14 \/ 14 موظف/.test(document.getElementById("app").innerText), { timeout: 8000 });
  assert(true, "orphan-period backup restored (14/14)");
  await clickText(page, "#nav button", "لوحة");
  assert(await hasTxt(page, "مخصوصة غير موجودة — 1"), "dashboard falls back to the stored type name");
  assert(
    !(await page.evaluate(() => document.getElementById("app").innerText.includes("الجميع يعمل"))),
    "never claims everyone is working while someone is absent"
  );
  assert(await hasTxt(page, "ORPH-1"), "the absent employee is listed under the orphan group");

  /* back to the legitimate data set for the offline test */
  await clickText(page, "#nav button", "إعدادات");
  await (await page.$("#rfile")).uploadFile(bak);
  await clickText(page, "#app [data-a='restore']", "استرجاع");
  await clickText(page, ".modal button", "استبدال واسترجاع");
  await page.waitForFunction(() => /13 \/ 13 موظف/.test(document.getElementById("app").innerText), {
    timeout: 8000,
  });
  assert(true, "13/13 restored before the offline test (final)");

  /* ---------------- M2: backgrounding locks immediately ---------------- */
  console.log("\n[lock] hiding the page locks immediately (M2)");

  /* (a) visibilitychange -> hidden */
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    () => {
      const l = document.getElementById("lock");
      return l && !l.hidden;
    },
    { timeout: 3000 }
  );
  assert(true, "hiding the page locks the app immediately");
  assert(
    await page.evaluate(() => document.getElementById("app").hidden === true),
    "the app content sits behind the lock"
  );
  assert(
    await page.evaluate(() => document.body.style.visibility === "hidden"),
    "content is hidden from the app-switcher snapshot"
  );

  /* coming back to the foreground */
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(await page.evaluate(() => document.body.style.visibility === ""), "visibility restored when returning");
  await unlock(page);

  /* (b) pagehide / pageshow */
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForFunction(() => !document.getElementById("lock").hidden, { timeout: 3000 });
  assert(true, "pagehide locks too");
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  assert(await page.evaluate(() => document.body.style.visibility === ""), "pageshow restores visibility");
  await unlock(page);
  assert(await hasTxt(page, "موظف", "#app"), "the app is usable after relocking");

  /* ---------------- M1: History API navigation ---------------- */
  console.log("\n[navigation] Back navigates screens and closes modals (M1)");
  await page.evaluate(() => {
    window.__navMarker = 1;
  });

  /* (a) home -> detail -> Back => home, same document (no app exit) */
  await openEmployee(page, "FAKE-0001");
  assert(await page.evaluate(() => !!document.querySelector("#app [data-a='addp']")), "detail screen open");
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !!document.querySelector("#app #q"), { timeout: 5000 });
  assert(true, "Back from detail returns to the home screen");
  assert(await page.evaluate(() => window.__navMarker === 1), "the document was not reloaded or exited");

  /* (b) home -> settings -> Back => home */
  await clickText(page, "#nav button", "إعدادات");
  assert(await page.evaluate(() => !!document.querySelector("#app #lab_mat")), "settings screen open");
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !!document.querySelector("#app #q"), { timeout: 5000 });
  assert(true, "Back from settings returns home");

  /* (c) Back while a confirmation is open closes it and stays put */
  await clickText(page, "#nav button", "إعدادات");
  await clickText(page, "#app [data-a='wipe']", "مسح");
  await clickText(page, "#app [data-a='wipe']", "تأكيد");
  await page.waitForFunction(() => !!document.querySelector(".modal"), { timeout: 5000 });
  assert(true, "the wipe confirmation opens");
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 5000 });
  assert(true, "Back closes the modal first");
  assert(
    await page.evaluate(() => !!document.querySelector("#app #lab_mat")),
    "and the screen behind the modal is unchanged"
  );

  /* (d) Escape closes a modal */
  await clickText(page, "#app [data-a='wipe']", "تأكيد");
  await page.waitForFunction(() => !!document.querySelector(".modal"), { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 5000 });
  assert(true, "Escape closes the modal");
  assert(
    await page.evaluate(() => !!document.querySelector("#app #lab_mat")),
    "Escape leaves the screen in place"
  );
  assert(await page.evaluate(() => window.__navMarker === 1), "still the same document after all Back steps");

  /* 1. airplane mode: kill the server and reload */
  console.log("\n[offline] acceptance test 1 — server killed (airplane mode)");
  server.kill();
  await waitServer(false);
  await page.reload({ waitUntil: "load", timeout: 15000 });
  await unlock(page);
  await clickText(page, "#nav button", "بحث");
  await assertTxt(page, "13 / 13 موظف", "#app", "app works with no server running");
  await clickText(page, "#nav button", "لوحة");
  await assertTxt(page, "الغيابون حسب النوع", "#app", "dashboard works offline too");
  await clickText(page, "#nav button", "استيراد CSV");
  await assertTxt(page, "استيراد CSV", "#app", "import screen renders offline");
  server = startServer();
  await waitServer(true);
  assert(true, "server restarted");

  /* auto-lock after 2 minutes of inactivity (spec) */
  console.log("\n[idle] auto-lock (waits ~2 minutes)");
  await clickText(page, "#nav button", "بحث");
  // reset the inactivity timer deterministically, then idle for 2 minutes
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById("lock").hidden, { timeout: 150000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  assert(secs >= 115 && secs <= 140, `app auto-locks after ~2 minutes of inactivity (${secs}s)`);
  await unlock(page);
  assert(await page.evaluate(() => document.getElementById("lock").hidden), "PIN unlocks the app again");

  /* no JS errors during the whole run */
  console.log("\n[errors]");
  assert(pageErrors.length === 0, "no uncaught page errors" + (pageErrors.length ? " — " + pageErrors.join(" | ") : ""));
  const bad = consoleErrors.filter((e) => !/favicon/i.test(e));
  assert(bad.length === 0, "no console errors" + (bad.length ? " — " + bad.join(" | ") : ""));

  await browser.close();
  server.kill();

  console.log(`\nALL PASSED (${passed} assertions)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\n" + (err && err.stack ? err.stack : err));
    process.exit(1);
  }
);
