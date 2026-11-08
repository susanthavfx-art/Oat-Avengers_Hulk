// ---------------------------------------------------------------------------
// Hero controller.
//
// Locomotion strategy:
//   * the authored `dash` clip from the GLB is the run cycle (it is a genuine
//     4-steps-per-second sprint) — its loop seam is smoothed at load time;
//   * jump, smash, reel and lane-lean are additive overlays applied on top of
//     whatever the mixer produced that frame, so authored motion is never lost.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';
import { PLAYER } from './config.js';
import { clamp, expDamp, smoothstep } from '../core/mathx.js';

const BONE = {
  pelvis: 'Bip001_Pelvis_03',
  spine: 'Bip001_Spine_04',
  spine1: 'Bip001_Spine1_017',
  spine2: 'Bip001_Spine2_018',
  neck: 'Bip001_Neck_019',
  head: 'Bip001_Head_020',
  lThigh: 'Bip001_L_Thigh_05',
  lCalf: 'Bip001_L_Calf_06',
  lFoot: 'Bip001_L_Foot_07',
  rThigh: 'Bip001_R_Thigh_011',
  rCalf: 'Bip001_R_Calf_012',
  rFoot: 'Bip001_R_Foot_013',
  lClavicle: 'Bip001_L_Clavicle_022',
  rClavicle: 'Bip001_R_Clavicle_041',
  lArm: 'Bip001_L_UpperArm_023',
  lForearm: 'Bip001_L_Forearm_024',
  lHand: 'Bip001_L_Hand_025',
  rArm: 'Bip001_R_UpperArm_042',
  rForearm: 'Bip001_R_Forearm_043',
  rHand: 'Bip001_R_Hand_044',
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
/** Bones the smash stance must not touch: the run cycle owns the lower body. */
const PRESERVE_LOWER_BODY = [
  'pelvis', 'lThigh', 'rThigh', 'lCalf', 'rCalf', 'lFoot', 'rFoot',
];

export const HERO_SCALE = 0.95;
/** World height of the hero in game units (~2.0). */
export const HERO_HEIGHT = 2.4;

/**
 * Softens the loop of a clip by ramping the last `w` seconds of every track
 * into the value it starts with. Returns a brand new clip.
 */
function makeSeamlessLoop(clip, w = 0.07) {
  const tracks = clip.tracks.map((track) => {
    const src = track.clone();
    const times = src.times;
    const values = src.values;
    const stride = values.length / times.length;
    const dur = times[times.length - 1];
    const v0 = Array.from(values.slice(0, stride));
    const start = dur - w;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t < start) continue;
      const a = smoothstep((t - start) / w);
      for (let c = 0; c < stride; c++) {
        const target = v0[c];
        let cur = values[i * stride + c];
        // shortest path for quaternion components
        if (src.ValueTypeName === 'quaternion') {
          const dot = cur * target;
          if (dot < 0) cur = -cur;
        }
        values[i * stride + c] = cur + (target - cur) * a;
      }
    }
    src.times = times;
    src.values = values;
    return src;
  });
  const out = new THREE.AnimationClip(clip.name + '_loop', clip.duration, tracks);
  return out;
}

export class Hero {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.scale.setScalar(HERO_SCALE);
    scene.add(this.root);
    this.ready = false;

    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.lane = 1;
    this.lateralVelocity = 0;
    this.vy = 0;
    this.grounded = true;
    this.speed = 0;
    this.speedRatio = 0;
    this.runPhase = 0;

