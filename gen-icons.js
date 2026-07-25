const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setPx(rgba, width, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 3 >= rgba.length) return;
  const srcA = a / 255;
  rgba[i] = rgba[i] * (1 - srcA) + r * srcA;
  rgba[i + 1] = rgba[i + 1] * (1 - srcA) + g * srcA;
  rgba[i + 2] = rgba[i + 2] * (1 - srcA) + b * srcA;
  rgba[i + 3] = 255;
}

function fillRoundedRect(rgba, width, height, r, color) {
  const [cr, cg, cb] = color;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = true;
      if (r > 0) {
        let cx = null, cy = null;
        if (x < r && y < r) { cx = r; cy = r; }
        else if (x > width - r && y < r) { cx = width - r; cy = r; }
        else if (x < r && y > height - r) { cx = r; cy = height - r; }
        else if (x > width - r && y > height - r) { cx = width - r; cy = height - r; }
        if (cx !== null) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          inside = d <= r;
        }
      }
      if (inside) setPx(rgba, width, x, y, cr, cg, cb, 255);
    }
  }
}

function fillRectRounded(rgba, width, x0, y0, w, h, color, radius = 0) {
  const [r, g, b] = color;
  const x1 = x0 + w, y1 = y0 + h;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      let inside = true;
      if (radius > 0) {
        let cx = null, cy = null;
        if (x < x0 + radius && y < y0 + radius) { cx = x0 + radius; cy = y0 + radius; }
        else if (x > x1 - radius && y < y0 + radius) { cx = x1 - radius; cy = y0 + radius; }
        else if (x < x0 + radius && y > y1 - radius) { cx = x0 + radius; cy = y1 - radius; }
        else if (x > x1 - radius && y > y1 - radius) { cx = x1 - radius; cy = y1 - radius; }
        if (cx !== null) inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius;
      }
      if (inside) setPx(rgba, width, x, y, r, g, b, 255);
    }
  }
}

function drawCornerBrackets(rgba, width, size, cx, cy, half, arm, thick, color, radius) {
  const corners = [
    [cx - half, cy - half, 1, 1],
    [cx + half, cy - half, -1, 1],
    [cx - half, cy + half, 1, -1],
    [cx + half, cy + half, -1, -1],
  ];
  corners.forEach(([px, py, sx, sy]) => {
    const hx0 = sx > 0 ? px : px - arm;
    const hy0 = py - thick / 2;
    fillRectRounded(rgba, width, hx0, hy0, arm, thick, color, radius);
    const vx0 = px - thick / 2;
    const vy0 = sy > 0 ? py : py - arm;
    fillRectRounded(rgba, width, vx0, vy0, thick, arm, color, radius);
  });
}

function drawIcon(size, maskableSafe) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const bg = hexToRgb('#16181C');
  const accent = hexToRgb('#E8A33D');
  const bgRadius = maskableSafe ? 0 : Math.round(size * 0.22);

  fillRoundedRect(rgba, size, size, bgRadius, bg);

  const cx = size / 2;
  const cy = maskableSafe ? size * 0.52 : size * 0.5;
  const half = maskableSafe ? size * 0.19 : size * 0.24;
  const arm = size * (maskableSafe ? 0.12 : 0.15);
  const thick = size * 0.045;
  const radius = thick / 2;

  drawCornerBrackets(rgba, size, size, cx, cy, half, arm, thick, accent, radius);

  const dotR = size * 0.045;
  for (let y = -dotR; y <= dotR; y++) {
    for (let x = -dotR; x <= dotR; x++) {
      if (x * x + y * y <= dotR * dotR) setPx(rgba, size, cx + x, cy + y, accent[0], accent[1], accent[2], 255);
    }
  }

  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), drawIcon(192, false));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), drawIcon(512, false));
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), drawIcon(512, true));
console.log('done');
