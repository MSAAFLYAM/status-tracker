/* CSV import / export.
 * Import: UTF-8 with or without BOM, "," or ";" separator, header aliases in
 * Arabic / French / English, updates the row with the same matricule.
 * Export: UTF-8 with BOM and ";" separator (opens cleanly in Excel). */

import { nz, download, today } from "./util.js";
import { ALIASES, FIELDS, FAM_LABEL } from "./config.js";
import { cleanCell, LIMITS } from "./validate.js";

/** RFC-ish CSV parser (quotes, escaped quotes, CR/LF), separator auto-detected. */
export function parse(t) {
  t = t.replace(/^\uFEFF/, "");
  const firstLine = t.split("\n")[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const R = [];
  let r = [],
    c = "",
    q = false;
  for (let i = 0; i < t.length; i++) {
    const h = t[i];
    if (q) {
      if (h == '"') {
        if (t[i + 1] == '"') {
          c += '"';
          i++;
        } else q = false;
      } else c += h;
    } else if (h == '"') q = true;
    else if (h == sep) {
      r.push(c);
      c = "";
    } else if (h == "\n" || h == "\r") {
      if (h == "\r" && t[i + 1] == "\n") i++;
      r.push(c);
      c = "";
      R.push(r);
      r = [];
    } else c += h;
  }
  if (c || r.length) {
    r.push(c);
    R.push(r);
  }
  return R.filter((row) => row.some((x) => x.trim()));
}

/** Map each header cell to a field key (null = unknown column). */
export const headerKeys = (headerRow) =>
  headerRow.map((h) => Object.keys(ALIASES).find((k) => ALIASES[k].some((a) => nz(a) === nz(h.trim()))));

/**
 * Apply parsed rows onto D (mutates). Same matricule => update, else create.
 * Every cell is cleaned first (control characters stripped, length capped);
 * every skipped row is reported with a reason.
 * Returns { updated, created, cleaned, skipped: [{line, reason}] }.
 */
export function importRows(rows, D, uid) {
  const report = { updated: 0, created: 0, cleaned: 0, skipped: [] };
  if (!rows.length) return report;
  const ks = headerKeys(rows[0]);
  rows.slice(1).forEach((row, i) => {
    const line = i + 2; // 1-based, header is line 1
    const o = {};
    let dirty = false;
    ks.forEach((k, j) => {
      if (!k) return;
      const c = cleanCell(String(row[j] || "").trim(), LIMITS[k] || LIMITS.svc);
      if (c.dirty) dirty = true;
      o[k] = c.v;
    });
    if (!o.mat && !o.nom) {
      report.skipped.push({ line, reason: "لا يوجد رقم معرّف ولا اسم" });
      return;
    }
    if (dirty) report.cleaned++;
    const x = o.mat ? D.find((e) => e.mat == o.mat) : null;
    if (x) {
      Object.assign(x, o);
      report.updated++;
    } else {
      D.push({ id: uid(), periods: [], mat: "", nom: "", prenom: "", ...o });
      report.created++;
    }
  });
  return report;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Export the whole list as CSV (no photos, no periods). */
export function exportCsv(D, labels) {
  const head = [...FIELDS.map((f) => labels[f[0]] || f[1]), FAM_LABEL];
  const lines = [head.map(csvCell).join(";")];
  for (const e of D) {
    lines.push([...FIELDS.map((f) => e[f[0]] || ""), e.fam || ""].map(csvCell).join(";"));
  }
  const text = "\uFEFF" + lines.join("\r\n") + "\r\n";
  download(new Blob([text], { type: "text/csv;charset=utf-8" }), `employees-${today()}.csv`);
}
