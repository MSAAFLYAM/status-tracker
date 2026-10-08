/* Strict schema validation for anything that crosses a trust boundary:
 * restored backup records and imported CSV rows.
 *  - whitelist of known fields only (unknown keys are dropped)
 *  - type checks, length caps, period-array rules, size limits
 *  - every problem is counted and reported; nothing may crash a screen
 * Nothing here touches the network and nothing stores personal data. */

import { uid, validDate, safePhoto, today } from "./util.js";

export const LIMITS = {
  id: 100,
  mat: 64,
  ppr: 64,
  nom: 100,
  prenom: 100,
  grade: 200,
  cap: 200,
  svc: 200,
  div: 200,
  addr: 300,
  tel: 40,
  fam: 20,
  pid: 64,
  tid: 64,
  type: 200,
  periods: 500, // أقصى عدد أرصدة في السجل الواحد
  employees: 20000, // أقصى عدد سجلات في النسخة
  days: 36500, // أقصى مدة بال أيام
  photo: 600000, // أقصى طول لصورة data URL
  maxFile: 250 * 1024 * 1024, // أقصى حجم لملف النسخة
};

/** حقول نصية في سجل الموظف: المفتاح -> أقصى طول. */
const STR_FIELDS = ["mat", "ppr", "nom", "prenom", "grade", "cap", "svc", "div", "addr", "tel", "fam"];
const DATE_FIELDS = ["joined", "dob"];

/** نص آمن: يقبل النصوص والأرقام والمنطقيات فقط (يشطب أي كائن/مصفوفة)،
 *  ويزيل أحرف التحكم، ويقصّر عند الحد. يعدّ في rep.fieldsCleaned عند أي تصحيح. */
function str(v, max, rep) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") {
    rep.fieldsCleaned++;
    return "";
  }
  let s = typeof v === "string" ? v : (rep.fieldsCleaned++, String(v));
  const stripped = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (stripped !== s) {
    s = stripped;
    rep.fieldsCleaned++;
  }
  if (s.length > max) {
    rep.fieldsCleaned++;
    s = s.slice(0, max);
  }
  return s;
}

function date(v, rep) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "string" && validDate(v)) return v;
  rep.fieldsCleaned++;
  return "";
}

function newReport(total) {
  return { total, kept: 0, rejected: [], periodsDropped: 0, photosDropped: 0, fieldsCleaned: 0 };
}

/** تنظيف مصفوفة الأرصدة: كل رصيد يجب أن يكون كائنًا بتاريخ بداية صالح ومدة
 *  ضمن الحدود؛ وإلا يُتجاهل ويُعدّ في التقرير. */
function sanitizePeriods(raw, rep) {
  const out = [];
  const src = Array.isArray(raw) ? raw : [];
  if (src.length > LIMITS.periods) rep.periodsDropped += src.length - LIMITS.periods;
  for (const p of src.slice(0, LIMITS.periods)) {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      rep.periodsDropped++;
      continue;
    }
    const nd = p.nd === true;
    let start = typeof p.start === "string" && validDate(p.start) ? p.start : "";
    if (nd && !start) start = today(); // وضعية بلا تاريخ: كالاستمارة
    if (!nd && !validDate(start)) {
      rep.periodsDropped++;
      continue;
    }
    const days = nd ? 0 : Math.floor(Number(p.days));
    if (!nd && (!Number.isFinite(days) || days < 0 || days > LIMITS.days)) {
      rep.periodsDropped++;
      continue;
    }
    const tid = str(p.tid, LIMITS.tid, rep);
    const type = str(p.type, LIMITS.type, rep);
    const pid = typeof p.pid === "string" && p.pid && p.pid.length <= LIMITS.pid ? p.pid : uid();
    out.push({ pid, tid, type, start, days, nd });
  }
  return out;
}

/**
 * تحقق صارم من مصفوفة سجلات موظفين.
 * يعيد { employees, report } — report يشرح كل ما رُفض أو نُظّف.
 * السجل غير الصالح يُرفض، والحقول الخاطئة تُنظَّف، ولا يُرفع أي عنصر غير معروف.
 */
export function sanitizeBackup(list) {
  const rep = newReport(Array.isArray(list) ? list.length : 0);
  const seen = new Set();
  const out = [];
  const src = Array.isArray(list) ? list : [];

  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    const n = i + 1;
    if (out.length >= LIMITS.employees) {
      rep.rejected.push({ i: n, reason: "تجاوز الحد الأقصى للسجلات" });
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      rep.rejected.push({ i: n, reason: "ليس سجلًا صالحًا" });
      continue;
    }
    if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > LIMITS.id) {
      rep.rejected.push({ i: n, reason: "معرّف مفقود أو غير صالح" });
      continue;
    }
    if (seen.has(raw.id)) {
      rep.rejected.push({ i: n, reason: "معرّف مكرر" });
      continue;
    }
    if (raw.periods !== undefined && !Array.isArray(raw.periods)) {
      rep.rejected.push({ i: n, reason: "قائمة الأرصدة غير صالحة" });
      continue;
    }

    const e = { id: raw.id };
    for (const k of STR_FIELDS) {
      const v = str(raw[k], LIMITS[k], rep);
      if (v !== "") e[k] = v;
    }
    for (const k of DATE_FIELDS) {
      const v = date(raw[k], rep);
      if (v) e[k] = v;
    }
    if (raw.photo !== undefined) {
      if (safePhoto(raw.photo)) e.photo = raw.photo;
      else rep.photosDropped++;
    }
    e.periods = sanitizePeriods(raw.periods, rep);

    seen.add(raw.id);
    out.push(e);
    rep.kept++;
  }
  return { employees: out, report: rep };
}

/** تنظيف خلية CSV: نص، بلا أحرف تحكم، داخل حد الطول. يعيد { v, dirty }. */
export function cleanCell(v, max) {
  let s = String(v ?? "");
  const stripped = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const dirty = stripped !== s;
  s = stripped;
  if (s.length > max) return { v: s.slice(0, max), dirty: true };
  return { v: s, dirty };
}
