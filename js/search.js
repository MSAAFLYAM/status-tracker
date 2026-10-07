/* Search: professional number, PPR, full name — any word order,
 * with Arabic normalization (hamza forms, ة/ه, ى/ي, diacritics). */

import { nz } from "./util.js";

export function find(D, q) {
  const n = nz(q);
  if (!n) return D;
  const ks = n.split(/\s+/);
  return D.filter((e) => {
    const h = nz((e.prenom || "") + " " + (e.nom || ""));
    const m = nz(e.mat + " " + (e.ppr || ""));
    return m.includes(n) || ks.every((k) => h.includes(k));
  });
}
