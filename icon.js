const { nativeImage } = require('electron');

const SIZE = 32;

function inCircle(x, y) {
  const c = (SIZE - 1) / 2;
  const r = SIZE / 2 - 1;
  return (x - c) ** 2 + (y - c) ** 2 <= r * r;
}

// Segitiga "play" menghadap kanan
function inPlayTriangle(x, y) {
  const left = 12, right = 23, cy = 15.5, halfAtLeft = 6;
  if (x < left || x > right) return false;
  const half = (halfAtLeft * (right - x)) / (right - left);
  return Math.abs(y - cy) <= half + 0.5;
}

// Dua bar vertikal "pause"
function inPauseBars(x, y) {
  const inBar = (x >= 11 && x <= 14) || (x >= 18 && x <= 21);
  return inBar && y >= 10 && y <= 22;
}

function buildIcon(shape) {
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!inCircle(x, y)) continue; // alpha 0 (transparan)

      const isShape = shape === 'play' ? inPlayTriangle(x, y) : inPauseBars(x, y);
      if (isShape) {
        // Putih (BGRA)
        buffer[i] = 255; buffer[i + 1] = 255; buffer[i + 2] = 255; buffer[i + 3] = 255;
      } else {
        // Merah YouTube (BGRA)
        buffer[i] = 0; buffer[i + 1] = 0; buffer[i + 2] = 255; buffer[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: SIZE, height: SIZE });
}

module.exports = {
  createPlayIcon: () => buildIcon('play'),
  createPauseIcon: () => buildIcon('pause'),
};