// ---------------------------------------------------------------------------
// Game orchestration: state machine, physics, collisions, scoring, spawning,
// camera work and the frame loop. Everything else is a collaborator.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  PLAYER, SPEED, SCORE, SPAWN, DIFFICULTY_STAGES, LANES, RENDER,
} from './config.js';
import { createRenderer, createScene, createLighting, CameraRig } from './renderer.js';
import { createWorld } from './world.js';
import { Hero, HERO_HEIGHT } from './hero.js';
import { createEntities, KIND } from './entities.js';
import { createParticles } from './particles.js';
import { createDirector } from './director.js';
import { createHud } from '../ui/hud.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import {
  clamp, lerp, expDamp, smoothstep, makeRng,
} from '../core/mathx.js';

const STATE = {
  LOADING: 'loading',
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  OVER: 'over',
  DYING: 'dying',
};

const BEST_KEY = 'hulk-smash-run.best';

/**
 * Quality tiers. `low` keeps the game playable on integrated GPUs and in
 * software renderers; `auto` picks based on the renderer string / screen size.
 */
export function resolveQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  if (q === 'auto' || q == null) {
    const gpu = (() => {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return '';
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      } catch { return ''; }
    })();
    if (/swiftshader|software|basic render|llvmpipe/i.test(gpu)) return 'low';
    const small = Math.min(window.innerWidth, window.innerHeight) < 620;
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (mobile || small) return 'medium';
  }
  return 'high';
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = STATE.LOADING;
    this.quality = resolveQuality();
    this.manual = new URLSearchParams(location.search).has('manual');
    this.renderer = createRenderer(canvas, this.quality);
    this.scene = createScene();
    this.lights = createLighting(this.scene, this.quality);
    this.camera = new THREE.PerspectiveCamera(RENDER.cameraFov, 1, 0.1, 700);
    this.rig = new CameraRig(this.camera);
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.hud = createHud();
    this.particles = null;
    this.world = null;
    this.entities = null;
    this.director = null;
    this.hero = null;

    this.clock = new THREE.Clock();
    this.time = 0;
    this.rng = makeRng(777);

    this.score = 0;
    this.best = 0;
    this.coins = 0;
    this.stars = 0;
    this.distance = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.health = 3;
    this.maxHealth = 3;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.reelTimer = 0;
    this.speed = SPEED.start;
    this.speedRatio = 0;
    this.spawnZ = SPAWN.horizon;
    this.stageIndex = 0;
    this.boostTimer = 0;
    this.slowTimer = 0;
    this.paused = false;
    this.muted = false;
    this.laneTarget = 1;
    this.laneX = 0;
    this.laneTween = 1;
    this.laneFrom = 0;
    this.runTime = 0;
    this.lastPassY = 0;

    this._tmpV = new THREE.Vector3();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const maxDpr = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.6 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.rig) {
      const aspect = w / h;
      this.rig.distanceScale = aspect < 0.62 ? 1.55 : aspect < 0.8 ? 1.35 : aspect < 1.05 ? 1.15 : 1;
      this.rig.fovExtra = aspect < 0.8 ? 6 : 0;
    }
  }

  // ---------------------------------------------------------------- boot ----
  async boot() {
    const { hud } = this;
    hud.setLoading(0.05, 'Waking the Hulk…');

    this.world = createWorld(this.scene, { quality: this.quality, anisotropy: this.quality === 'low' ? 1 : this.renderer.capabilities.getMaxAnisotropy() });
    hud.setLoading(0.25, 'Building the ruined city…');

    this.particles = createParticles(this.scene, { quality: this.quality });
    this.entities = createEntities(this.scene, { anisotropy: this.quality === 'low' ? 1 : this.renderer.capabilities.getMaxAnisotropy() });
    this.director = createDirector(this.entities);
    hud.setLoading(0.45, 'Flexing…');

    this.hero = new Hero(this.scene);
    await this.hero.load((p) => hud.setLoading(0.45 + p * 0.45, 'Loading the big guy…'));
    hud.setLoading(0.97, 'Almost there…');

    try {
      this.best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
    } catch {
      this.best = 0;
    }

    // prime the spawner with a calm opening
    this.primeTrack();

    this.state = STATE.READY;
    hud.hideLoading();
    hud.showScreen('screenStart');
    hud.setSoundIcon(false);
    this.bindUi();
    this.renderer.compile(this.scene, this.camera);
    this.loop();
  }

  bindUi() {
    const start = document.getElementById('btn-start');
    const retry = document.getElementById('btn-retry');
    const resume = document.getElementById('btn-resume');
    const quit = document.getElementById('btn-quit');
    const snd = document.getElementById('btn-sound');
    const pause = document.getElementById('btn-pause');

    start?.addEventListener('click', () => this.startRun());
    retry?.addEventListener('click', () => this.startRun());
    resume?.addEventListener('click', () => this.setPaused(false));
    quit?.addEventListener('click', () => {
      this.setPaused(false);
      this.state = STATE.READY;
      this.hud.showScreen('screenStart');
    });
    snd?.addEventListener('click', () => this.toggleMute());
    pause?.addEventListener('click', () => this.setPaused(!this.paused));
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setSoundIcon(this.muted);
  }

  setPaused(p) {
    if (this.state !== STATE.RUNNING && !(this.state === STATE.PAUSED && !p)) return;
    this.paused = p;
    this.state = p ? STATE.PAUSED : STATE.RUNNING;
    this.hud.showScreen(p ? 'screenPause' : null);
    if (p) {
      this.input.reset();
      this.audio.stopMusic(0.4);
    } else {
      this.audio.startMusic();
      this.clock.getDelta();
    }
  }

  // -------------------------------------------------------------- run state --
  startRun() {
    this.audio.init();
    this.audio.startMusic();
    this.audio.setIntensity(0.1);

    this.state = STATE.RUNNING;
    this.paused = false;
    this.score = 0;
    this.coins = 0;
    this.stars = 0;
    this.distance = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.health = this.maxHealth;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.reelTimer = 0;
    this.speed = SPEED.start;
    this.speedRatio = 0;
    this.stageIndex = 0;
    this.boostTimer = 0;
    this.slowTimer = 0;
    this.runTime = 0;
    this.dyingTimer = 0;
    this.laneTarget = 1;
    this.laneX = 0;
    this.laneTween = 1;
    this.laneFrom = 0;

    this.entities.clear();
    this.particles.reset();
    this.director.reset();
    this.hero.x = 0;
    this.hero.y = 0;
    this.hero.z = 0;
    this.hero.vy = 0;
    this.hero.grounded = true;
    this.hero.smashTimer = 0;
    this.hero.reelTimer = 0;
    this.rig.snap(0, 0, 0);

    this.primeTrack();

    this.hud.showScreen(null);
    this.hud.update(this.hudState());
    this.input.reset();
    this.clock.getDelta();
    this.hud.toast('SMAASH!', 1400, 'big');
  }

  gameOver() {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    this.audio.stopMusic(0.6);
    this.audio.gameOver();
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem(BEST_KEY, String(Math.floor(this.best)));
      } catch { /* private mode */ }
    }
    this.hud.showGameOver(this.hudState());
  }

  hudState() {
    return {
      score: Math.floor(this.score),
      coins: this.coins,
      stars: this.stars,
      distance: this.distance,
      best: this.best,
      speedRatio: this.speedRatio,
      combo: this.combo,
      comboTimer: clamp(this.comboTimer / SCORE.comboWindow, 0, 1),
      bonus: this.multiplier > 1 ? this.multiplier : 0,
      health: this.health,
    };
  }

  // ------------------------------------------------------------- helpers ----
  get speedRatio01() {
    return clamp((this.speed - SPEED.start) / (SPEED.max - SPEED.start), 0, 1);
  }

  worldToScreen(pos) {
    this._tmpV.copy(pos).project(this.camera);
    return {
      x: (this._tmpV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this._tmpV.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  addScore(amount, kind = '', pos = null, label = null) {
    const raw = amount * this.multiplier;
    this.score += raw;
    const gain = Math.max(1, Math.round(raw));
    if (pos && label) {
      const s = this.worldToScreen(pos);
      this.hud.popup(s.x, s.y, `+${gain}`, kind);
    }
    return gain;
  }

  bumpCombo() {
    this.combo = Math.min(60, this.combo + 1);
    this.comboTimer = SCORE.comboWindow;
    this.multiplier = Math.min(SCORE.comboMax, 1 + Math.floor(this.combo / 3) * 0.5);
    this.audio.combo(Math.min(9, Math.floor(this.combo / 2)));
  }

  breakCombo() {
    if (this.combo >= 5) this.hud.toast('COMBO LOST', 900, 'warn');
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
  }

  // -------------------------------------------------------------- physics ---
  updatePlayer(dt) {
    const hero = this.hero;
    const input = this.input;

    // --- lane switching ---
    const axisPress = input.consumeAxisPress();
    if (axisPress !== 0 && this.laneTween >= 0.75) {
      const next = clamp(this.laneTarget + axisPress, 0, LANES.length - 1);
      if (next !== this.laneTarget) {
        this.laneFrom = hero.x;
        this.laneTarget = next;
        this.laneTween = 0;
        hero.lateralVelocity = axisPress * 9;
        this.audio.lane();
      }
    }
    if (this.laneTween < 1) {
      this.laneTween = Math.min(1, this.laneTween + dt / PLAYER.laneSwitchTime);
      const e = smoothstep(this.laneTween);
      const from = this.laneFrom;
      const to = LANES[this.laneTarget];
      hero.x = lerp(from, to, e);
      hero.lateralVelocity = lerp(hero.lateralVelocity, 0, 1 - Math.exp(-8 * dt));
    } else {
      hero.x = expDamp(hero.x, LANES[this.laneTarget], 16, dt);
      hero.lateralVelocity = expDamp(hero.lateralVelocity, 0, 10, dt);
    }

    // --- jump ---
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= dt;
    if (input.consume('jump')) this.jumpBufferTimer = PLAYER.jumpBuffer;
    const canJump = hero.grounded || this.coyoteTimer > 0;
    if (this.jumpBufferTimer > 0 && canJump && hero.reelTimer <= 0 && this.reelTimer <= 0) {
      hero.vy = PLAYER.jumpVelocity;
      hero.grounded = false;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.audio.jump();
      this.particles.dust(new THREE.Vector3(hero.x, 0.05, hero.z), { count: 10, speed: 3 });
    }
    // Variable jump height: releasing early clips the arc exactly once, with a
    // floor high enough to always clear a barrier (touch players tap).
    if (input.released.has('jump') && hero.vy > PLAYER.jumpVelocity * PLAYER.jumpMinHold) {
      hero.vy = PLAYER.jumpVelocity * PLAYER.jumpMinHold;
    }

    // gravity
    const grav = input.isDown('jump') || hero.vy > 0 ? PLAYER.gravity : PLAYER.gravity + PLAYER.fastFallGravity * 0.35;
    hero.vy += grav * dt;
    hero.y += hero.vy * dt;

    if (hero.y <= 0) {
      if (!hero.grounded) {
        const impact = clamp(-hero.vy / PLAYER.jumpVelocity, 0, 1.4);
        hero.grounded = true;
        hero.landTimer = 0.18;
        this.audio.land(0.4 + impact * 0.8);
        this.rig.shakeBy(impact * 0.5);
        this.particles.dust(new THREE.Vector3(hero.x, 0.05, hero.z), { count: Math.round(8 + impact * 12), speed: 2.4 + impact * 3 });
        if (impact > 0.5) this.particles.shockwave(new THREE.Vector3(hero.x, 0, hero.z), { scale: 3.4, life: 0.4, color: 0xc9b9a0 });
      }
      hero.y = 0;
      hero.vy = 0;
      this.coyoteTimer = PLAYER.coyoteTime;
    } else {
      hero.grounded = false;
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // --- smash ---
    if (input.consume('smash') && hero.smashCooldown <= 0 && !hero.isSmashing) {
      hero.startSmash();
      this.audio.smashSwing();
      if (hero.grounded) {
        const dir = new THREE.Vector3(hero.x, 0.6, hero.z - 0.8);
        this.particles.dust(dir, { count: 12, speed: 4, size: 0.26 });
      }
    }
    if (hero.smashWindow && !this.smashHandled) {
      this.smashHandled = true;
      const p = new THREE.Vector3(hero.x, 0.55, hero.z - 1.35);
      this.particles.shockwave(p, { scale: 4.8, life: 0.42 });
      this.particles.sparks(p, { count: 12, color: [1, 0.75, 0.4], speed: 7 });
      this.rig.shakeBy(0.28);
    }
    if (!hero.smashWindow) this.smashHandled = false;

    // --- speed ---
    const passive = SPEED.rampPerSecond * dt + SPEED.rampPerMeter * this.speed * dt;
    this.speed = Math.min(SPEED.max, this.speed + passive);
    let speedMul = 1;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      speedMul *= 1.16;
    }
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      speedMul *= SPEED.slowSpeed;
    }
    if (hero.reelTimer > 0) speedMul *= 0.72;
    const worldSpeed = this.speed * speedMul;

    this.speedRatio = this.speedRatio01;
    hero.z -= worldSpeed * dt * 0; // the hero stays at z=0, the world scrolls
    hero.update(dt, this.speedRatio);

    this.distance += worldSpeed * dt * 0.6; // game metres per second
    this.score += SCORE.distancePerMeter * worldSpeed * dt * 0.6;

    return worldSpeed;
  }

  // ------------------------------------------------------------ collisions --
  checkCollisions(dt) {
    const hero = this.hero;
    const heroHalfW = PLAYER.radius;
    const heroHalfD = PLAYER.halfDepth;
    const heroTop = hero.y + HERO_HEIGHT * 0.92;

    for (const e of this.entities.active) {
      if (!e.active || e.hit) continue;
      const dz = e.z - hero.z;
      if (Math.abs(dz) > 3.3) continue;
      const dx = Math.abs(e.x - hero.x);

      // ------------------------------------------------------------------ coin
      if (e.kind === KIND.COIN || e.kind === KIND.STAR) {
        const r = (e.size || 0.4) + 0.55;
        const dy = Math.abs((e.y || 1) - (hero.y + 1.05));
        if (dx < r && Math.abs(dz) < r + 0.4 && dy < 1.3) {
          e.hit = true;
          e.active = false;
          const pos = new THREE.Vector3(e.x, e.y, e.z);
          if (e.kind === KIND.COIN) {
            this.coins++;
            this.addScore(SCORE.coin, 'coin', pos, null);
            this.particles.sparkle(pos, { count: 10 });
            this.audio.coin();
            this.bumpCombo();
          } else {
            this.stars++;
            this.addScore(SCORE.star, 'star', pos, null);
            this.particles.sparkle(pos, { count: 22, color: [1, 0.95, 0.6], spread: 0.8 });
            this.audio.star();
            this.boostTimer = Math.max(this.boostTimer, 2.2);
            this.hud.toast('STAR POWER!  +SPEED', 1200, 'good');
            this.pulseRage();
          }
          this.entities.despawn(e);
        }
        continue;
      }

      // --------------------------------------------------------------- rocket
      if (e.kind === KIND.ROCKET) {
        if (dx < 1.05 && Math.abs(dz) < 1.5 && heroTop > e.y - 0.7) {
          e.hit = true;
          this.entityHit(e, true);
        }
        continue;
      }

      // ------------------------------------------------------- ground hazards
      if (e.kind === KIND.FIRE) {
        if (dx < 1.15 && Math.abs(dz) < 1.3 && hero.y < 0.55) {
          e.hit = true;
          this.entityHit(e, true);
          this.particles.explosion(new THREE.Vector3(e.x, 0.4, e.z), { scale: 0.8 });
          this.entities.despawn(e);
        }
        continue;
      }

      const halfWidth = e.kind === KIND.BARRIER ? 1.25 : e.kind === KIND.BLOCKADE ? 1.2 : (e.size || 0.5) * 0.6;
      const halfDepth = e.kind === KIND.BARRIER ? 0.3 : e.kind === KIND.BLOCKADE ? 0.35 : (e.size || 0.5) * 0.6;
      const height = e.kind === KIND.BARRIER ? 1.1 : e.kind === KIND.BLOCKADE ? 3.4 : (e.size || 0.5) * 1.1;
      const overlapX = Math.abs(e.x - hero.x) < halfWidth + heroHalfW * 0.72;
      const overlapZ = Math.abs(dz) < halfDepth + heroHalfD;
      const overlapY = hero.y < height - 0.12 && heroTop > e.y - height * 0.5;

      if (overlapX && overlapZ) {
        // ------------------------------------------------- smashable objects --
        if (e.kind === KIND.CRATE || e.kind === KIND.ROCK) {
          const inFront = dz > -2.6 && dz < 1.6;
          if (inFront && (hero.smashTimer > 0 || hero.smashWindow)) {
            this.smashEntity(e);
          } else if (overlapY && !inFront && Math.abs(dz) < halfDepth + heroHalfD) {
            // running straight into it without attacking
            e.hit = true;
            this.entityHit(e, false);
          }
          continue;
        }
        // ------------------------------------------------- unbreakable walls --
        if (overlapY) {
          e.hit = true;
          this.entityHit(e, e.kind === KIND.BLOCKADE || e.kind === KIND.BARRIER);
        } else if (e.kind === KIND.BARRIER && hero.y > 1.1) {
          // cleared it — reward the jump on the way past
          if (!e.jumped) {
            e.jumped = true;
            this.addScore(SCORE.barrierJump, 'good');
            this.bumpCombo();
          }
        }
      }
    }
    void dt;
  }

  smashEntity(e) {
    e.hit = true;
    e.active = false;
    const pos = new THREE.Vector3(e.x, e.y, e.z);
    if (e.kind === KIND.CRATE) {
      this.addScore(SCORE.woodCrate, 'crate', pos, null);
      this.particles.burst(pos, { count: 22, color: [0.72, 0.55, 0.32], speed: 7, size: 0.2, life: 1.0 });
      this.particles.sparkle(pos, { count: 6, color: [1, 0.9, 0.5] });
      this.audio.crateBreak();
      this.spawnCoins(pos, 3);
    } else {
      this.addScore(SCORE.rock, 'rock', pos, null);
      this.particles.burst(pos, { count: 26, color: [0.55, 0.53, 0.5], speed: 8, size: 0.24, life: 1.1, gravity: -20 });
      this.audio.rockBreak();
      this.spawnCoins(pos, 2);
    }
    this.audio.smashImpact(true);
    this.rig.shakeBy(0.55);
    this.hud.pulseMeter('smash');
    this.bumpCombo();
    this.entities.despawn(e);
  }

  spawnCoins(pos, n) {
    for (let i = 0; i < n; i++) {
      const c = this.entities.spawn(KIND.COIN, {
        x: pos.x + (this.rng() - 0.5) * 1.2,
        y: 0.9 + this.rng() * 0.6,
        z: pos.z - 0.4 - this.rng() * 1.6,
      });
      if (c) {
        c.popped = true;
        c.t = 0;
      }
    }
  }

  entityHit(e, hard) {
    const hero = this.hero;
    if (this.invuln > 0) return;
    this.health -= hard ? 1 : 1;
    this.invuln = PLAYER.invulnerableAfterHit;
    this.hurtFlash = 1;
    this.rig.shakeBy(hard ? 1.0 : 0.7);
    this.audio.hurt();
    this.breakCombo();
    this.slowTimer = Math.max(this.slowTimer, 0.5);
    hero.reelTimer = PLAYER.reelDuration;
    this.particles.burst(new THREE.Vector3(hero.x, 1.2, hero.z), { count: 14, color: [0.8, 0.2, 0.15], speed: 6, size: 0.2 });
    this.hud.pulseMeter('hurt');

    if (e.kind === KIND.ROCKET) {
      this.particles.explosion(new THREE.Vector3(e.x, e.y, e.z), { scale: 1.2 });
      this.audio.explosion();
      this.entities.despawn(e);
    } else if (e.kind === KIND.BLOCKADE || e.kind === KIND.BARRIER) {
      this.particles.burst(new THREE.Vector3(e.x, e.y, e.z), { count: 18, color: [0.6, 0.6, 0.62], speed: 7, size: 0.22 });
      this.entities.despawn(e);
    } else if (e.kind === KIND.CRATE || e.kind === KIND.ROCK) {
      this.particles.burst(new THREE.Vector3(e.x, e.y, e.z), { count: 16, color: [0.6, 0.5, 0.4], speed: 6, size: 0.2 });
      this.entities.despawn(e);
    }

    if (this.health <= 0) {
      this.hero.reelTimer = 1.6;
      this.particles.explosion(new THREE.Vector3(hero.x, 1, hero.z), { scale: 1.4 });
      this.dyingTimer = 0.75;
      this.state = STATE.DYING;
    } else {
      this.hud.toast(hard ? 'OUCH!' : 'WATCH OUT!', 900, 'warn');
    }
  }

  pulseRage() {
    this.hud.pulseMeter('star');
  }

  /** Near-miss reward when a hazard squeezes past. */
  checkNearMiss() {
    const hero = this.hero;
    for (const e of this.entities.active) {
      if (e.scoredNear || e.hit) continue;
      const isHazard = e.kind === KIND.ROCKET || e.kind === KIND.BLOCKADE || e.kind === KIND.FIRE;
      if (!isHazard) continue;
      const dz = e.z - hero.z;
      if (dz > 0.4 && dz < 2.2) {
        const dx = Math.abs(e.x - hero.x);
        if (dx > 0.9 && dx < 2.2) {
          e.scoredNear = true;
          this.addScore(SCORE.nearMiss, 'near');
          this.bumpCombo();
        }
      }
    }
  }

  // --------------------------------------------------------------- spawning --
  /**
   * Keeps the road ahead stocked. `spawnZ` is the world z where the next chunk
   * of track begins (negative = ahead of the player). It drifts toward the
   * player as the world scrolls and is pushed further away as chunks are added.
   */
  updateSpawning(worldSpeed, dt) {
    this.spawnZ += worldSpeed * dt;
    const frontier = SPAWN.horizon + 22;
    const difficulty = clamp(this.distance / 2400, 0, 1);
    let guard = 0;
    while (this.spawnZ > frontier && guard++ < 8) {
      const res = this.director.next(difficulty, this.spawnZ);
      this.spawnZ -= res.length;
    }

    // difficulty milestones
    const stage = DIFFICULTY_STAGES.filter((st) => this.distance >= st.at).pop();
    const idx = DIFFICULTY_STAGES.indexOf(stage);
    if (idx > this.stageIndex) {
      this.stageIndex = idx;
      this.hud.stageBanner(stage.note.toUpperCase(), `${Math.floor(this.distance)} m`, 2000);
      this.audio.levelUp();
    }
    this.audio.setIntensity(clamp(this.distance / 2400, 0, 1) * 0.7 + this.speedRatio * 0.3);
  }

  /** Fills the horizon with the opening chunks. */
  primeTrack() {
    // A hand-placed opening teaches the loop before the director takes over:
    // a crate to smash, its coin payload, then a barrier to jump.
    const open = [
      { kind: KIND.CRATE, lane: 1, z: -30 },
      { kind: KIND.CRATE, lane: 1, z: -31.6 },
      { kind: KIND.COIN, lane: 1, z: -34.5, y: 0.95 },
      { kind: KIND.COIN, lane: 0, z: -37, y: 0.95 },
      { kind: KIND.COIN, lane: 1, z: -38.5, y: 0.95 },
      { kind: KIND.COIN, lane: 2, z: -40, y: 0.95 },
      { kind: KIND.BARRIER, lane: 1, z: -46 },
      { kind: KIND.COIN, lane: 1, z: -44.4, y: 1.15 },
      { kind: KIND.COIN, lane: 1, z: -46, y: 2.0 },
      { kind: KIND.COIN, lane: 1, z: -47.6, y: 1.15 },
      { kind: KIND.ROCK, lane: 0, z: -56 },
      { kind: KIND.CRATE, lane: 2, z: -57 },
      { kind: KIND.STAR, lane: 1, z: -62, y: 1.4 },
    ];
    for (const o of open) this.entities.spawn(o.kind, { lane: o.lane, z: o.z, y: o.y });

    // then keep filling until the horizon is stocked
    this.spawnZ = -68;
    const frontier = SPAWN.horizon + 22;
    let guard = 0;
    while (this.spawnZ > frontier && guard++ < 14) {
      const res = this.director.next(0.03, this.spawnZ);
      this.spawnZ -= res.length;
    }
  }

  // ------------------------------------------------------------------ loop --
  loop() {
    // ?manual=1 turns off self-scheduling so tooling / tests can step the game
    // with deterministic deltas (headless software renderers are too slow).
    if (this.manual) return;
    const frame = () => {
      this.rafId = requestAnimationFrame(frame);
      const rawDt = this.clock.getDelta();
      const dt = Math.min(rawDt, 1 / 20); // clamp huge tab-switch deltas
      this.time += dt;
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Advance one deterministic frame and draw it (used by the manual mode). */
  step(dt = 1 / 60, render = true) {
    this.time += dt;
    this.tick(dt);
    if (render) this.renderer.render(this.scene, this.camera);
  }

  tick(dt) {
    if (this.input.consume('pause') || this.input.consume('pause2')) {
      if (this.state === STATE.RUNNING) this.setPaused(true);
      else if (this.state === STATE.PAUSED) this.setPaused(false);
    }
    if (this.input.consume('mute')) this.toggleMute();

    if (this.state === STATE.READY) {
      this.input.endFrame();
      // slow showcase orbit on the title screen
      this.idleTime = (this.idleTime || 0) + dt;
      this.hero.x = Math.sin(this.idleTime * 0.4) * 0.6;
      this.hero.update(dt, 0.25);
      this.world.update(dt * 0.35, 0, this.time);
      this.rig.update(dt * 0.6, this.hero, 0.1, { lookShift: Math.sin(this.idleTime * 0.25) * 1.2 });
      this.camera.position.x += Math.sin(this.idleTime * 0.25) * 1.4;
      this.particles.update(dt, this.camera.position);
      this.input.endFrame();
      return;
    }

    if (this.state === STATE.PAUSED) {
      this.input.endFrame();
      return;
    }

    if (this.state === STATE.DYING) {
      this.dyingTimer -= dt;
      this.slowTimer = 0;
      this.speed = Math.max(0, this.speed - dt * 26);
      const ws = this.speed * 0.5;
      this.world.update(dt, this.hero.z, this.time);
      this.entities.update(dt * 0.4, ws, this.hero.z);
      this.particles.update(dt, this.camera.position);
      this.hero.update(dt, 0);
      this.rig.shakeBy(dt * 1.6);
      this.rig.update(dt, this.hero, 0);
      this.hud.update(this.hudState());
      this.input.endFrame();
      if (this.dyingTimer <= 0) this.gameOver();
      return;
    }

    if (this.state === STATE.OVER) {
      // let the world keep drifting gently for the results screen
      this.world.update(dt * 0.4, 0, this.time);
      this.particles.update(dt, this.camera.position);
      this.hero.update(dt, 0);
      this.rig.update(dt, this.hero, 0);
      this.input.endFrame();
      return;
    }

    // ---- running ----
    this.runTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && this.combo > 0) this.breakCombo();

    const worldSpeed = this.updatePlayer(dt);
    this.world.update(dt, this.hero.z, this.time);
    this.entities.update(dt, worldSpeed, this.hero.z, (e) => this.onEntityPassed(e));
    this.updateSpawning(worldSpeed, dt);
    this.checkCollisions(dt);
    this.checkNearMiss();
    this.particles.update(dt, this.camera.position);

    // footsteps dust
    this.footTimer = (this.footTimer || 0) + dt * (this.speed / 16);
    if (this.hero.grounded && this.footTimer > 0.26) {
      this.footTimer = 0;
      this.particles.dust(new THREE.Vector3(this.hero.x, 0.04, this.hero.z + 0.45), { count: 3, speed: 1.6, size: 0.2 });
    }

    this.rig.update(dt, this.hero, this.speedRatio);
    this.updateLights();
    this.hud.update(this.hudState());
    const flash = document.getElementById('hurt-flash');
    if (flash) flash.classList.toggle('on', this.hurtFlash > 0.35);
    this.input.endFrame();
  }

  onEntityPassed(e) {
    if (e.kind === KIND.BARRIER && !e.hit && !e.jumped) {
      e.jumped = true;
      this.addScore(SCORE.barrierJump, 'good');
      this.bumpCombo();
    }
  }

  updateLights() {
    // keep the sun shadow frustum centred on the hero
    const sun = this.lights.sun;
    const px = this.hero.x;
    sun.target.position.set(px, 0, this.hero.z - 4);
    sun.position.set(px - 12, 20, this.hero.z + 14);
    sun.target.updateMatrixWorld();
    this.lights.rim.position.set(px, 5, this.hero.z - 16);
    // hero key light sits just above and in front of the big guy
    this.lights.heroLight.position.set(px + 1.4, 4.2, this.hero.z + 3.2);
    this.lights.heroFill.position.set(px, 6, this.hero.z + 9);
    this.lights.heroFill.target.position.set(px, 1, this.hero.z - 2);
    this.lights.heroFill.target.updateMatrixWorld();
  }
}

export { STATE };
