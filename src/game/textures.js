// ---------------------------------------------------------------------------
// Procedural texture factory. Anything that benefits from fine detail (cracks,
// soot, impact rings, sparks) is drawn to a canvas at boot so the game needs
// only the two big photographic plates shipped in assets/tex.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { makeRng } from '../core/mathx.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texFromCanvas(canvas, { repeat = 1, srgb = true, aniso = 4, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- road -------

export function makeRoadTexture(size = 512, seed = 7) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = '#2b2b30';
  g.fillRect(0, 0, size, size);

  // asphalt grain
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 46;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.1));
  }
  g.putImageData(img, 0, 0);

  // large stains
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * size * 0.22 + 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() > 0.45;
    grd.addColorStop(0, dark ? 'rgba(12,12,16,0.4)' : 'rgba(120,112,100,0.14)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // cracks
  g.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    let x = rng() * size;
    let y = rng() * size;
    let a = rng() * Math.PI * 2;
    g.strokeStyle = rng() > 0.5 ? 'rgba(8,8,12,0.75)' : 'rgba(90,90,100,0.4)';
    g.lineWidth = rng() * 2 + 0.5;
    g.beginPath();
    g.moveTo(x, y);
    const segs = 6 + Math.floor(rng() * 10);
    for (let s = 0; s < segs; s++) {
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a) * (6 + rng() * 22);
      y += Math.sin(a) * (6 + rng() * 22);
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // rubble specks
  for (let i = 0; i < 900; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 2.2 + 0.4;
    const v = 60 + rng() * 110;
    g.fillStyle = `rgba(${v},${v * 0.97},${v * 0.9},${0.25 + rng() * 0.5})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c, { repeat: 1 });
}

export function makeRubbleFieldTexture(size = 512, seed = 21) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = '#33302e';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 5 + 0.6;
    const v = 38 + rng() * 95;
    g.fillStyle = `rgba(${v},${v * 0.96},${v * 0.9},${0.35 + rng() * 0.6})`;
    g.beginPath();
    // chunky pebbles
    const sides = 3 + Math.floor(rng() * 3);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + rng();
      const rr = r * (0.6 + rng() * 0.6);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  // dust patches
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 60 + 18;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(120,105,90,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c, { repeat: 1 });
}

export function makeCrateTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(11);
  // planks
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const y = (i / planks) * size;
    const h = size / planks;
    const base = 132 + rng() * 34;
    g.fillStyle = `rgb(${base},${base * 0.72},${base * 0.43})`;
    g.fillRect(0, y, size, h - 1);
    // grain lines
    for (let k = 0; k < 22; k++) {
      const yy = y + rng() * h;
      g.strokeStyle = `rgba(${60 + rng() * 40},${40 + rng() * 25},${18},${0.15 + rng() * 0.25})`;
      g.lineWidth = rng() * 1.6 + 0.3;
      g.beginPath();
      g.moveTo(0, yy);
      for (let x = 0; x <= size; x += 16) g.lineTo(x, yy + Math.sin(x * 0.04 + i) * 2.2 + (rng() - 0.5) * 1.6);
      g.stroke();
    }
    // shadow gap between planks
    g.fillStyle = 'rgba(20,12,6,0.65)';
    g.fillRect(0, y + h - 2, size, 2);
  }
  // frame + diagonal brace
  g.strokeStyle = 'rgba(66,42,22,0.95)';
  g.lineWidth = size * 0.075;
  g.strokeRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92);
  g.beginPath();
  g.moveTo(size * 0.1, size * 0.12);
  g.lineTo(size * 0.9, size * 0.88);
  g.moveTo(size * 0.9, size * 0.12);
  g.lineTo(size * 0.1, size * 0.88);
  g.stroke();
  // nails
  g.fillStyle = 'rgba(30,30,34,0.9)';
  for (const [x, y] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.1], [0.5, 0.9]]) {
    g.beginPath();
    g.arc(x * size, y * size, size * 0.012, 0, Math.PI * 2);
    g.fill();
  }
  // grime
  for (let i = 0; i < 30; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 40 + 4;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(30,20,10,0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c);
}

export function makeRockTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(33);
  g.fillStyle = '#6b6a68';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 58;
    d[i] += n;
    d[i + 1] += n * 0.98;
    d[i + 2] += n * 0.93;
  }
  g.putImageData(img, 0, 0);
  // mottling
  for (let i = 0; i < 220; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 26 + 3;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rng() > 0.5 ? 150 : 60;
    grd.addColorStop(0, `rgba(${v},${v},${v * 0.96},${0.15 + rng() * 0.2})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // fissures
  g.strokeStyle = 'rgba(34,32,30,0.8)';
  for (let i = 0; i < 16; i++) {
    let x = rng() * size;
    let y = rng() * size;
    let a = rng() * Math.PI * 2;
    g.lineWidth = rng() * 2 + 0.6;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      a += (rng() - 0.5) * 1.4;
      x += Math.cos(a) * (5 + rng() * 14);
      y += Math.sin(a) * (5 + rng() * 14);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return texFromCanvas(c);
}

/** A metal plate used for rockets / barriers / hazards. */
export function makeMetalTexture(size = 256, tint = '#5a616b') {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(57);
  g.fillStyle = tint;
  g.fillRect(0, 0, size, size);
  // brushed streaks
  for (let i = 0; i < 420; i++) {
    const y = rng() * size;
    g.strokeStyle = `rgba(${rng() > 0.5 ? 255 : 0},${rng() > 0.5 ? 255 : 0},255,${rng() * 0.05})`;
    g.lineWidth = rng() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y + (rng() - 0.5) * 6);
    g.stroke();
  }
  // rivets
  for (let i = 0; i < 12; i++) {
    const x = (i % 4) * (size / 4) + size / 8;
    const y = Math.floor(i / 4) * (size / 3) + size / 6;
    g.fillStyle = 'rgba(200,205,215,0.35)';
    g.beginPath();
    g.arc(x, y, size * 0.012, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(10,10,14,0.45)';
    g.beginPath();
    g.arc(x + 1, y + 1.5, size * 0.012, 0, Math.PI * 2);
    g.fill();
  }
  // rust patches
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 24 + 4;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${120 + rng() * 40},${58 + rng() * 30},${20},${0.2 + rng() * 0.25})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c);
}

