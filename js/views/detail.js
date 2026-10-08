/* Employee detail: info, add/edit/delete periods, employment history. */

import { $, esc, today, uid, endOf, tenure } from "../util.js";
import { FIELDS, FAM_LABEL } from "../config.js";
import { badge, currentPeriod, returnDate, typeName } from "../status.js";
import { ph } from "./home.js";

export function html(A) {
  const e = A.D.find((x) => x.id == A.V.id);
  if (!e) return `<p class="bad">هذا الموظف لم يعد موجودًا.</p><button data-a="home" type="button">رجوع</button>`;
  const types = A.S.types;
  const L = (k) => A.S.labels[k] || (FIELDS.find((f) => f[0] === k) || [, k])[1];
  const c = currentPeriod(e);
  const rd = c ? returnDate(c) : null;
  const ps = [...(e.periods || [])].sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  const editing = A.V.editPid ? (e.periods || []).find((p) => p.pid === A.V.editPid) : null;

  const sel = `<select id="pt">${types
    .map(
      (t) =>
        `<option value="${esc(t.tid)}" data-o="${t.noDate ? 1 : ""}" ${
          editing && editing.tid === t.tid ? "selected" : ""
        }>${esc(t.name)}</option>`
    )
    .join("")}</select>`;

  const selT = editing ? types.find((t) => t.tid === editing.tid) : types[0];
  const noDate = !!(selT && selT.noDate);

  const periodForm = `<h3>${editing ? "تعديل رخصة / وضعية" : "إضافة رخصة / وضعية"}</h3>
    ${sel}
    <div class="row" id="pr" ${noDate ? "hidden" : ""}>
      <div><label>تاريخ البداية</label><input id="ps" type="date" value="${esc(editing && !editing.nd ? editing.start : "")}"></div>
      <div><label>المدة بالأيام (0 = غير محددة)</label><input id="pd" type="number" min="0" inputmode="numeric" value="${
        editing ? editing.days : ""
      }" placeholder="عدد الأيام"></div>
    </div>
    <p id="perr" class="bad" role="alert"></p>
    <button data-a="addp" type="button">${editing ? "حفظ التعديل" : "إضافة"}</button>
    ${
      editing
        ? `<button data-a="cancelep" type="button">إلغاء</button>`
        : ""
    }`;

  const list = ps.length
    ? ps
        .map((p) => {
          const name = typeName(types, p);
          const back = returnDate(p);
          const range = p.nd
            ? "بدون تاريخ أو مدة (إلى حين التعديل)"
            : "من " + p.start + (endOf(p) ? " إلى " + endOf(p) : " (غير محددة)");
          return `<div class="card"><div>${esc(name)}<br>${esc(range)}${back ? "<br>العودة: " + esc(back) : ""}</div>
            <button data-a="editp" data-p="${esc(p.pid)}" type="button">تعديل</button>
            <button data-a="rmp" data-p="${esc(p.pid)}" type="button">حذف</button></div>`;
        })
        .join("")
    : "<p>لا توجد رخص مسجلة.</p>";

  return `<div class="card">${ph(e)}<div><h2 class="tight">${esc(e.prenom)} ${esc(e.nom)}</h2>${badge(e, types)}${
    rd ? `<br>يعود إلى العمل: ${esc(rd)}` : ""
  }</div></div>
  <p>${FIELDS.map((f) => esc(L(f[0])) + ": " + (esc(e[f[0]]) || "—")).join("<br>")}<br>${esc(
    A.S.labels.fam || FAM_LABEL
  )}: ${esc(e.fam) || "—"}${e.joined ? "<br>الأقدمية: " + esc(tenure(e.joined)) : ""}</p>
  <button data-a="edit" type="button">تعديل</button>
  <button data-a="del" type="button">حذف الموظف</button>
  <button data-a="home" type="button">رجوع</button>
  ${periodForm}
  <h3>السجل</h3>${list}`;
}

export function mount(A) {
  const syncSelect = () => {
    const opt = $("#pt").selectedOptions[0];
    if (!opt) return;
    const t = A.S.types.find((x) => x.tid === opt.value);
    const nd = !!(t && t.noDate);
    $("#pr").hidden = nd;
    if (nd) {
      $("#ps").value = "";
      $("#pd").value = "";
    } else if (t && !$("#pd").value) {
      $("#pd").value = t.days || "";
    }
  };

  $("#app").onchange = (ev) => {
    if (ev.target.id === "pt") syncSelect();
  };

  $("#app").onclick = async (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    const e = A.D.find((x) => x.id == A.V.id);
    if (!e) return;

    if (a === "home") return A.go("home");
    if (a === "edit") return A.go("form", e.id);

    if (a === "del") {
      if (b.dataset.c !== "1") {
        b.dataset.c = "1";
        b.textContent = "اضغط للتأكيد";
        return;
      }
      A.D = A.D.filter((x) => x !== e);
      await A.save();
      return A.go("home");
    }

    if (a === "addp") {
      const opt = $("#pt").selectedOptions[0];
      const t = A.S.types.find((x) => x.tid === opt.value);
      const nd = !!(t && t.noDate);
      const s = $("#ps").value;
      const d = $("#pd").value;
      if (!nd && (!s || d === "" || +d < 0)) {
        $("#perr").textContent = "حدد تاريخ البداية والمدة";
        return;
      }
      const period = {
        pid: A.V.editPid || uid(),
        tid: t.tid,
        type: t.name,
        start: nd ? today() : s,
        days: nd ? 0 : +d,
        nd,
      };
      if (A.V.editPid) {
        const i = (e.periods || []).findIndex((p) => p.pid === A.V.editPid);
        if (i >= 0) e.periods[i] = period;
        A.V.editPid = null;
      } else {
        (e.periods = e.periods || []).push(period);
      }
      await A.save();
      return A.render();
    }

    if (a === "editp") {
      A.V.editPid = b.dataset.p;
      return A.render();
    }
    if (a === "cancelep") {
      A.V.editPid = null;
      return A.render();
    }
    if (a === "rmp") {
      e.periods = (e.periods || []).filter((p) => p.pid != b.dataset.p);
      if (A.V.editPid === b.dataset.p) A.V.editPid = null;
      await A.save();
      return A.render();
    }
  };

  syncSelect();
}
