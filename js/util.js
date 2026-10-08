/* Small shared helpers (no DOM data, no personal data). */

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Arabic normalization used by search + CSV header matching. */
export const nz = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0640\u0300-\u036f]/g, "")
    .replace(/[أإآٱ]/g, "ا") // hamza forms -> ا
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .trim();

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** الصور مقبولة فقط كـ data URL صالح (jpeg/png/webp) وبمقاس معقول.
 *  أي محتوى آخر (payload معدّل أو ملف غير صورة) يُرفض ولا يُعرض أبدًا. */
const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const safePhoto = (v) =>
  typeof v === "string" && v.length <= 600000 && PHOTO_RE.test(v) ? v : "";

export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/** تاريخ صالح بصيغة YYYY-MM-DD (يرفض 2026-02-31 وما لا يليق بالقالب). */
export const validDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** إضافة أيام — يعيد "" بدل الانهيار على تاريخ تالف (لا شاشة تنهار أبدًا). */
export const add = (s, n) => {
  if (!validDate(s)) return "";
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const endOf = (p) => (p && p.days > 0 && validDate(p.start) ? add(p.start, p.days - 1) : null);

/** سنوات وأشهر منذ تاريخ الولوج (seniority / الأقدمية) — "" عند تاريخ غير صالح. */
export const tenure = (s) => {
  if (!validDate(s)) return "";
  const a = new Date(s),
    b = new Date();
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) m--;
  return m < 0 ? "—" : Math.floor(m / 12) + " سنة و " + (m % 12) + " شهر";
};

/** تنزيل ملف عبر Blob (بدون أي خادم). */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const bytesToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* ------------------------------------------------------------- modals ------
 * Every modal pushes a history entry, so the browser Back closes the modal
 * first and only then moves between screens; Escape does the same (M1). */
let backPending = false; // our history.back() for a modal close has not landed yet
let afterBackQ = [];

/** Run fn now, or right after a pending modal back() has landed. */
export function afterBack(fn) {
  if (backPending) afterBackQ.push(fn);
  else fn();
}

/** app.js popstate calls this first: true when the pop only settles our own
 *  modal back(); runs anything queued behind it. */
export function settleBack() {
  if (!backPending) return false;
  backPending = false;
  const q = afterBackQ;
  afterBackQ = [];
  q.forEach((f) => f());
  return true;
}

const pushModalEntry = () =>
  afterBack(() => {
    try {
      history.pushState({ ...(history.state || {}), modal: 1 }, "");
    } catch (e) {
      /* file:// or quota — the modal still works, Back just won't close it */
    }
  });

const releaseModalEntry = () => {
  if (!(history.state && history.state.modal)) return;
  backPending = true;
  history.back();
};

/** Close the topmost modal (and its history entry).
 *  fromHistory = the browser Back already moved past that entry. */
export function closeModal(fromHistory) {
  const m = [...document.querySelectorAll(".modal")].pop();
  if (!m) return false;
  m.remove();
  if (typeof m.__onClose === "function") m.__onClose();
  if (!fromHistory) releaseModalEntry();
  return true;
}

export function confirmBox({ title, body, ok = "تأكيد", cancel = "إلغاء", danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box"><h2>${esc(title)}</h2><div>${body || ""}</div>
      <div class="btns"><button type="button" data-x="0">${esc(cancel)}</button>
      <button type="button" data-x="1" class="${danger ? "bad" : ""}">${esc(ok)}</button></div></div>`;
    m.__onClose = () => resolve(false); // closed by Back / Escape: treat as cancel
    m.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-x]");
      if (!b) return;
      m.remove();
      releaseModalEntry();
      resolve(b.dataset.x === "1");
    });
    document.body.appendChild(m);
    pushModalEntry();
    m.querySelector("[data-x='1']").focus();
  });
}

export function alertBox(html) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box">${html}<div class="btns"><button type="button">حسنًا</button></div></div>`;
    m.__onClose = () => resolve();
    m.addEventListener("click", (e) => {
      if (e.target.closest("button")) {
        m.remove();
        releaseModalEntry();
        resolve();
      }
    });
    document.body.appendChild(m);
    pushModalEntry();
    m.querySelector("button").focus();
  });
}
