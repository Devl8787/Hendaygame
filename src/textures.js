import * as THREE from 'three';

// Textures painted in code (no downloads, nothing to license): asphalt,
// grass detail, concrete, and lit office windows. Each returns null when
// there's no DOM (e.g. in tests), and materials simply go without.

const cache = new Map();

function canvasTexture(key, size, paint, { repeat = true, colour = true } = {}) {
  if (typeof document === 'undefined') return null;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size, seeded(key.length * 7919));
  const texture = new THREE.CanvasTexture(canvas);
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (colour) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

// Speckled grain: lots of tiny light and dark dots.
function speckle(ctx, size, rand, count, alpha, light = 255, dark = 0) {
  for (let i = 0; i < count; i++) {
    const v = rand() < 0.5 ? dark : light;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    const s = rand() < 0.9 ? 1 : 2;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
}

// Asphalt for the Henday: one tile spans the full road width (u across,
// 0 = median-side edge) and the same distance along the road. Grain, wheel
// tracks in each lane, cracks and the odd patch.
export function asphaltTexture() {
  return canvasTexture('asphalt', 512, (ctx, size, rand) => {
    ctx.fillStyle = '#7b7d80';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, rand, 60000, 0.35);
    // Darker wheel tracks: two per lane, 3 lanes over ~76% of the width
    // (the rest is shoulders: 1 m on the median side, 2.5 m on the right).
    const laneStart = 0.07;
    const lane = 0.253;
    for (let l = 0; l < 3; l++) {
      for (const t of [0.28, 0.72]) {
        const x = (laneStart + lane * (l + t)) * size;
        const g = ctx.createLinearGradient(x - 18, 0, x + 18, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 18, 0, 36, size);
      }
    }
    // Patched rectangles of newer, darker asphalt.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(20,20,22,${0.15 + rand() * 0.15})`;
      const w = 40 + rand() * 120;
      const h = 30 + rand() * 160;
      ctx.fillRect(rand() * (size - w), rand() * (size - h), w, h);
    }
    // Cracks: wandering dark lines.
    ctx.strokeStyle = 'rgba(15,15,15,0.55)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 0.8 + rand() * 1.4;
      let x = rand() * size;
      let y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const heading = rand() * Math.PI * 2;
      for (let k = 0; k < 14; k++) {
        const a = heading + (rand() - 0.5) * 1.6;
        x += Math.cos(a) * (6 + rand() * 10);
        y += Math.sin(a) * (6 + rand() * 10);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

// Fine grass detail, multiplied over the ground's colours.
export function grassTexture() {
  return canvasTexture('grass', 256, (ctx, size, rand) => {
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, size, size);
    // Soft blotches, then blades.
    for (let i = 0; i < 70; i++) {
      const v = 170 + rand() * 85;
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 6 + rand() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 5000; i++) {
      const v = rand() < 0.5 ? 255 : 120;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 * rand()})`;
      ctx.lineWidth = 1;
      const x = rand() * size;
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
      ctx.stroke();
    }
  });
}

// Weathered concrete: grain plus faint water stains running down.
export function concreteTexture() {
  return canvasTexture('concrete', 256, (ctx, size, rand) => {
    ctx.fillStyle = '#c4c1b8';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, rand, 9000, 0.25);
    for (let i = 0; i < 10; i++) {
      const x = rand() * size;
      const w = 4 + rand() * 18;
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, 'rgba(60,55,50,0.18)');
      g.addColorStop(1, 'rgba(60,55,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, size * (0.3 + rand() * 0.7));
    }
  });
}

// Office tower windows: a grid, some lit. Used as both colour and glow.
export function windowsTexture() {
  return canvasTexture('windows', 256, (ctx, size, rand) => {
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(0, 0, size, size);
    const cols = 8;
    const rows = 16;
    const w = size / cols;
    const h = size / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rand() < 0.35;
        ctx.fillStyle = lit ? `rgba(255,${215 + rand() * 30},${150 + rand() * 50},0.9)` : `rgba(140,170,200,${0.25 + rand() * 0.2})`;
        ctx.fillRect(c * w + 3, r * h + 3, w - 6, h - 5);
      }
    }
  });
}

// Small deterministic random generator so textures look the same each time.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
