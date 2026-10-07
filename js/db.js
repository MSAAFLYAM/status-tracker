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

function put(key, value) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }),
    () => false
  );
}

export function defaultSettings() {
  return { pin: null, types: DEFAULT_TYPES.map((t) => ({ ...t })), labels: {}, font: 0, lastBackup: null };
}

export async function loadAll() {
  const [d, s] = await Promise.all([get("d"), get("s")]);
  const S = Object.assign(defaultSettings(), s || {});
  if (!Array.isArray(S.types) || !S.types.length) S.types = DEFAULT_TYPES.map((t) => ({ ...t }));
  return { D: Array.isArray(d) ? d : null, S };
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
