/* Add / edit employee (with photo, resized to 240px). */

import { $, esc } from "../util.js";
import { FIELDS, FAM_LABEL, FAM_OPTIONS } from "../config.js";
import { readPhoto } from "../photo.js";
import { ph } from "./home.js";

export function html(A) {
  const e = A.V.id ? A.D.find((x) => x.id == A.V.id) : null;
  const L = (k) => A.S.labels[k] || (FIELDS.find((f) => f[0] === k) || [, k])[1];
  const f = (k, l, t = "text") => `<label>${esc(l)}</label><input id="f_${k}" type="${t}" value="${esc(
    e ? e[k] : ""
  )}">`;
  return `<h2>${e ? "تعديل" : "إضافة"} موظف</h2>
    ${e && e.photo ? `<div class="card">${ph(e)}<div><small>الصورة الحالية</small></div></div>` : ""}
    ${FIELDS.map((x) => f(x[0], L(x[0]), x[2])).join("")}
    <label>${esc(A.S.labels.fam || FAM_LABEL)}</label>
    <select id="f_fam">${FAM_OPTIONS.map(
      (x) => `<option${x == (e ? e.fam : "") ? " selected" : ""}>${esc(x)}</option>`
    ).join("")}</select>
    <label>الصورة (تُصغَّر تلقائيًا إلى 240px)</label>
    <input id="f_img" type="file" accept="image/*">
    <p id="err" class="bad" role="alert"></p>
    <button data-a="save" data-id="${esc(e ? e.id : "")}" type="button">حفظ</button>
    <button data-a="home" type="button">إلغاء</button>`;
}

export function mount(A) {
  $("#app").onclick = async (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    if (b.dataset.a === "home") return A.go("home");
    if (b.dataset.a !== "save") return;

    const g = (k) => ($("#f_" + k).value || "").trim();
    const o = { fam: $("#f_fam").value };
    for (const x of FIELDS) o[x[0]] = g(x[0]);
    if (!o.mat || !o.nom) {
      $("#err").textContent = "الرقم المهني والاسم العائلي إجباريان";
      return;
    }
    let x = A.D.find((z) => z.id == b.dataset.id);
    if (A.D.some((z) => z.mat == o.mat && z.id != (x && x.id))) {
      $("#err").textContent = "هذا الرقم المهني موجود من قبل";
      return;
    }
    const file = $("#f_img").files[0];
    if (file) b.disabled = true;
    const photo = await readPhoto(file);
    if (x) Object.assign(x, o);
    else {
      x = { id: uidNew(), periods: [], ...o };
      A.D.push(x);
    }
    if (photo) x.photo = photo;
    await A.save();
    A.go("d", x.id);
  };
}

const uidNew = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
