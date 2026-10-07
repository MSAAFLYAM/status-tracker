/* PIN lock: PBKDF2-SHA256 hash, forced setup on first launch,
 * auto-lock after LOCK_IDLE_MS of inactivity, NO recovery (the user must
 * confirm they understand this before the PIN is saved). */

import { $, b64ToBytes, bytesToB64 } from "./util.js";
import { LOCK_IDLE_MS } from "./config.js";

const ITER = 150000;

async function pbkdf2(pin, saltB64, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: iter, hash: "SHA-256" },
    key,
    256
  );
  return bytesToB64(bits);
}

/** Create a new PIN record: {hash, salt, iter}. */
export async function makePin(pin) {
  const saltB64 = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await pbkdf2(pin, saltB64, ITER), salt: saltB64, iter: ITER };
}

export async function checkPin(pin, rec) {
  if (!rec) return false;
  try {
    return (await pbkdf2(pin, rec.salt, rec.iter)) === rec.hash;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------ lock UI ----- */

let unlockCb = null; // set once by app.js: called with a fresh record (or null)
let recGetter = null; // set once by app.js: current PIN record (for auto-lock)
let timer = null;
let pinBuf = "";

export const isLocked = () => !$("#lock").hidden;
export const setUnlockCb = (fn) => (unlockCb = fn);
export const setRecGetter = (fn) => (recGetter = fn);

function digits() {
  $("#dots").textContent = "•".repeat(pinBuf.length);
}

/** mode: "setup" (first launch, forced) or "lock". */
export function showLock(mode, rec) {
  pinBuf = "";
  const el = $("#lock");
  const setup = mode === "setup";
  el.hidden = false;
  $("#app").hidden = true;
  el.innerHTML = `
    <h2>${setup ? "إنشاء رمز القفل" : "التطبيق مقفل"}</h2>
    <p class="pinnote">${
      setup
        ? 'أدخل رمزًا من 4 أرقام على الأقل. <b class="bad">تحذير: لا يوجد استرجاع للرمز إطلاقًا — إذا فقدته تفقد بيانات هذا الجهاز إلى الأبد.</b>'
        : "أدخل رمز PIN لفتح التطبيق."
    }</p>
    ${
      setup
        ? `<label class="chk"><input type="checkbox" id="ack"><span>أفهم أنه لا يمكن استرجاع الرمز إذا نسيته</span></label>`
        : ""
    }
    <div class="dots" id="dots" aria-live="polite"></div>
    <p class="bad" id="lockerr" role="alert"></p>
    <div class="keys">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join("")}
      <button type="button" data-k="clr">مسح</button>
      <button type="button" data-k="0">0</button>
      <button type="button" data-k="ok">${setup ? "حفظ" : "فتح"}</button>
    </div>
    ${setup ? `<p class="pinnote">احفظ الرمز في مكان آمن خارج هذا الجهاز.</p>` : ""}`;
  digits();

  const err = (m) => {
    $("#lockerr").textContent = m;
  };

  async function submit() {
    if (setup) {
      if (!$("#ack").checked) return err("أكّد أنك تفهم عدم إمكانية استرجاع الرمز");
      if (pinBuf.length < 4) return err("الرمز يجب أن يحتوي على 4 أرقام على الأقل");
      return finish(await makePin(pinBuf));
    }
    if (!(await checkPin(pinBuf, rec))) {
      pinBuf = "";
      digits();
      return err("رمز خاطئ، حاول مجددًا");
    }
    finish(null);
  }

  function finish(newRec) {
    el.hidden = true;
    el.innerHTML = "";
    el.onclick = null;
    el.onkeydown = null;
    $("#app").hidden = false;
    if (unlockCb) unlockCb(newRec);
    bump();
  }

  el.onclick = (ev) => {
    const b = ev.target.closest("button[data-k]");
    if (!b) return;
    err("");
    const k = b.dataset.k;
    if (k === "clr") pinBuf = "";
    else if (k === "ok") return submit();
    else if (pinBuf.length < 12) pinBuf += k;
    digits();
  };
  el.onkeydown = (ev) => {
    if (ev.key === "Enter") submit();
    else if (/^[0-9]$/.test(ev.key) && pinBuf.length < 12) {
      pinBuf += ev.key;
      digits();
    } else if (ev.key === "Backspace") {
      pinBuf = pinBuf.slice(0, -1);
      digits();
    }
  };
}

/** Re-lock using the record from recGetter. */
export function lock() {
  if (isLocked()) return;
  const rec = recGetter && recGetter();
  if (!rec) return;
  showLock("lock", rec);
}

/** Reset the inactivity timer; locks again after LOCK_IDLE_MS idle. */
export function bump() {
  clearTimeout(timer);
  if (isLocked() || !recGetter) return;
  timer = setTimeout(lock, LOCK_IDLE_MS);
}
