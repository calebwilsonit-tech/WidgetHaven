// Writes build/icon.png (512×512) — the same violet→cyan "2×2 tiles" logo the app draws at runtime.
// electron-builder turns it into the .ico used for the installer, shortcuts and the taskbar.
// Run: npm run icon
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function logoRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.24;
  const inRound = (x, y, x0, y0, x1, y1, rad) => {
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad), cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  const pad = size * 0.25, gap = size * 0.07, cell = (size - pad * 2 - gap) / 2;
  const SS = 4; // 4×4 supersampling for smooth edges
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let R = 0, G = 0, B = 0, A = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      if (!inRound(px, py, 0, 0, size, size, r)) continue;
      const t = (px + py) / (2 * size);
      let cr = 139 + (34 - 139) * t, cg = 92 + (211 - 92) * t, cb = 246 + (238 - 246) * t;
      for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
        const x0 = pad + cx * (cell + gap), y0 = pad + cy * (cell + gap);
        if (inRound(px, py, x0, y0, x0 + cell, y0 + cell, cell * 0.28)) {
          const a = cx === 1 && cy === 1 ? 0.55 : 0.95;
          cr += (255 - cr) * a; cg += (255 - cg) * a; cb += (255 - cb) * a;
        }
      }
      R += cr; G += cg; B += cb; A += 1;
    }
    const i = (y * size + x) * 4, n = SS * SS;
    if (A) { buf[i] = R / A; buf[i + 1] = G / A; buf[i + 2] = B / A; buf[i + 3] = Math.round((A / n) * 255); }
  }
  return buf;
}

function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png(512, logoRGBA(512)));
console.log('wrote', out);
