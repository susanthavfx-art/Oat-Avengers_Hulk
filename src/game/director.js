// ---------------------------------------------------------------------------
// The level "director": decides what to spawn next.
//
// It composes authored *patterns* (coin arcs, crate stacks, barrier walls,
// rocket sweeps, gauntlets) instead of pure random noise, so the endless run
// stays readable and fair while still feeling unpredictable. Every pattern
// guarantees at least one safe lane, and the difficulty curve is driven by the
// distance travelled.
// ---------------------------------------------------------------------------

import { LANES, KIND_ORDER } from './patternKinds.js';
import { makeRng, clamp, lerp } from '../core/mathx.js';

export { LANES };

const PATTERNS = {
  /** A gentle arc of coins down one lane. */
  coinLine: (rng, lane) => {
    const out = [];
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) out.push({ kind: 'coin', lane, z: -i * 2.1 });
    return out;
  },

  /** Coins hopping over a barrier — teaches jump + collect. */
  coinArcOverBarrier: (rng, lane) => {
    const out = [{ kind: 'barrier', lane, z: -4 }];
    const heights = [1.0, 1.9, 2.6, 1.9, 1.0];
    heights.forEach((y, i) => out.push({ kind: 'coin', lane, z: -2.2 + i * 1.5, y }));
    return out;
  },

  /** Smashable crates in a row. */
  crateRow: (rng, lane) => {
    const out = [];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) out.push({ kind: 'crate', lane, z: -i * 1.6 });
    if (rng.chance(0.7)) out.push({ kind: 'rock', lane, z: -n * 1.6 - 1.4 });
    return out;
  },

  /** Crates blocking two lanes, free lane on the third. */
  crateWall: (rng) => {
    const free = rng.int(0, 2);
    const out = [];
    for (let l = 0; l < 3; l++) {
      if (l === free) continue;
      out.push({ kind: 'crate', lane: l, z: -3 });
      if (rng.chance(0.5)) out.push({ kind: 'crate', lane: l, z: -4.2 });
    }
    out.push({ kind: 'coin', lane: free, z: -3 });
    return out;
  },

  /** Tall blockade on one lane, dodge sideways. */
  blockade: (rng, lane) => {
    const out = [{ kind: 'blockade', lane, z: -6 }];
    const safe = (lane + (rng.chance(0.5) ? 1 : 2)) % 3;
    out.push({ kind: 'coin', lane: safe, z: -2 });
    out.push({ kind: 'coin', lane: safe, z: -4 });
    return out;
  },

  /** Rockets sweeping in from the distance. */
  rocketSweep: (rng, lane) => {
    const out = [];
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      out.push({ kind: 'rocket', lane, z: -8 - i * 6, speedMul: 1.45 + i * 0.12 });
    }
    const safe = (lane + 1) % 3;
    out.push({ kind: 'coin', lane: safe, z: -5 });
    return out;
  },

  /** Burning ground across two lanes. */
  firePatch: (rng, lane) => {
    const out = [{ kind: 'fire', lane, z: -5 }];
    if (rng.chance(0.5)) out.push({ kind: 'fire', lane: (lane + 1) % 3, z: -5 });
    out.push({ kind: 'star', lane: (lane + 2) % 3, z: -9, y: 1.4 });
    return out;
  },

  /** Slalom: alternating barriers that force lane changes. */
  slalom: (rng, lane) => {
    const out = [];
    let l = lane;
    // ~11 world units between hurdles keeps a full lane change possible even at
    // top speed (lane slide is 0.16 s, world moves up to 34 u/s)
    for (let i = 0; i < 3; i++) {
      out.push({ kind: 'barrier', lane: l, z: -i * 11 });
      out.push({ kind: 'coin', lane: (l + 1) % 3, z: -i * 11 - 4 });
      l = (l + 1 + rng.int(0, 1)) % 3;
    }
    return out;
  },

  /** Mixed gauntlet for later stages. */
  gauntlet: (rng, lane) => {
    const out = [];
    const safe = rng.int(0, 2);
    out.push({ kind: 'blockade', lane: lane, z: -7 });
    out.push({ kind: 'rocket', lane: (lane + 1) % 3, z: -14, speedMul: 1.6 });
    out.push({ kind: 'crate', lane: (lane + 2) % 3, z: -11 });
    out.push({ kind: 'coin', lane: safe, z: -9 });
    out.push({ kind: 'coin', lane: safe, z: -11 });
    out.push({ kind: 'barrier', lane: safe, z: -19 });
    return out;
  },

  /** Pure reward breather. */
  reward: (rng, lane) => {
    const out = [];
    const l2 = (lane + 1) % 3;
    for (let i = 0; i < 3; i++) {
      out.push({ kind: 'coin', lane, z: -i * 2.4, y: 0.9 });
      out.push({ kind: 'coin', lane: l2, z: -i * 2.4 - 1.2, y: 0.9 });
    }
    if (rng.chance(0.45)) out.push({ kind: 'star', lane, z: -9, y: 1.35 });
    return out;
  },
};

