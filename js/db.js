/* IndexedDB storage: employees under key "d", settings under key "s".
 * Everything stays on the device. We also ask for persistent storage so the
 * browser does not evict the data under storage pressure. */

import { DEFAULT_TYPES } from "./config.js";

const DB_NAME = "emp";
const DB_VERSION = 2;
const STORE = "k";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function get(key) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      }),
    () => null
  );
}

/** فشل الحفظ: السبب + رسالة عربية جاهزة للعرض. */
const fail = (reason, error) => ({
  ok: false,
  reason, // "quota" | "unavailable" | "unknown"
  message:
    reason === "quota"
      ? "المساحة ممتلئة: تعذّر حفظ البيانات على هذا الجهاز"
      : reason === "unavailable"
      ? "قاعدة البيانات (IndexedDB) غير متاحة: تعذّر حفظ البيانات"
      : "تعذّر حفظ البيانات على هذا الجهاز",
  detail: error ? String(error.message || error) : "",
});
const reasonOf = (e) => (e && e.name === "QuotaExceededError" ? "quota" : "unknown");

/** يكتب المفتاح ويبلّغ عن النتيجة: { ok: true } أو { ok:false, reason, message }.
 *  لا يُبتلع الفشل أبدًا (M5). */
function put(key, value) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        let tx, r;
        try {
          tx = db.transaction(STORE, "readwrite");
          r = tx.objectStore(STORE).put(value, key);
        } catch (e) {
          return resolve(fail(reasonOf(e), e));
        }
        let done = false;
        const finish = (res) => {
          if (!done) {
            done = true;
            resolve(res);
          }
        };
        if (r) r.onerror = () => finish(fail(reasonOf(r.error), r.error));
        tx.onabort = () => finish(fail(reasonOf(tx.error), tx.error));
        tx.oncomplete = () => finish({ ok: true });
      }),
    (e) => resolve(fail(e && e.name === "QuotaExceededError" ? "quota" : "unavailable", e))
  );
}

export function defaultSettings() {
  return { pin: null, types: DEFAULT_TYPES.map((t) => ({ ...t })), labels: {}, font: 0, lastBackup: null };
}

function buildSettings(s) {
  const S = Object.assign(defaultSettings(), s || {});
  if (!Array.isArray(S.types) || !S.types.length) S.types = DEFAULT_TYPES.map((t) => ({ ...t }));
  return S;
}

/** يقرأ الكل. عند تعذّر فتح/قراءة القاعدة يعود { error } حتى تعرض الشاشة
 *  المانعة بدل تطبيق فارغ يكذب على المستخدم (M5). */
export async function loadAll() {
  try {
    await open();
  } catch (e) {
    return { D: null, S: defaultSettings(), error: "unavailable" };
  }
  let d, s;
  try {
    [d, s] = await Promise.all([get("d"), get("s")]);
  } catch (e) {
    return { D: null, S: defaultSettings(), error: "unavailable" };
  }
  return { D: Array.isArray(d) ? d : null, S: buildSettings(s) };
}

export const saveData = (D) => put("d", D);
export const saveSettings = (S) => put("s", S);
export const clearData = () => put("d", []);

/** نطلب تخزينًا دائمًا حتى لا يحذف المتصفح البيانات. */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}
