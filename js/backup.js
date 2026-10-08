/* Backup & restore: the whole database (photos included) as a JSON Blob,
 * optionally encrypted with a password (PBKDF2-SHA256 + AES-GCM).
 * Nothing is ever uploaded — the file is downloaded to the device only. */

import { b64ToBytes, bytesToB64, today, safePhoto } from "./util.js";
import { BACKUP_REMIND_DAYS } from "./config.js";

const KIND = "emp-backup";
const KDF_ITER = 300000;

async function deriveKey(password, saltB64, iter, usages) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

function buildPlain(D) {
  return {
    kind: KIND,
    v: 1,
    created: new Date().toISOString(),
    count: D.length,
    employees: D,
  };
}

/** Download a backup file. password (optional) => encrypted. Returns filename. */
export async function exportBackup(D, password) {
  let obj = buildPlain(D);
  if (password) {
    const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    const iv = bytesToB64(crypto.getRandomValues(new Uint8Array(12)));
    const key = await deriveKey(password, salt, KDF_ITER, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: b64ToBytes(iv) }, key, new TextEncoder().encode(JSON.stringify(obj)));
    obj = { kind: KIND, v: 1, enc: "AES-GCM", kdf: "PBKDF2", iter: KDF_ITER, salt, iv, data: bytesToB64(ct) };
  }
  const name = `backup-${today()}${password ? "-encrypted" : ""}.json`;
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** Read a backup file (File object) and return the employees array.
 *  Throws an Error with an Arabic message on any problem. */
export async function importBackup(file, password) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch (e) {
    throw new Error("الملف ليس نسخة احتياطية صالحة (JSON غير صالح)");
  }
  if (!obj || obj.kind !== KIND) throw new Error("هذا الملف ليس نسخة احتياطية لهذا التطبيق");
  if (obj.enc) {
    if (!password) throw new Error("هذه النسخة مشفّرة: أدخل كلمة السر");
    try {
      const key = await deriveKey(password, obj.salt, obj.iter, ["decrypt"]);
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBytes(obj.iv) },
        key,
        b64ToBytes(obj.data)
      );
      obj = JSON.parse(new TextDecoder().decode(pt));
    } catch (e) {
      throw new Error("كلمة السر خاطئة أو الملف تالف");
    }
  }
  if (!obj || obj.kind !== KIND || !Array.isArray(obj.employees)) throw new Error("محتوى النسخة غير صالح");
  /* Drop any photo that is not a valid data:image URL: a crafted backup can
   * otherwise smuggle markup into <img src="…">. */
  return obj.employees.map((e) => {
    if (e && typeof e === "object" && e.photo && !safePhoto(e.photo)) {
      const c = { ...e };
      delete c.photo;
      return c;
    }
    return e;
  });
}

/** true if we should remind the user to make a backup (never / > 30 days ago). */
export function backupDue(S) {
  if (!S.lastBackup) return true;
  const days = (Date.now() - new Date(S.lastBackup).getTime()) / 86400000;
  return days >= BACKUP_REMIND_DAYS;
}

export function backupAge(S) {
  if (!S.lastBackup) return null;
  return Math.floor((Date.now() - new Date(S.lastBackup).getTime()) / 86400000);
}