/** Rough meters needed for each pattern so the director can pace itself. */
const PATTERN_LENGTH = {
  coinLine: 14,
  coinArcOverBarrier: 11,
  crateRow: 8,
  crateWall: 7,
  blockade: 9,
  rocketSweep: 16,
  firePatch: 12,
  slalom: 30,
  gauntlet: 26,
  reward: 12,
};

export function createDirector(entities) {
  const rng = makeRng(20260214);
  let lastLane = 1;
  let lastPattern = '';
  let sinceReward = 0;
  let sinceEasy = 0;

  function pickPattern(difficulty) {
    // difficulty 0..1
    const bag = [];
    const push = (name, weight) => {
      if (weight > 0) bag.push({ name, weight });
    };
    push('coinLine', 1.3);
    push('reward', sinceReward > 4 ? 2.2 : 0.4);
    push('crateRow', 1.5);
    push('crateWall', 0.7 + difficulty * 1.2);
    push('coinArcOverBarrier', 1.0 + difficulty * 0.8);
    push('slalom', 0.4 + difficulty * 1.1);
    push('blockade', difficulty > 0.18 ? 0.6 + difficulty * 1.4 : 0);
    push('rocketSweep', difficulty > 0.3 ? 0.8 + difficulty * 1.6 : 0);
    push('firePatch', difficulty > 0.45 ? 0.6 + difficulty * 1.0 : 0);
    push('gauntlet', difficulty > 0.62 ? 0.6 + difficulty * 1.6 : 0);
    // avoid repeating the same pattern too often
    for (const b of bag) if (b.name === lastPattern) b.weight *= 0.35;
    // award the player after a tough streak
    if (sinceEasy > 3) {
      const r = bag.find((b) => b.name === 'reward');
      if (r) r.weight += 2.5;
    }
    const total = bag.reduce((s, b) => s + b.weight, 0);
    let roll = rng() * total;
    for (const b of bag) {
      roll -= b.weight;
      if (roll <= 0) return b.name;
    }
    return 'coinLine';
  }

  /**
   * Spawns the next chunk of content starting `startZ` ahead of the player and
   * returns how many metres of track it consumed.
   */
  function next(difficulty, startZ) {
    const pattern = pickPattern(difficulty);
    const builder = PATTERNS[pattern];
    if (!builder) return { length: 15, pattern };

    // keep a lane continuity so the player is not asked to teleport sideways
    let lane = lastLane;
    if (rng.chance(0.55)) {
      const shift = rng.int(1, 2) * (rng.chance(0.5) ? 1 : -1);
      lane = clamp(lane + shift, 0, 2);
    }
    const items = builder(rng, lane);
    for (const it of items) {
      entities.spawn(it.kind, {
        lane: it.lane,
        z: startZ + (it.z || 0),
        y: it.y,
        speedMul: it.speedMul,
      });
    }
    lastLane = lane;
    lastPattern = pattern;
    sinceReward = pattern === 'reward' ? 0 : sinceReward + 1;
    sinceEasy = ['coinLine', 'reward', 'crateRow'].includes(pattern) ? sinceEasy + 1 : 0;
    const base = PATTERN_LENGTH[pattern] || 14;
    return { length: base * lerp(1.1, 0.82, difficulty) + rng.range(2, 7), pattern };
  }

  return {
    next,
    reset() {
      lastLane = 1;
      lastPattern = '';
      sinceReward = 0;
      sinceEasy = 0;
    },
  };
}

export { KIND_ORDER };
