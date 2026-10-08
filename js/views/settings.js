/* Settings: field labels (rename on device only), leave types, PIN,
 * backup / restore / CSV export, wipe, font size. */

import { $, esc, uid, confirmBox, alertBox } from "../util.js";
import { FIELDS, FAM_LABEL } from "../config.js";
import { LIMITS } from "../validate.js";
import { makePin, checkPin } from "../pin.js";
import { exportBackup, importBackup, backupAge } from "../backup.js";
import { exportCsv } from "../csv.js";

export function html(A) {
  const S = A.S;
  const L = (k) => S.labels[k] || (FIELDS.find((f) => f[0] === k) || [, k])[1];
  const age = backupAge(S);

  const labels = FIELDS.map(
    (f) => `<label>${esc(f[1])}</label><input id="lab_${f[0]}" type="text" value="${esc(L(f[0]))}">`
  ).join("");

  const types = S.types
    .map(
      (t) => `<div class="card"><div class="grow">
        <input id="nm_${esc(t.tid)}" type="text" value="${esc(t.name)}" aria-label="اسم النوع">
        <div class="chk"><input id="dd_${esc(t.tid)}" class="w90" type="number" min="0" value="${esc(
        String(+t.days || 0)
      )}" aria-label="المدة الافتراضية"><span>مدة افتراضية (أيام)</span></div>
        <div class="chk"><input id="nd_${esc(t.tid)}" type="checkbox" ${t.noDate ? "checked" : ""}><span>بدون تاريخ ومدة (يبقى حتى الحذف)</span></div>
        <div class="chk"><input id="bd_${esc(t.tid)}" type="checkbox" ${t.bad ? "checked" : ""}><span>حالة سالبة (تظهر بالأحمر)</span></div>
      </div><button data-a="delty" data-t="${esc(t.tid)}" type="button">حذف</button></div>`
    )
    .join("");

  return `<h2>الإعدادات</h2>

<h3>حجم الخط</h3>
<div>
  <button data-a="setfont" data-f="0" type="button" ${S.font === 0 ? 'class="ok"' : ""}>عادي</button>
  <button data-a="setfont" data-f="1" type="button" ${S.font === 1 ? 'class="ok"' : ""}>كبير</button>
  <button data-a="setfont" data-f="2" type="button" ${S.font === 2 ? 'class="ok"' : ""}>أكبر</button>
</div>

<h3>تسميات الحقول</h3>
<p><small>تُغيَّر التسمية على هذا الجهاز فقط، ويمكن استعمالها لكتابة التسمية الكاملة التي تفضلها.</small></p>
${labels}
<label>${esc(FAM_LABEL)}</label><input id="lab_fam" type="text" value="${esc(S.labels.fam || FAM_LABEL)}">
<div><button data-a="savelabels" type="button">حفظ التسميات</button></div>

<h3>أنواع الرخص والوضعيات</h3>
<p><small>يمكنك تغيير الأسماء، المدد، وإضافة أنواع جديدة. الأسماء القديمة في السجلات تُحدَّث تلقائيًا.</small></p>
${types}
<div class="card"><div class="grow">
  <input id="newty" type="text" placeholder="اسم النوع الجديد" aria-label="اسم النوع الجديد">
  <div class="chk"><input id="newdd" class="w90" type="number" min="0" value="1"><span>مدة افتراضية (أيام)</span></div>
</div><button data-a="addty" type="button">إضافة</button></div>
<div><button data-a="savetypes" type="button">حفظ الأنواع</button></div>

<h3>قفل التطبيق (PIN)</h3>
<p><small>القفل يظهر عند فتح التطبيق ويعود تلقائيًا بعد دقيقتين من عدم الاستعمال. لا يوجد استرجاع للرمز.</small></p>
<div><button data-a="changepin" type="button">تغيير رمز القفل</button></div>

<h3>النسخ الاحتياطي</h3>
<p><small>${
    age === null
      ? '<span class="warn">لم يتم إنشاء نسخة احتياطية بعد.</span>'
      : age >= 30
      ? `<span class="warn">آخر نسخة احتياطية منذ ${age} يومًا — يُنصح بإنشاء نسخة جديدة.</span>`
      : `آخر نسخة احتياطية منذ ${age} يومًا.`
  }</small></p>
<div class="chk"><input id="enc" type="checkbox"><span>تشفير النسخة بكلمة سر (اختياري)</span><input id="bpw" type="password" placeholder="كلمة السر" autocomplete="new-password"></div>
<div>
  <button data-a="export" type="button">تنزيل نسخة (JSON)</button>
  <button data-a="exportcsv" type="button">تنزيل CSV</button>
</div>
<label>استرجاع نسخة احتياطية</label>
<input id="rfile" type="file" accept=".json,application/json">
<div class="chk"><input id="rpw" type="password" placeholder="كلمة السر (إن وُجدت)" autocomplete="off"></div>
<div><button data-a="restore" type="button">استرجاع من الملف</button></div>
<p><small>تُحفظ النسخة في تنزيلات الجهاز. لا تُرسل البيانات إلى أي مكان.</small></p>

<h3>مسح البيانات</h3>
<p><small>يحذف كل سجلات الموظفين والصور من هذا الجهاز. يبقى رمز القفل.</small></p>
<div><button data-a="wipe" type="button" class="bad">مسح كل بيانات الموظفين</button></div>

<h3>التخزين</h3>
<p id="stinfo"><small>…</small></p>`;
}

