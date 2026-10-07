/* App bootstrap: state, routing, navigation, service worker + update flow,
 * PIN lock wiring, backup reminder. */

import { $ } from "./util.js";
import { loadAll, saveData, saveSettings, requestPersist } from "./db.js";
import { showLock, setUnlockCb, setRecGetter, bump, isLocked } from "./pin.js";
import { backupDue } from "./backup.js";
import * as home from "./views/home.js";
import * as dashboard from "./views/dashboard.js";
import * as detail from "./views/detail.js";
import * as form from "./views/form.js";
import * as importer from "./views/import.js";
import * as settings from "./views/settings.js";

const views = { home, dash: dashboard, d: detail, form, imp: importer, set: settings };
const FONTS = [16, 18, 20];

let D = [];
let S = null;
let waitingWorker = null;
let updateAccepted = false;

const V = { v: "home", q: "", id: null, editPid: null };

const A = {
  get D() {
    return D;
  },
  set D(x) {
    D = x;
  },
  get S() {
    return S;
  },
  set S(x) {
    S = x;
  },
  V,
  render,
  go,
  save: () => saveData(D),
  saveS: () => saveSettings(S),
  replaceData: async (arr) => {
    D = arr;
    V.q = "";
    V.id = null;
    V.editPid = null;
    await saveData(D);
  },
  applyFont,
  banner: () => updateBanner(),
};

function applyFont() {
  document.documentElement.style.fontSize = FONTS[(S && S.font) || 0] + "px";
  const fb = document.getElementById("fontbtn");
  if (fb) fb.textContent = ["أ+", "أ++", "أ+++"][(S && S.font) || 0];
}

function go(v, id) {
  V.v = v;
  if (id !== undefined) V.id = id;
  V.editPid = null;
  render();
  window.scrollTo(0, 0);
}

function markNav() {
  for (const b of document.querySelectorAll("#nav button[data-a]")) {
    const on =
      (b.dataset.a === "home" && V.v === "home") ||
      (b.dataset.a === "dash" && V.v === "dash") ||
      (b.dataset.a === "imp" && V.v === "imp") ||
      (b.dataset.a === "set" && V.v === "set");
    b.style.background = on ? "var(--fg)" : "";
    b.style.color = on ? "#000" : "";
  }
}

function render() {
  if (isLocked()) return;
  const view = views[V.v] || home;
  $("#app").innerHTML = view.html(A);
  if (view.mount) view.mount(A);
  markNav();
}

/* ------------------------------------------------------------- banner ----- */

function updateBanner() {
  const el = $("#banner");
  const parts = [];
  if (waitingWorker)
    parts.push(`<span>يتوفر إصدار جديد من التطبيق.</span><button type="button" data-b="upd">تحديث الآن</button>`);
  if (backupDue(S))
    parts.push(
      `<span>تنبيه: لم يتم إنشاء نسخة احتياطية منذ 30 يومًا. أنشئ واحدة من الإعدادات.</span><button type="button" data-b="set">إعدادات</button>`
    );
  el.innerHTML = parts.join(" ");
  el.hidden = parts.length === 0;
}

$("#banner").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-b]");
  if (!b) return;
  if (b.dataset.b === "upd" && waitingWorker) {
    updateAccepted = true; // reload only when the user explicitly asked for the update
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } else if (b.dataset.b === "set") go("set");
});

/* ---------------------------------------------------- service worker ------ */

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const check = () => {
        const w = reg.waiting;
        if (w && navigator.serviceWorker.controller) {
          waitingWorker = w;
          updateBanner();
        }
      };      check();
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = w;
            updateBanner();
          }
        });
      });
    })
    .catch(() => {});

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The very first install claims the page (no reload needed); only a
    // user-approved update reloads.
    if (!updateAccepted || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

/* ---------------------------------------------------------- navigation ---- */

$("#nav").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-a]");
  if (!b) return;
  const a = b.dataset.a;
  if (a === "home") go("home");
  else if (a === "dash") go("dash");
  else if (a === "imp") go("imp");
  else if (a === "set") go("set");
  else if (a === "add") go("form", null);
  else if (a === "font") {
    S.font = ((S.font || 0) + 1) % FONTS.length;
    applyFont();
    b.title = "حجم الخط";
    b.textContent = ["أ+", "أ++", "أ+++"][S.font];
    saveSettings(S);
  }
});

/* ----------------------------------------------------------------- boot --- */

(async function boot() {
  const r = await loadAll();
  D = r.D || [];
  S = r.S;
  applyFont();
  requestPersist();
  registerSW();

  setRecGetter(() => S && S.pin);
  setUnlockCb(async (rec) => {
    if (rec) {
      S.pin = rec;
      await saveSettings(S);
    }
    render();
    updateBanner();
  });

  const startApp = () => {
    if (!S.pin) showLock("setup");
    else showLock("lock", S.pin);
  };
  startApp();

  const act = () => bump();
  ["pointerdown", "keydown", "touchstart"].forEach((t) => window.addEventListener(t, act, { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) bump();
  });
})();
