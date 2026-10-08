/* Home = search (behaviour kept from prototype.html). */

import { esc, $, safePhoto } from "../util.js";
import { find } from "../search.js";
import { badge } from "../status.js";

/** الصورة تُعرض فقط إذا كانت data URL صالحًا، وكل قيمة أخرى تمر عبر esc(). */
export const ph = (e) => {
  const src = safePhoto(e && e.photo);
  return src ? `<img class="ph" src="${esc(src)}" alt="">` : `<div class="ph" aria-hidden="true">👤</div>`;
};

export const card = (e, types) =>
  `<div class="card" data-id="${esc(e.id)}">${ph(e)}<div><b>${esc(e.prenom)} ${esc(e.nom)}</b><br>${esc(
    e.mat
  )} ${esc(e.grade)} ${badge(e, types)}</div></div>`;

export function html(A) {
  const r = find(A.D, A.V.q);
  const body =
    A.D.length === 0
      ? `<p>لا يوجد أي موظف بعد.</p>
         <p><small>ابدأ باستيراد ملف CSV (جرّب <code>sample-fake.csv</code> المرفق) أو بزر «+ موظف».</small></p>`
      : r.length
      ? r.map((e) => card(e, A.S.types)).join("")
      : `<p>لا نتيجة لـ «${esc(A.V.q)}».</p>`;
  return `<div class="row">
      <input id="q" value="${esc(A.V.q)}" placeholder="الرقم المهني / الاسم / اللقب" enterkeyhint="search" type="search">
      <button data-a="go" type="button">بحث</button>
    </div>
    <p>${r.length} / ${A.D.length} موظف</p>${body}`;
}

export function mount(A) {
  $("#app").onclick = (ev) => {
    const cardEl = ev.target.closest(".card[data-id]");
    if (cardEl) return A.go("d", cardEl.dataset.id);
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    if (b.dataset.a === "go") {
      A.V.q = $("#q").value;
      A.render();
      const q = $("#q");
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
    } else if (b.dataset.a === "imp") A.go("imp");
  };
  document.onkeydown = (ev) => {
    if (ev.key === "Enter" && ev.target.id === "q") {
      A.V.q = ev.target.value;
      A.render();
      const q = $("#q");
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
    }
  };
}
