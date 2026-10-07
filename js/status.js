/* Current status is NEVER stored — it is computed from today's date.
 * The latest period covering today wins; otherwise the employee is working. */

import { today, endOf, add, esc } from "./util.js";
import { WORKING } from "./config.js";

export function currentPeriod(e, t = today()) {
  let c = null;
  for (const p of e.periods || []) {
    const en = endOf(p);
    const covers = p.nd ? p.start <= t : p.start <= t && (!en || t <= en);
    if (covers && (!c || p.start >= c.start)) c = p;
  }
  return c;
}

export function typeName(types, p) {
  const t = types.find((x) => x.tid === p.tid);
  return t ? t.name : p.type || "";
}

export function isBad(types, p) {
  const t = types.find((x) => x.tid === p.tid);
  return t ? !!t.bad : ["التوقيف عن العمل", "العزل"].includes(p.type);
}

export const badge = (e, types) => {
  const c = currentPeriod(e);
  if (!c) return `<span class="b">${WORKING}</span>`;
  return `<span class="b ${isBad(types, c) ? "bad" : "warn"}">${esc(typeName(types, c))}</span>`;
};

/** تاريخ العودة إلى العمل (بداية اليوم الموالي لآخر يوم من الغياب). */
export function returnDate(p) {
  if (p.nd) return null;
  const en = endOf(p);
  return en ? add(en, 1) : null;
}

export function statusLabel(e, types) {
  const c = currentPeriod(e);
  if (!c) return WORKING;
  if (c.nd) return typeName(types, c) + " (بدون تاريخ)";
  const rd = returnDate(c);
  return typeName(types, c) + (rd ? " — يعود " + rd : "");
}
