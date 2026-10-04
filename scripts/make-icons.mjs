// アプリアイコン（鍵穴）を PNG で生成する。外部ツール不要。
// 使い方: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [36, 86, 214];
const FG = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// 0..1 の座標で、鍵穴の内側なら true
function inKeyhole(x, y) {
  const cx = 0.5, cy = 0.42, r = 0.15;
  if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  // 下に広がる台形
  if (y >= cy && y <= 0.74) {
    const t = (y - cy) / (0.74 - cy);
    const half = 0.055 + t * 0.06;
    return Math.abs(x - cx) <= half;
  }
  return false;
}

function render(size) {
  const ss = 4; // 4x4 のスーパーサンプリングで縁を滑らかにする
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          if (inKeyhole((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hit++;
      const a = hit / (ss * ss);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size));
  console.log(`public/${name}`);
}
