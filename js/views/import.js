/* CSV import (UTF-8 ±BOM, "," or ";", Arabic/French/English header aliases).
 * Importing a row with an existing matricule updates that employee. */

import { $, esc, uid, alertBox } from "../util.js";
import { parse, importRows } from "../csv.js";

export const html = () => `<h2>استيراد CSV</h2>
<p><small>الملف بترميز UTF-8 والسطر الأول عناوين الأعمدة: الرقم المهني، رقم التأجير، الاسم العائلي، الاسم الشخصي، الرتبة، الصفة، المصلحة، القسم، تاريخ الالتحاق بالعمل... يُفصل بين الأعمدة بـ <b>;</b> أو <b>,</b>. الموظف الموجود بنفس الرقم المهني يتم تحديثه، ولا يُنشأ له سجل جديد.</small></p>
<input id="csv" type="file" accept=".csv,text/csv">
<div id="msg"></div>
<p><small>لا يُرفع الملف إلى أي خادم: تتم القراءة داخل المتصفح فقط.</small></p>`;

export function mount(A) {
  $("#app").onchange = async (ev) => {
    if (ev.target.id !== "csv") return;
    const file = ev.target.files[0];
    if (!file) return;
    const out = $("#msg");
    out.innerHTML = "<p>جارٍ القراءة…</p>";
    let rows;
    try {
      rows = parse(await file.text());
    } catch (e) {
      out.innerHTML = `<p class="bad">تعذّرت قراءة الملف.</p>`;
      return;
    }
    if (rows.length < 2) {
      out.innerHTML = `<p class="bad">الملف فارغ أو لا يحتوي على سطر عناوين.</p>`;
      return;
    }
    const rep = importRows(rows, A.D, uid);
    await A.save();
    out.innerHTML = `<p class="ok">تمت معالجة ${rep.created + rep.updated} موظف (جديد: ${rep.created}، محدّث: ${
      rep.updated
    }).</p>` +
      (rep.skipped.length
        ? `<p class="warn">تم تجاهل ${rep.skipped.length} سطر:</p><ul>${rep.skipped
            .slice(0, 20)
            .map((s) => `<li>السطر ${s.line}: ${esc(s.reason)}</li>`)
            .join("")}</ul>`
        : "");
    if (rep.skipped.length > 20)
      out.innerHTML += `<p><small>و${rep.skipped.length - 20} سطر آخر…</small></p>`;
    if (rep.created + rep.updated > 0) await alertBox(`<p class="ok">تم استيراد البيانات بنجاح.</p>`);
  };
}
