const zlib = require('zlib');
const fs = require('fs');

// ---------- SDF helpers ----------
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx, dy = Math.abs(py - cy) - hy;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}
function sdSeg(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}
function sdCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }

const AAW = 0.75; // half-width of AA transition in high-res px
function fillMask(d) { // coverage 1 inside, 0 outside
  if (d <= -AAW) return 1;
  if (d >= AAW) return 0;
  return (AAW - d) / (2 * AAW);
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function over(dst, src) { // src over dst, straight alpha
  const sa = src[3];
  if (sa <= 0) return dst;
  const da = dst[3];
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return [0, 0, 0, 0];
  const r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa;
  const g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa;
  const b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa;
  return [r, g, b, oa];
}

const C_TOP = [79, 172, 254];     // #4FACFE
const C_BOT = [0, 90, 210];       // #005AD2
const WHITE = [255, 255, 255];
const HEADER = [23, 105, 226];    // calendar header band
const CHECK = [0, 90, 210];       // check color (matches bg bottom)

// draws one icon sample in a normalized 0..1 space (256-unit design grid)
function sample(u, v) { // u,v in 0..1 of the 256x256 design
  const x = u * 256, y = v * 256;
  let c = [0, 0, 0, 0];

  // 1) blue rounded square background with vertical gradient
  const dBg = sdRoundRect(x, y, 8, 8, 248, 248, 58);
  const mBg = fillMask(dBg);
  if (mBg > 0) {
    const g = Math.min(1, Math.max(0, y / 256));
    let bg = mix(C_TOP, C_BOT, g);
    // soft light sheen top-left
    const sheen = Math.max(0, 1 - Math.hypot(x - 60, y - 30) / 230) * 0.18;
    bg = mix(bg, [255, 255, 255], sheen);
    c = over(c, [bg[0], bg[1], bg[2], mBg]);
  }

  // 2) calendar rings (behind the card)
  for (const rx of [88, 168]) {
    const d = sdRoundRect(x, y, rx - 6, 50, rx + 6, 96, 6);
    const m = fillMask(d);
    if (m > 0) c = over(c, [WHITE[0], WHITE[1], WHITE[2], m]);
  }

  // 3) calendar card (white)
  const dCard = sdRoundRect(x, y, 46, 74, 210, 206, 22);
  const mCard = fillMask(dCard);
  if (mCard > 0) c = over(c, [WHITE[0], WHITE[1], WHITE[2], mCard]);

  // 4) header band (blue) clipped to the card's top corners
  const dBand = sdRoundRect(x, y, 46, 74, 210, 138, 22);
  const bandMask = fillMask(Math.max(dBand, y - 116));
  if (bandMask > 0 && mCard > 0) c = over(c, [HEADER[0], HEADER[1], HEADER[2], bandMask * mCard]);

  // 5) checkmark inside the card
  const dCheck = Math.min(
    sdSeg(x, y, 78, 158, 112, 190, 11),
    sdSeg(x, y, 112, 190, 178, 134, 11)
  );
  const mCheck = fillMask(dCheck) * mCard;
  if (mCheck > 0) c = over(c, [CHECK[0], CHECK[1], CHECK[2], mCheck]);

  return c;
}

// ---------- renderer with supersampling ----------
function render(size, ss = 4) {
  const W = size * ss;
  const buf = new Float64Array(size * size * 4);
  for (let sy = 0; sy < W; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const c = sample((sx + 0.5) / W, (sy + 0.5) / W);
      const px = (sx / ss) | 0, py = (sy / ss) | 0;
      const i = (py * size + px) * 4;
      const a = c[3];
      buf[i] += c[0] * a; buf[i + 1] += c[1] * a; buf[i + 2] += c[2] * a; buf[i + 3] += a;
    }
  }
  const n = ss * ss;
  const out = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const a = buf[i + 3] / n;
    out[i] = a > 0 ? Math.min(255, Math.round(buf[i] / buf[i + 3])) : 0;
    out[i + 1] = a > 0 ? Math.min(255, Math.round(buf[i + 1] / buf[i + 3])) : 0;
    out[i + 2] = a > 0 ? Math.min(255, Math.round(buf[i + 2] / buf[i + 3])) : 0;
    out[i + 3] = Math.min(255, Math.round(a * 255));
  }
  return out;
}

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO container ----------
function ico(entries) { // entries: [{size, png}]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  const blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8); d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(d); blobs.push(e.png);
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

// ---------- build ----------
const sizes = [16, 32, 48, 64, 128, 256];
const entries = sizes.map(s => ({ size: s, png: png(s, render(s)) }));
fs.writeFileSync('favicon.ico', ico(entries));
fs.writeFileSync('icon-512.png', png(512, render(512)));
console.log('ok: favicon.ico + icon-512.png');
