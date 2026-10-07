/* Dashboard: counts per status, employees currently away grouped by type with
 * their return dates, and returns due within the next 7 days. */

import { $, esc, today, add } from "../util.js";
import { WORKING } from "../config.js";
import { currentPeriod, returnDate, typeName, isBad } from "../status.js";

export function html(A) {
  const types = A.S.types;
  const t = today();
  const rows = A.D.map((e) => ({ e, p: currentPeriod(e, t) }));
  const away = rows.filter((x) => x.p);
  const working = rows.length - away.length;

  /* counts per status */
  const counts = new Map();
  counts.set("__work", working);
  for (const { p } of away) counts.set(p.tid || p.type, (counts.get(p.tid || p.type) || 0) + 1);
  const stats = [`<div><b>${A.D.length}</b>العدد الإجمالي</div>`, `<div class="ok"><b>${working}</b>${WORKING}</div>`];
  for (const ty of types) {
    const n = counts.get(ty.tid) || 0;
    if (n) stats.push(`<div class="${ty.bad ? "bad" : "warn"}"><b>${n}</b>${esc(ty.name)}</div>`);
  }

  /* away grouped by type */
  let groups = "";
  for (const ty of types) {
    const list = away.filter((x) => (x.p.tid || x.p.type) === ty.tid).sort((a, b) => (returnDate(a.p) || "9999").localeCompare(returnDate(b.p) || "9999"));
    if (!list.length) continue;
    groups += `<div class="grp"><h3 class="${ty.bad ? "bad" : "warn"}">${esc(ty.name)} — ${list.length}</h3>` +
      list
        .map(({ e, p }) => {
          const rd = returnDate(p);
          const right = p.nd ? "بدون تاريخ" : rd ? "العودة: " + rd : "مدة غير محددة";
          return `<div class="who"><span data-goto="${esc(e.id)}" style="cursor:pointer">${esc(
            e.prenom + " " + e.nom
          )} <small>${esc(e.mat)}</small></span><span>${esc(right)}</span></div>`;
        })
        .join("") +
      `</div>`;
  }

  /* returns due in the next 7 days (today .. today+7) */
  const horizon = add(t, 7);
  const due = away
    .map(({ e, p }) => ({ e, p, back: returnDate(p) }))
    .filter((x) => x.back && x.back >= t && x.back <= horizon)
    .sort((a, b) => a.back.localeCompare(b.back));
  const dueList = due.length
    ? due
        .map(
          ({ e, p, back }) =>
            `<div class="who"><span data-goto="${esc(e.id)}" style="cursor:pointer">${esc(
              e.prenom + " " + e.nom
            )} <small>${esc(e.mat)}</small></span><span>${esc(back === t ? "يعود اليوم" : back)} — ${esc(
              typeName(types, p)
            )}</span></div>`
        )
        .join("")
    : "<p>لا توجد عودات خلال الأيام السبعة القادمة.</p>";

  if (!A.D.length)
    return `<h2>لوحة الوضعية</h2><p>لا توجد بيانات بعد — استورد ملف CSV أو أضف موظفًا.</p>`;

  return `<h2>لوحة الوضعية</h2>
    <p><small>محسوبة من تاريخ اليوم ${t} — لا تُخزَّن الوضعية.</small></p>
    <div class="stat">${stats.join("")}</div>
    <h3>الغيابون حسب النوع</h3>
    ${groups || `<p class="ok">لا يوجد أي غائب اليوم: الجميع يعمل.</p>`}
    <h3>يعودون خلال 7 أيام</h3>
    <div class="grp">${dueList}</div>`;
}

export function mount(A) {
  $("#app").onclick = (ev) => {
    const s = ev.target.closest("[data-goto]");
    if (s) A.go("d", s.dataset.goto);
  };
}