/** Radial soft glow used by particles & coin sparkles. */
export function makeGlowTexture(size = 128, color = '255,255,255') {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${color},1)`);
  grd.addColorStop(0.35, `rgba(${color},0.55)`);
  grd.addColorStop(0.75, `rgba(${color},0.12)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** Irregular puffy smoke puff with alpha falloff. */
export function makeSmokeTexture(size = 128, seed = 5) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = size / 2 + (rng() - 0.5) * size * 0.42;
    const y = size / 2 + (rng() - 0.5) * size * 0.42;
    const r = size * (0.16 + rng() * 0.24);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${0.16 + rng() * 0.2})`);
    grd.addColorStop(0.6, `rgba(255,255,255,${0.06 + rng() * 0.08})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** Ring shockwave used for smash impacts. */
export function makeShockwaveTexture(size = 256, color = '255,236,200') {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${color},0)`);
  grd.addColorStop(0.55, `rgba(${color},0.16)`);
  grd.addColorStop(0.82, `rgba(${color},0.95)`);
  grd.addColorStop(0.95, `rgba(${color},0.25)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** Star sprite for the collectible. */
export function makeStarTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.25, 'rgba(255,214,90,0.85)');
  grd.addColorStop(0.55, 'rgba(255,150,40,0.25)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,235,0.95)';
  g.beginPath();
  const spikes = 5;
  const outer = size * 0.34;
  const inner = size * 0.14;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** Window / facade luminance map for buildings. */
export function makeFacadeTexture(size = 256, seed = 3) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = '#6d6a66';
  g.fillRect(0, 0, size, size);
  const cols = 4;
  const rows = 5;
  const mw = size / cols;
  const mh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = cI * mw + mw * 0.18;
      const y = r * mh + mh * 0.16;
      const w = mw * 0.64;
      const h = mh * 0.6;
      const broken = rng() > 0.62;
      if (broken) {
        g.fillStyle = `rgba(${12 + rng() * 16},${12 + rng() * 14},${16 + rng() * 16},1)`;
        g.fillRect(x, y, w, h);
        // jagged shard
        g.strokeStyle = 'rgba(120,120,120,0.5)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, y + h * rng());
        g.lineTo(x + w * rng(), y + h * rng());
        g.stroke();
      } else {
        g.fillStyle = `rgba(${40 + rng() * 20},${46 + rng() * 20},${52 + rng() * 24},1)`;
        g.fillRect(x, y, w, h);
        const gg = g.createLinearGradient(x, y, x + w, y + h);
        gg.addColorStop(0, 'rgba(190,215,255,0.22)');
        gg.addColorStop(0.5, 'rgba(90,110,140,0.1)');
        gg.addColorStop(1, 'rgba(10,10,16,0.35)');
        g.fillStyle = gg;
        g.fillRect(x, y, w, h);
      }
      g.strokeStyle = 'rgba(30,28,26,0.55)';
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);
    }
  }
  // concrete noise + soot streaks
  for (let i = 0; i < 240; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 18 + 1;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${20 + rng() * 40},${18 + rng() * 34},${16 + rng() * 30},${0.05 + rng() * 0.14})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 16; i++) {
    const x = rng() * size;
    g.fillStyle = `rgba(10,10,12,${0.04 + rng() * 0.09})`;
    g.fillRect(x, 0, 2 + rng() * 12, size);
  }
  return texFromCanvas(c);
}

