/* Service worker — offline first.
 * Versioned precache of the whole app shell, cache-first responses,
 * and an update flow: a new worker waits, the page shows a banner,
 * and only after "تحديث الآن" does it take over and reload the page.
 *
 * Bump VERSION whenever a file changes.
 */

const VERSION = "v1.1.4";
const CACHE = "emp-cache-" + VERSION;

const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "js/app.js",
  "js/util.js",
  "js/config.js",
  "js/db.js",
  "js/status.js",
  "js/search.js",
  "js/photo.js",
  "js/csv.js",
  "js/pin.js",
  "js/backup.js",
  "js/validate.js",
  "js/views/home.js",
  "js/views/detail.js",
  "js/views/form.js",
  "js/views/import.js",
  "js/views/dashboard.js",
  "js/views/settings.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch((err) => {
        // Surface a precache failure instead of installing a broken offline app.
        console.error("precache failed", err);
        throw err;
      })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("emp-cache-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => {
            if (req.mode === "navigate") return caches.match("index.html");
            return new Response("", { status: 504, statusText: "offline" });
          })
    )
  );
});
