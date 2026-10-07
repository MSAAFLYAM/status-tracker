/**
 * make-icons.js — generates the PWA icons as PNG files, with zero dependencies.
 *
 * Design: neon green (#39ff14) glowing person glyph inside a thin ring, on black.
 *   icons/icon-192.png          192x192, purpose "any"
 *   icons/icon-512.png          512x512, purpose "any"
 *   icons/icon-maskable-512.png 512x512, purpose "maskable" (glyph scaled into the
 *                               central 80% safe zone, full-bleed black)
 *
 * Run: node tools/make-icons.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer of size width*height*4 -> PNG file bytes */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- design ---- */

const GREEN = [0x39, 0xff, 0x14];

// Signed distance (in unit-of-width, negative = inside) to the glyph.
// u,v are in 0..1 of the *design box*.
function glyphSd(u, v) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const d = Math.hypot(cx, cy);

  // ring
  const ring = Math.abs(d - 0.455) - 0.026;

  // head (circle)
  const head = Math.hypot(u - 0.5, v - 0.35) - 0.105;

  // torso (ellipse, approximated SDF)
  const ex = (u - 0.5) / 0.2;
  const ey = (v - 0.7) / 0.18;
  const k = Math.hypot(ex, ey);
  let torso = 1e9;
  if (k > 1e-9) {
    const gx = (u - 0.5) / (0.2 * 0.2);
    const gy = (v - 0.7) / (0.18 * 0.18);
    const grad = Math.hypot(gx, gy) / k;
    torso = (k - 1) / grad;
  }

  return Math.min(ring, head, torso);
}

const SS = 4; // supersampling grid per axis

function renderIcon(size, shrink) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      let glow = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          // map full icon -> design box (shrink < 1 for maskable safe zone)
          const u = 0.5 + (px - 0.5) / shrink;
          const v = 0.5 + (py - 0.5) / shrink;
          if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) continue;
          const sd = glyphSd(u, v); // unit
          const sdPx = sd * size;
          if (sdPx < 0) {
            inside += 1;
          } else {
            glow += 0.55 * Math.exp(-sdPx / (size * 0.035));
          }
        }
      }
      const n = SS * SS;
      const iIn = inside / n;
      const iGl = Math.min(1, glow / n);
      const i = (y * size + x) * 4;
      rgba[i] = Math.min(255, Math.round(GREEN[0] * (iIn + iGl)));
      rgba[i + 1] = Math.min(255, Math.round(GREEN[1] * (iIn + iGl)));
      rgba[i + 2] = Math.min(255, Math.round(GREEN[2] * (iIn + iGl)));
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

/* ----------------------------------------------------------------- main ---- */

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.8],
];

for (const [name, size, shrink] of jobs) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, renderIcon(size, shrink));
  console.log("wrote", path.relative(process.cwd(), file), size + "x" + size);
}