    this.smashTimer = 0;
    this.smashCooldown = 0;
    this.reelTimer = 0;
    this.invulnTimer = 0;
    this.landTimer = 0;
    this.airBlend = 0;
    this.leanBack = 0;
    this.roll = 0;
    this.tiltX = 0;
  }

  async load(onProgress) {
    const gltf = await new GLTFLoader().loadAsync('./Model.glb', (ev) => {
      if (onProgress && ev.total) onProgress(ev.loaded / ev.total);
    });
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    // the GLB contains a rigged prop weapon that floats beside the pelvis
    for (const name of ['kingpin_wp03', 'bn_wp_063']) {
      const o = model.getObjectByName(name);
      if (o) o.visible = false;
    }
    this.model = model;
    // The GLB is authored facing +Z while the run travels toward -Z, so the
    // model gets a half turn. Overlay axes are converted out of this yaw in
    // _add()/_rotAbs() so gameplay code can keep thinking in world axes.
    this.yaw = Math.PI;
    this.yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.yawQInv = this.yawQ.clone().invert();
    model.rotation.y = this.yaw;
    this.root.add(model);

    // ---- animation ---------------------------------------------------------
    this.mixer = new THREE.AnimationMixer(model);
    const byKey = {};
    for (const clip of gltf.animations) {
      byKey[clip.name.split('@')[1] || clip.name] = clip;
    }
    const runClip = byKey.dash || gltf.animations[0];
    this.runAction = this.mixer.clipAction(makeSeamlessLoop(runClip, 0.08));
    this.runAction.setLoop(THREE.LoopRepeat, Infinity);
    this.runAction.play();
    this.runDuration = runClip.duration;

    // ---- bones -------------------------------------------------------------
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    this.bones = {};
    this.invParent = {};
    for (const k in BONE) {
      const b = bones[BONE[k]] || null;
      this.bones[k] = b;
      if (b) {
        const pw = new THREE.Quaternion();
        if (b.parent) b.parent.getWorldQuaternion(pw);
        this.invParent[k] = pw.invert();
      }
    }
    this.restAll = {};
    for (const k in this.bones) {
      if (this.bones[k]) this.restAll[k] = this.bones[k].quaternion.clone();
    }
    this._q = new THREE.Quaternion();
    this._ax = new THREE.Vector3();
    this._scratch = new THREE.Vector3();
    this.ready = true;
    return this;
  }

  // ---------------------------------------------------------------- overlay --
  /**
   * Post-multiplies a world-axis rotation onto a bone *after* the mixer ran,
   * which keeps the authored run intact and just layers an offset on top.
   */
  _add(key, axis, angle) {
    if (!angle) return;
    const b = this.bones[key];
    if (!b) return;
    this._ax.copy(axis).applyQuaternion(this.yawQInv).applyQuaternion(this.invParent[key]).normalize();
    this._q.setFromAxisAngle(this._ax, angle);
    b.quaternion.premultiply(this._q);
  }

  _add2(key, axisA, angA, axisB, angB) {
    this._add(key, axisA, angA);
    this._add(key, axisB, angB);
  }

  /** Jump tuck / landing absorption layered over the run. */
  overlayAir(dt) {
    const air = this.airBlend;
    if (air < 0.01) return;
    const rise = clamp(this.vy / PLAYER.jumpVelocity, -1, 1);
    const tuck = air * (0.55 + 0.45 * clamp(rise, 0, 1));
    this._add('lThigh', AXIS_X, 0.85 * tuck);
    this._add('rThigh', AXIS_X, 0.45 * tuck);
    this._add('lCalf', AXIS_X, 1.15 * tuck);
    this._add('rCalf', AXIS_X, 0.7 * tuck);
    this._add('lFoot', AXIS_X, -0.3 * tuck);
    this._add('rFoot', AXIS_X, -0.2 * tuck);
    this._add('spine', AXIS_X, -0.18 * air * clamp(-rise, -1, 1));
    this._add('lArm', AXIS_X, -0.55 * tuck);
    this._add('rArm', AXIS_X, -0.55 * tuck);
    this._add('lArm', AXIS_Z, 0.3 * tuck);
    this._add('rArm', AXIS_Z, -0.3 * tuck);
    void dt;
  }

  /**
   * Runs `fn` with every bone reset to its rest pose and returns the resulting
   * quaternion for each bone, leaving the live pose untouched.
   */
  _capturePose(fn, preserve = null) {
    const saved = {};
    for (const k in this.restAll) {
      const b = this.bones[k];
      if (!b) continue;
      saved[k] = b.quaternion.clone();
      b.quaternion.copy(this.restAll[k]);
    }
    fn();
    const out = {};
    for (const k in saved) {
      out[k] = preserve && preserve.indexOf(k) >= 0 ? saved[k] : this.bones[k].quaternion.clone();
    }
    for (const k in saved) this.bones[k].quaternion.copy(saved[k]);
    return out;
  }

  /** Blend the live pose toward a captured pose by `w` in 0..1. */
  _blendToward(pose, w) {
    if (w <= 0.001) return;
    for (const k in pose) {
      const b = this.bones[k];
      if (b) b.quaternion.slerp(pose[k], Math.min(1, w));
    }
  }

  /**
   * Absolute "smash" stance: rear back, then both fists hammer the road while
   * the body crouches. Composed from rest so it never inherits the run's torso
   * pitch, then cross-faded with the animated run.
   */
  _smashPose(p) {
    const windup = smoothstep(clamp(p / 0.34, 0, 1));
    const strike = smoothstep(clamp((p - 0.34) / 0.18, 0, 1));
    const settle = smoothstep(clamp((p - 0.55) / 0.45, 0, 1));
    const raise = windup * (1 - strike);
    const slam = strike * (1 - settle);

    // torso: lean back on the wind-up, punch forward through the strike
    this._rotAbs('spine', AXIS_X, -raise * 0.2 + slam * 0.34);
    this._rotAbs('spine1', AXIS_X, -raise * 0.14 + slam * 0.24);
    this._rotAbs('spine2', AXIS_X, raise * 0.14 - slam * 0.16);
    this._rotAbs('spine2', AXIS_Y, slam * 0.1);
    this._rotAbs('neck', AXIS_X, raise * 0.26 - slam * 0.5);
    this._rotAbs('head', AXIS_X, raise * 0.12 - slam * 0.24);

    // arms: rear back overhead, then hammer down in front of the chest
    const armA = raise * 1.5 - slam * 1.35;
    this._rotAbs('lArm', AXIS_X, armA);
    this._rotAbs('rArm', AXIS_X, armA);
    this._rotAbs('lArm', AXIS_Z, 0.26 + raise * 0.34);
    this._rotAbs('rArm', AXIS_Z, -0.26 - raise * 0.34);
    this._rotAbs('lForearm', AXIS_X, -(0.6 + raise * 0.7) + slam * 0.45);
    this._rotAbs('rForearm', AXIS_X, -(0.6 + raise * 0.7) + slam * 0.45);
    this._rotAbs('lClavicle', AXIS_Z, 0.14 + raise * 0.3);
    this._rotAbs('rClavicle', AXIS_Z, -0.14 - raise * 0.3);
    this._rotAbs('lHand', AXIS_X, -0.22);
    this._rotAbs('rHand', AXIS_X, -0.22);
    this.smashDrop = (raise * 0.06 + slam * 0.16); // body dips into the blow
  }

  /** Rotation helper that writes an absolute pose from rest (used by _capturePose). */
  _rotAbs(key, axis, angle) {
    if (!angle) return;
    const b = this.bones[key];
    if (!b) return;
    this._ax.copy(axis).applyQuaternion(this.invParent[key]).normalize();
    this._q.setFromAxisAngle(this._ax, angle);
    b.quaternion.premultiply(this._q);
  }

  /** Stagger when the hero clips a hazard. */
  overlayReel() {
    const k = Math.sin(clamp(this.reelTimer / PLAYER.reelDuration, 0, 1) * Math.PI);
    this._add('spine', AXIS_X, -0.5 * k);
    this._add('spine', AXIS_Z, 0.22 * k);
    this._add('spine2', AXIS_X, -0.35 * k);
    this._add('lArm', AXIS_X, -1.0 * k);
    this._add('rArm', AXIS_X, -1.0 * k);
    this._add('lArm', AXIS_Z, 0.85 * k);
    this._add('rArm', AXIS_Z, -0.85 * k);
    this._add('lThigh', AXIS_X, -0.4 * k);
    this._add('rThigh', AXIS_X, 0.25 * k);
    this._add('lCalf', AXIS_X, 0.45 * k);
  }

  // ---------------------------------------------------------------- update --
  update(dt, speedRatio) {
    if (!this.ready) return;
    this.speedRatio = speedRatio;
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.smashCooldown = Math.max(0, this.smashCooldown - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.reelTimer = Math.max(0, this.reelTimer - dt);
    this.airBlend = expDamp(this.airBlend, this.grounded ? 0 : 1, 16, dt);

    // cadence tracks the actual ground speed (clip is already 4 steps / second)
    const rate = 0.55 + clamp(speedRatio, 0, 1.4) * 0.95;
    this.runAction.setEffectiveTimeScale(this.reelTimer > 0 ? rate * 0.35 : rate);
    this.runAction.setEffectiveWeight(1);
    this.mixer.update(dt);
    this.runPhase = (this.runPhase + dt * rate * 2) % 1;

    if (this.reelTimer > 0) this.overlayReel();
    else this.overlayAir(dt);

    if (this.smashTimer > 0) {
      const total = PLAYER.smashDuration;
      const p = clamp(1 - this.smashTimer / total, 0, 1);
      // fade out of the run, hold the stance, fade back into the run
      const fadeIn = smoothstep(clamp(p / 0.16, 0, 1));
      const fadeOut = smoothstep(clamp((p - 0.74) / 0.26, 0, 1));
      const w = fadeIn * (1 - fadeOut);
      if (w > 0.001) {
        this.smashDrop = 0;
        const pose = this._capturePose(() => this._smashPose(p), PRESERVE_LOWER_BODY);
        this._blendToward(pose, w);
        this.root.position.y -= this.smashDrop * w;
      }
      this.smashTimer = Math.max(0, this.smashTimer - dt);
    }

    // root transform
    this.roll = expDamp(this.roll, clamp(-this.lateralVelocity * 0.05, -0.22, 0.22), 12, dt);
    this.tiltX = expDamp(this.tiltX, this.grounded ? 0 : clamp(-this.vy * 0.012, -0.16, 0.2), 8, dt);
    const landCompress = this.landTimer > 0 ? -Math.sin((this.landTimer / 0.2) * Math.PI) * 0.12 : 0;
    this.root.position.set(this.x, this.y + landCompress, this.z);
    this.root.rotation.set(this.tiltX, 0, this.roll);
    this.leanBack = expDamp(this.leanBack, 0, 6, dt);
  }

  get isSmashing() {
    return this.smashTimer > 0;
  }

  get smashWindow() {
    if (this.smashTimer <= 0) return false;
    const elapsed = PLAYER.smashDuration - this.smashTimer;
    return elapsed >= PLAYER.smashHitStart && elapsed <= PLAYER.smashHitEnd;
  }

  startSmash(heavy = false) {
    this.smashTimer = PLAYER.smashDuration * (heavy ? 1.12 : 1);
    this.smashCooldown = heavy ? PLAYER.smashRate * 1.25 : PLAYER.smashRate;
  }

  /** World-space chest position, used for particle spawns. */
  chestPosition(out = new THREE.Vector3()) {
    return out.set(this.x, this.y + 1.35, this.z + 0.35);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.scene.remove(this.root);
  }
}

export { BONE };