export function mount(A) {
  const S = A.S;
  navigator.storage &&
    navigator.storage.persisted &&
    navigator.storage.persisted().then((p) => {
      const el = $("#stinfo");
      if (el)
        el.innerHTML = `<small>التخزين الدائم: ${
          p ? "مفعّل ✅ (لن يحذف المتصفح البيانات)" : "غير مفعّل — يتم طلبه تلقائيًا عند أول تشغيل"
        }</small>`;
    });

  $("#app").onclick = async (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;

    if (a === "setfont") {
      S.font = +b.dataset.f;
      await A.saveS();
      A.applyFont();
      return A.render();
    }

    if (a === "savelabels") {
      for (const f of FIELDS) S.labels[f[0]] = $("#lab_" + f[0]).value.trim() || f[1];
      S.labels.fam = $("#lab_fam").value.trim() || FAM_LABEL;
      if (!(await A.saveS())) return;
      return alertBox(`<p class="ok">تم حفظ التسميات.</p>`);
    }

    if (a === "addty") {
      const name = $("#newty").value.trim();
      if (!name) return alertBox(`<p class="bad">اكتب اسم النوع الجديد.</p>`);
      S.types.push({ tid: "t" + uid(), name, days: +$("#newdd").value || 0 });
      await A.saveS();
      return A.render();
    }

    if (a === "delty") {
      if (S.types.length <= 1) return alertBox(`<p class="bad">يجب إبقاء نوع واحد على الأقل.</p>`);
      const ok = await confirmBox({
        title: "حذف النوع",
        body: "<p>سيختفي من قائمة الإضافة، لكن السجلات القديمة تبقى كما هي.</p>",
        ok: "حذف",
        danger: true,
      });
      if (!ok) return;
      S.types = S.types.filter((t) => t.tid !== b.dataset.t);
      await A.saveS();
      return A.render();
    }

    if (a === "savetypes") {
      for (const t of S.types) {
        t.name = $("#nm_" + t.tid).value.trim() || t.name;
        t.days = Math.max(0, +$("#dd_" + t.tid).value || 0);
        t.noDate = $("#nd_" + t.tid).checked;
        t.bad = $("#bd_" + t.tid).checked;
      }
      if (!(await A.saveS())) return;
      return alertBox(`<p class="ok">تم حفظ أنواع الرخص.</p>`);
    }

    if (a === "changepin") return changePin(A);

    if (a === "export") {
      const pw = $("#enc").checked ? $("#bpw").value : "";
      if ($("#enc").checked && pw.length < 4) return alertBox(`<p class="bad">كلمة السر قصيرة جدًا (4 أحرف على الأقل).</p>`);
      const name = await exportBackup(A.D, pw || null);
      S.lastBackup = new Date().toISOString();
      await A.saveS();
      if (A.banner) A.banner();
      return alertBox(`<p class="ok">تم تنزيل النسخة: ${esc(name)}</p>`);
    }

    if (a === "exportcsv") {
      exportCsv(A.D, S.labels);
      return;
    }

    if (a === "restore") {
      const f = $("#rfile").files[0];
      if (!f) return alertBox(`<p class="bad">اختر ملف النسخة أولًا.</p>`);
      if (f.size > LIMITS.maxFile) return alertBox(`<p class="bad">الملف كبير جدًا (الحد المسموح 250MB).</p>`);
      let res;
      try {
        res = await importBackup(f, $("#rpw").value || null);
      } catch (e) {
        return alertBox(`<p class="bad">${esc(e.message)}</p>`);
      }
      const r = res.report;
      /* لا نستبدل شيئًا إذا لم يبقَ أي سجل صالح: المسح الصامت ممنوع. */
      if (r.total > 0 && !res.employees.length)
        return alertBox(
          `<p class="bad">لا يوجد أي سجل صالح في الملف (المتجاهلة: ${r.rejected.length}) — لم يتغيّر شيء.</p>`
        );
      const ok = await confirmBox({
        title: "استرجاع النسخة",
        body: `<p>النسخة تحتوي على <b>${res.employees.length}</b> موظف${
          r.rejected.length ? ` (رُفضت <b>${r.rejected.length}</b> سجلات غير صالحة)` : ""
        }. سيتم <b class="bad">استبدال</b> كل البيانات الحالية (${A.D.length} موظف).</p>`,
        ok: "استبدال واسترجاع",
        danger: true,
      });
      if (!ok) return;
      await A.replaceData(res.employees);
      if (A.banner) A.banner();
      A.go("home");
      if (r.rejected.length || r.periodsDropped || r.photosDropped || r.fieldsCleaned)
        return alertBox(restoreReport(r));
      return;
    }

    if (a === "wipe") {
      if (b.dataset.c !== "1") {
        b.dataset.c = "1";
        b.textContent = "اضغط للتأكيد نهائيًا";
        return;
      }
      const ok = await confirmBox({
        title: "مسح كل البيانات",
        body: `<p class="bad">سيُحذف ${A.D.length} موظف وكل السجلات والصور من هذا الجهاز. لا يمكن التراجع بدون نسخة احتياطية.</p>`,
        ok: "مسح نهائي",
        danger: true,
      });
      if (!ok) return;
      await A.replaceData([]);
      if (A.banner) A.banner();
      return A.render();
    }
  };
}

