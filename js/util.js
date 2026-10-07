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

export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export const add = (s, n) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const endOf = (p) => (p.days > 0 ? add(p.start, p.days - 1) : null);

/** سنوات وأشهر منذ تاريخ الولوج (seniority / الأقدمية). */
export const tenure = (s) => {
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

export function confirmBox({ title, body, ok = "تأكيد", cancel = "إلغاء", danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box"><h2>${esc(title)}</h2><div>${body || ""}</div>
      <div class="btns"><button type="button" data-x="0">${esc(cancel)}</button>
      <button type="button" data-x="1" class="${danger ? "bad" : ""}">${esc(ok)}</button></div></div>`;
    m.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-x]");
      if (!b) return;
      m.remove();
      resolve(b.dataset.x === "1");
    });
    document.body.appendChild(m);
    m.querySelector("[data-x='1']").focus();
  });
}

export function alertBox(html) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box">${html}<div class="btns"><button type="button">حسنًا</button></div></div>`;
    m.addEventListener("click", (e) => {
      if (e.target.closest("button")) {
        m.remove();
        resolve();
      }
    });
    document.body.appendChild(m);
    m.querySelector("button").focus();
  });
}
