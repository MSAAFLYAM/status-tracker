/**
 * serve.js — tiny dependency-free static server for local testing.
 * Correct MIME types (manifest as application/manifest+json, modules as
 * text/javascript), so the service worker behaves like it will in production.
 *
 * Usage:
 *   node tools/serve.js [port] [--root <dir>]
 *
 * --root lets you serve any directory (used by the subpath test to simulate
 * GitHub Pages serving the repo under /status-tracker/).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
let PORT = 8080;
let ROOT = path.join(__dirname, "..");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root") ROOT = path.resolve(args[++i] || ROOT);
  else if (!String(args[i]).startsWith("-")) PORT = Number(args[i]) || PORT;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch (e) {
      res.writeHead(400).end("bad request");
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    // Redirect "/dir" -> "/dir/" exactly like GitHub Pages / python http.server,
    // so relative URLs (and the service worker scope) resolve correctly.
    if (!p.endsWith("/") && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      res.writeHead(301, { Location: p + "/" }).end();
      return;
    }
    if (p.endsWith("/")) p += "index.html";
    const target = path.normalize(path.join(ROOT, p));
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log("serving " + ROOT + " on http://localhost:" + PORT));