/** تقرير الاسترجاع: كل سجل مرفوض وكل حقل مُنظَّف يظهر للمستخدم بوضوح. */
function restoreReport(r) {
  const out = [`<p class="ok">تم استرجاع ${r.kept} موظفًا.</p>`];
  if (r.rejected.length)
    out.push(
      `<p class="bad">السجلات المتجاهلة: ${r.rejected.length}</p><ul>${r.rejected
        .slice(0, 5)
        .map((x) => `<li>السجل ${x.i}: ${esc(x.reason)}</li>`)
        .join("")}</ul>` +
        (r.rejected.length > 5 ? `<p><small>و${r.rejected.length - 5} سجلات أخرى…</small></p>` : "")
    );
  if (r.periodsDropped)
    out.push(`<p class="warn">الأرصدة المتجاهلة: ${r.periodsDropped} (تاريخ أو مدة غير صالح).</p>`);
  if (r.photosDropped) out.push(`<p class="warn">الصور المحذوفة: ${r.photosDropped} (غير صالحة).</p>`);
  if (r.fieldsCleaned) out.push(`<p class="warn">الحقول المنظَّفة: ${r.fieldsCleaned} (نوع أو طول غير صالح).</p>`);
  return out.join("");
}

async function changePin(A) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="box"><h2>تغيير رمز القفل</h2>
    <label>الرمز الحالي</label><input id="oldpin" type="password" inputmode="numeric" autocomplete="off">
    <label>الرمز الجديد (4 أرقام فأكثر)</label><input id="newpin" type="password" inputmode="numeric" autocomplete="new-password">
    <label>تأكيد الرمز الجديد</label><input id="newpin2" type="password" inputmode="numeric" autocomplete="new-password">
    <p class="bad" id="pinerr" role="alert"></p>
    <div class="btns"><button type="button" data-x="0">إلغاء</button><button type="button" data-x="1">حفظ</button></div></div>`;
  m.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-x]");
    if (!b) return;
    if (b.dataset.x === "0") return m.remove();
    const err = (t) => (m.querySelector("#pinerr").textContent = t);
    const old = m.querySelector("#oldpin").value;
    const n1 = m.querySelector("#newpin").value;
    const n2 = m.querySelector("#newpin2").value;
    if (!(await checkPin(old, A.S.pin))) return err("الرمز الحالي خاطئ");
    if (n1.length < 4) return err("الرمز الجديد قصير (4 أرقام على الأقل)");
    if (n1 !== n2) return err("الرمزان غير متطابقين");
    A.S.pin = await makePin(n1);
    const ok = await A.saveS();
    m.remove();
    if (ok) await alertBox(`<p class="ok">تم تغيير رمز القفل.</p>`);
  });
  document.body.appendChild(m);
  m.querySelector("#oldpin").focus();
}
