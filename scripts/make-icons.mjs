// Generates the desktop app's icons procedurally — no image tooling required.
// A hextech-style gold diamond (ring + center stone) in the app's palette:
//
//   node scripts/make-icons.mjs
//
//   electron/assets/icon.png   256x256, dark rounded tile   (window icon)
//   electron/assets/tray.png    32x32, transparent backdrop (tray icon)
//   build/icon.ico             256x256 PNG-in-ICO           (installer/exe icon)
//
// The PNG encoder below writes the minimal valid file (IHDR + one IDAT + IEND,
// RGBA8, filter 0). The .ico is a 22-byte header wrapping the PNG — Windows
// accepts PNG-compressed ICO entries since Vista.
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- Minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // Each scanline is prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  // width/height bytes 0 = 256
  header.writeUInt16LE(1, 10); // color planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // image data offset
  return Buffer.concat([header, png]);
}

// ---- The emblem -------------------------------------------------------------
// Palette from public/styles.css: near-black tile, hextech gold gradient.

const BG = [10, 20, 32]; // #0a1420
const GOLD_LIGHT = [240, 230, 210]; // #f0e6d2
const GOLD_DEEP = [160, 131, 57]; // #a08339

const lerp = (a, b, t) => a + (b - a) * t;

// Color at a sample point (u, v in 0..1), or null for transparent.
// The emblem is a diamond ring plus a center stone, both in a vertical gold
// gradient. `tile` adds the dark rounded-square backdrop for the window icon;
// the tray icon stays transparent so it reads on any taskbar.
function sample(u, v, tile) {
  const d = Math.abs(u - 0.5) + Math.abs(v - 0.5); // L1 distance = diamond contours
  const gold = [0, 1, 2].map((i) => Math.round(lerp(GOLD_LIGHT[i], GOLD_DEEP[i], v)));
  if ((d <= 0.36 && d >= 0.24) || d <= 0.11) return [...gold, 255];
  if (!tile) return null;
  // Rounded-square tile: inside test against a rect with corner radius 0.09.
  const r = 0.09;
  const cx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const cy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return Math.hypot(cx, cy) <= r ? [...BG, 255] : null;
}

function render(size, tile) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, tile);
          if (!px) continue;
          rSum += px[0]; gSum += px[1]; bSum += px[2]; aSum += px[3];
        }
      }
      const i = (y * size + x) * 4;
      if (aSum === 0) continue;
      const covered = aSum / 255; // number of opaque subsamples
      rgba[i] = Math.round(rSum / covered);
      rgba[i + 1] = Math.round(gSum / covered);
      rgba[i + 2] = Math.round(bSum / covered);
      rgba[i + 3] = Math.round(aSum / (SS * SS));
    }
  }
  return encodePng(size, rgba);
}

const icon256 = render(256, true);
const tray32 = render(32, false);

for (const [rel, data] of [
  ['electron/assets/icon.png', icon256],
  ['electron/assets/tray.png', tray32],
  ['build/icon.ico', encodeIco(icon256)],
]) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
}
