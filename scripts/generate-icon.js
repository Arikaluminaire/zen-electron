const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;

/* ---------- CRC32 untuk chunk PNG ---------- */
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
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/* ---------- Gambar ikon (lingkaran merah + segitiga play) ---------- */
function drawPixels(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // filter byte + RGBA
  const c = (size - 1) / 2;
  const r = size / 2 - size * 0.03;
  const left = size * 0.375, right = size * 0.72, halfL = size * 0.19;

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      const inside = (x - c) ** 2 + (y - c) ** 2 <= r * r;
      if (!inside) continue; // transparan

      let isPlay = false;
      if (x >= left && x <= right) {
        const half = (halfL * (right - x)) / (right - left);
        isPlay = Math.abs(y - c) <= half + size * 0.015;
      }

      if (isPlay) {
        raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; // putih
      } else {
        raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0;      // merah
      }
      raw[o + 3] = 255;
    }
  }
  return raw;
}

function buildPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  const idat = zlib.deflateSync(drawPixels(size));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Bungkus PNG menjadi ICO (PNG-in-ICO, didukung Windows) ---------- */
function buildIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 0 = 256px
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

/* ---------- Eksekusi ---------- */
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const png = buildPng(SIZE);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(png));

console.log('✅ build/icon.png & build/icon.ico berhasil dibuat');