/** Yellow/black hazard chevrons for the roadside barriers. */
export function makeHazardTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#d8b32c';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#1b1b1e';
  g.lineWidth = size * 0.16;
  for (let i = -2; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * size * 0.25, 0);
    g.lineTo(i * size * 0.25 + size * 0.5, size);
    g.stroke();
  }
  // grime + scratches
  const rng = makeRng(71);
  for (let i = 0; i < 120; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 16 + 1;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(40,34,20,${0.1 + rng() * 0.3})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return texFromCanvas(c);
}

/** Vertical tongue of flame used by the burning-ground hazard. */
export function makeFlameTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  // outer body
  const body = g.createLinearGradient(0, size, 0, 0);
  body.addColorStop(0, 'rgba(255,90,10,0.95)');
  body.addColorStop(0.35, 'rgba(255,150,30,0.9)');
  body.addColorStop(0.7, 'rgba(255,220,90,0.55)');
  body.addColorStop(1, 'rgba(255,255,220,0)');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx, size * 0.04);
  g.bezierCurveTo(cx + size * 0.30, size * 0.34, cx + size * 0.34, size * 0.62, cx + size * 0.20, size * 0.94);
  g.lineTo(cx - size * 0.20, size * 0.94);
  g.bezierCurveTo(cx - size * 0.34, size * 0.62, cx - size * 0.30, size * 0.34, cx, size * 0.04);
  g.closePath();
  g.fill();
  // hot core
  const core = g.createLinearGradient(0, size, 0, size * 0.25);
  core.addColorStop(0, 'rgba(255,244,200,1)');
  core.addColorStop(0.5, 'rgba(255,210,110,0.8)');
  core.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = core;
  g.beginPath();
  g.moveTo(cx, size * 0.24);
  g.bezierCurveTo(cx + size * 0.16, size * 0.5, cx + size * 0.17, size * 0.72, cx + size * 0.10, size * 0.95);
  g.lineTo(cx - size * 0.10, size * 0.95);
  g.bezierCurveTo(cx - size * 0.17, size * 0.72, cx - size * 0.16, size * 0.5, cx, size * 0.24);
  g.closePath();
  g.fill();
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}

export function makeCoinTexture(size = 256) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.44;
  const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  grd.addColorStop(0, '#fff6c4');
  grd.addColorStop(0.35, '#ffd23f');
  grd.addColorStop(0.75, '#e39a12');
  grd.addColorStop(1, '#8a5a05');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,246,190,0.75)';
  g.lineWidth = size * 0.035;
  g.beginPath();
  g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  g.stroke();
  // embossed H
  g.fillStyle = 'rgba(120,72,4,0.55)';
  g.font = `bold ${size * 0.52}px Impact, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', cx, cy + size * 0.03);
  g.fillStyle = 'rgba(255,246,190,0.6)';
  g.fillText('H', cx, cy);
  // highlight
  const hl = g.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.2);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  hl.addColorStop(1, 'rgba(0,0,0,0.15)');
  g.fillStyle = hl;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  return texFromCanvas(c, { wrap: THREE.ClampToEdgeWrapping });
}
