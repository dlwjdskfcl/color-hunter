// 앱 아이콘 PNG 생성 (의존성 없음): node scripts/make-icons.mjs
// 로고(뷰파인더 + 네 색 조각)를 도형으로 직접 그려 public/ 에 저장
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const INK = [27, 20, 51];
const PAPER = [255, 247, 234];
const COLORS = { tr: [255, 90, 78], br: [61, 165, 255], bl: [43, 196, 138], tl: [255, 201, 60] };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const CORNERS = [
  [6, 20, 6, 6], [6, 6, 20, 6],
  [44, 6, 58, 6], [58, 6, 58, 20],
  [58, 44, 58, 58], [58, 58, 44, 58],
  [20, 58, 6, 58], [6, 58, 6, 44],
];

/** 64 단위 좌표의 한 점 색 (null = 배경) */
function logoAt(x, y) {
  const dx = x - 32;
  const dy = y - 32;
  const d = Math.hypot(dx, dy);
  if (d <= 3) return [255, 255, 255];
  if (d <= 6) return INK;
  if (d <= 15.5) {
    if (Math.abs(dx) < 1.5 || Math.abs(dy) < 1.5) return INK;
    return dx >= 0 ? (dy < 0 ? COLORS.tr : COLORS.br) : dy >= 0 ? COLORS.bl : COLORS.tl;
  }
  if (d <= 18.5) return INK;
  for (const [ax, ay, bx, by] of CORNERS) if (segDist(x, y, ax, ay, bx, by) <= 2.5) return INK;
  return null;
}

function render(size, { maskable, rounded }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  const scale = maskable ? 0.72 : 0.86; // maskable 은 안전 영역(가운데 80%) 안에
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size; // 0~1
          const v = (py + (sy + 0.5) / SS) / size;
          // 배경: 둥근 사각형(일반) 또는 꽉 찬 사각형(maskable)
          let inside = true;
          if (rounded) {
            const R = 0.22;
            const qx = Math.max(Math.abs(u - 0.5) - (0.5 - R), 0);
            const qy = Math.max(Math.abs(v - 0.5) - (0.5 - R), 0);
            inside = Math.hypot(qx, qy) <= R;
          }
          if (!inside) continue;
          const lx = ((u - 0.5) / scale) * 64 + 32;
          const ly = ((v - 0.5) / scale) * 64 + 32;
          const c = logoAt(lx, ly) ?? PAPER;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      const cov = a / 255;
      buf[o] = cov ? Math.round(r / cov) : 0;
      buf[o + 1] = cov ? Math.round(g / cov) : 0;
      buf[o + 2] = cov ? Math.round(b / cov) : 0;
      buf[o + 3] = Math.round(a / n);
    }
  }
  return png(size, buf);
}

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
writeFileSync(out('icon-192.png'), render(192, { rounded: true }));
writeFileSync(out('icon-512.png'), render(512, { rounded: true }));
writeFileSync(out('icon-maskable-512.png'), render(512, { maskable: true }));
writeFileSync(out('apple-touch-icon.png'), render(180, {}));
writeFileSync(out('favicon.png'), render(64, { rounded: true }));
console.log('icons written');
