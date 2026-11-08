// ---------------------------------------------------------------------------
// Central tuning table + lane geometry. Everything the designer might want to
// tweak lives here so the other modules stay about behaviour, not magic numbers.
// ---------------------------------------------------------------------------

export const LANES = [-2.35, 0, 2.35];
export const LANE_COUNT = LANES.length;

export const PLAYER = {
  radius: 0.52,
  halfDepth: 0.55,
  laneSwitchTime: 0.16, // seconds to slide between lanes
  gravity: -34,
  jumpVelocity: 12.2,
  jumpMinHold: 0.78, // releasing jump early still guarantees this much arc
  jumpBuffer: 0.16,
  coyoteTime: 0.09,
  fastFallGravity: -52,
  smashDuration: 0.62, // full attack animation is 2.04s, we use a slice
  smashRate: 0.46, // delay between chained smash swings
  smashHitStart: 0.1,
  smashHitEnd: 0.34,
  reelDuration: 0.55, // stagger when clipping a heavy hazard
  invulnerableAfterHit: 1.15,
  sidewaysDodge: 0.9, // extra lane-shift punch when dodging a rocket
};

export const SPEED = {
  start: 15.5,
  max: 31,
  rampPerSecond: 0.26, // passive acceleration over the run
  rampPerMeter: 0.0016,
  boost: 3.4,
  slowSpeed: 0.52, // multiplier while tripping / recovering
};

export const SCORE = {
  coin: 12,
  star: 65,
  woodCrate: 35,
  rock: 55,
  barrierJump: 18,
  nearMiss: 22,
  distancePerMeter: 0.9,
  comboWindow: 2.4,
  comboStep: 0.08,
  comboMax: 12,
};

export const SPAWN = {
  horizon: -150, // where objects appear (ahead of the camera looking -Z)
  despawnBehind: 34, // behind the player (positive Z) before recycling
  minGap: 15,
  gapJitter: 12,
};

export const DIFFICULTY_STAGES = [
  { at: 0, speed: 0.0, note: 'calm street' },
  { at: 260, speed: 0.08, note: 'first rocks' },
  { at: 700, speed: 0.16, note: 'rocket drones' },
  { at: 1350, speed: 0.28, note: 'blockade walls' },
  { at: 2100, speed: 0.42, note: 'gauntlet' },
  { at: 3000, speed: 0.6, note: 'maximum smash' },
];

export const RENDER = {
  fogColor: 0x2a2536,
  fogNear: 60,
  fogFar: 260,
  cameraFov: 62,
  cameraHeight: 3.05,
  cameraDistance: 6.1,
  cameraLookAhead: -6.5,
  cameraLookHeight: 1.5,
  cameraLateral: 0.46,
  shadowMapSize: 1024,
};

export const NO_ANIMATION = 'Armature|hero_hulk01_S09@dash';
export const ATTACK_ANIMATION = 'Armature|hero_hulk01_S09@atk01';
export const UPPERCUT_ANIMATION = 'Armature|hero_hulk01_S09@atk02';
export const HEAVY_ANIMATION = 'Armature|hero_hulk01_S09@skill04';
