// ---------------------------------------------------------------------------
// Small math + random helpers shared by the whole game.
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInCubic = (t) => Math.pow(clamp(t, 0, 1), 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t, s = 1.7) => {
  t = clamp(t, 0, 1) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};
export const expDamp = (cur, target, lambda, dt) =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;

/** Deterministic pseudo random generator (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a2, b2) => a2 + rng() * (b2 - a2);
  rng.int = (a2, b2) => Math.floor(a2 + rng() * (b2 - a2 + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  return rng;
}

/** Stable hash based value noise, handy for cheap wind / flicker curves. */
export function hash11(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

/** Cheap 2D value noise in [0,1]. */
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash11(xi + yi * 57.0);
  const b = hash11(xi + 1 + yi * 57.0);
  const c = hash11(xi + (yi + 1) * 57.0);
  const d = hash11(xi + 1 + (yi + 1) * 57.0);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Frames-per-second independent shake helper. */
export class Spring {
  constructor(value = 0, stiffness = 120, damping = 14) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  impulse(v) {
    this.vel += v;
  }
  update(dt) {
    const a = (this.target - this.value) * this.stiffness - this.vel * this.damping;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
  reset(v = 0) {
    this.value = v;
    this.target = v;
    this.vel = 0;
  }
}
