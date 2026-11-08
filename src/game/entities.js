// ---------------------------------------------------------------------------
// Collectibles and hazards.
//
//   coin    – spinning Hulk medallion, worth points
//   star    – rare power-up collectible
//   crate   – wooden box you smash for coins
//   rock    – boulder you smash for points
//   barrier – waist-high rubble wall, must be jumped
//   blockade– tall wall across two lanes, must be dodged sideways
//   rocket  – homing-ish missile that sweeps its lane, dodge sideways
//   fire    – burning ground patch, must be jumped
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { LANES } from './config.js';
import { makeRng, TAU, clamp } from '../core/mathx.js';
import {
  makeCrateTexture,
  makeRockTexture,
  makeMetalTexture,
  makeCoinTexture,
  makeStarTexture,
  makeGlowTexture,
  makeHazardTexture,
  makeSmokeTexture,
  makeFlameTexture,
} from './textures.js';

export const KIND = {
  COIN: 'coin',
  STAR: 'star',
  CRATE: 'crate',
  ROCK: 'rock',
  BARRIER: 'barrier',
  BLOCKADE: 'blockade',
  ROCKET: 'rocket',
  FIRE: 'fire',
};

/** Tiny object pool that recycles THREE.Object3D instances. */
class Pool {
  constructor(factory, size) {
    this.items = [];
    this.free = [];
    for (let i = 0; i < size; i++) {
      const o = factory();
      o.visible = false;
      this.items.push(o);
      this.free.push(o);
    }
  }
  acquire() {
    return this.free.pop() || null;
  }
  release(o) {
    if (!o) return;
    o.visible = false;
    if (this.free.indexOf(o) === -1) this.free.push(o);
  }
}

export function createEntities(scene, { anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const rng = makeRng(4242);

  // ------------------------------------------------------------- materials --
  const crateTex = makeCrateTexture(256);
  crateTex.anisotropy = anisotropy;
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85, metalness: 0.03 });

  const rockTex = makeRockTexture(256);
  rockTex.anisotropy = anisotropy;
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95, metalness: 0.02, color: 0xb0aaa2 });

  const metalTex = makeMetalTexture(256, '#4a5058');
  metalTex.anisotropy = anisotropy;
  const metalMat = new THREE.MeshStandardMaterial({ map: metalTex, color: 0x8a9099, roughness: 0.62, metalness: 0.55 });

  const hazardTex = makeHazardTexture(256);
  hazardTex.anisotropy = anisotropy;
  const barrierMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, metalness: 0.1 });

  const coinTex = makeCoinTexture(256);
  const coinMat = new THREE.MeshStandardMaterial({
    map: coinTex,
    roughness: 0.28,
    metalness: 0.85,
    emissive: 0x6a4400,
    emissiveIntensity: 0.5,
    transparent: true,
  });
  const starMat = new THREE.SpriteMaterial({
    map: makeStarTexture(256),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowTex = makeGlowTexture(128, '255,190,90');
  // soft additive halo for embers / rocket exhaust
  const fireMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xff8c2a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // silhouetted tongue of flame for the ground hazard
  const flameMat = new THREE.SpriteMaterial({
    map: makeFlameTexture(256),
    color: 0xffffff,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
  const smokeTex = makeSmokeTexture(128, 12);
  const rocketSmokeMat = new THREE.MeshBasicMaterial({
    map: smokeTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.45,
    color: 0xbfb4c8,
  });

  // ------------------------------------------------------------- geometry ---
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 18);
  coinGeo.rotateX(Math.PI / 2);
  const barrierGeo = new THREE.BoxGeometry(2.5, 1.1, 0.5);
  const blockadeGeo = new THREE.BoxGeometry(2.4, 3.4, 0.6);
  const rocketBodyGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.9, 10);
  rocketBodyGeo.rotateX(Math.PI / 2);
  const rocketNoseGeo = new THREE.ConeGeometry(0.24, 0.7, 10);
  rocketNoseGeo.rotateX(-Math.PI / 2);
  const rocketFinGeo = new THREE.BoxGeometry(0.66, 0.07, 0.42);

  // ---------------------------------------------------------------- pools ---
  const poolCoin = new Pool(() => {
    const m = new THREE.Mesh(coinGeo, coinMat);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc247, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    g.scale.setScalar(1.3);
    m.add(g);
    group.add(m);
    return m;
  }, 64);

  const poolStar = new Pool(() => {
    const s = new THREE.Sprite(starMat.clone());
    s.scale.setScalar(1.7);
    group.add(s);
    return s;
  }, 8);

  const poolCrate = new Pool(() => {
    const m = new THREE.Mesh(crateGeo, crateMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }, 20);

  const poolRock = new Pool(() => {
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }, 16);

  const poolBarrier = new Pool(() => {
    const m = new THREE.Mesh(barrierGeo, barrierMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }, 10);

  const poolBlockade = new Pool(() => {
    const m = new THREE.Mesh(blockadeGeo, metalMat);
    m.castShadow = true;
    m.receiveShadow = true;
    // hazard stripes on the front face
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), barrierMat);
    stripe.position.set(0, 0.9, 0.31);
    m.add(stripe);
    group.add(m);
    return m;
  }, 8);

  const poolRocket = new Pool(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(rocketBodyGeo, metalMat);
    body.castShadow = true;
    const nose = new THREE.Mesh(rocketNoseGeo, new THREE.MeshStandardMaterial({ color: 0xd0402c, roughness: 0.4, metalness: 0.6, emissive: 0x441000, emissiveIntensity: 0.6 }));
    nose.position.z = 0.98;
    const fin1 = new THREE.Mesh(rocketFinGeo, metalMat);
    fin1.position.z = -0.6;
    const fin2 = fin1.clone();
    fin2.rotation.z = Math.PI / 2;
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.set(2.1, 2.1, 1);
    flame.position.z = -1.15;
    // warning halo so incoming rockets read instantly against the smoke
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3a1e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    halo.scale.set(3.2, 3.2, 1);
    const smoke = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rocketSmokeMat);
    smoke.position.z = -1.6;
    smoke.scale.setScalar(1.4);
    g.add(body, nose, fin1, fin2, flame, smoke, halo);
    g.userData.flame = flame;
    g.userData.smoke = smoke;
    group.add(g);
    return g;
  }, 10);

  const poolFire = new Pool(() => {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 22),
      new THREE.MeshBasicMaterial({ color: 0x120806, transparent: true, opacity: 0.9 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 22),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff5a12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    const flame = new THREE.Sprite(flameMat.clone());
    flame.material.opacity = 0.95;
    flame.scale.set(3.0, 3.9, 1);
    flame.position.y = 1.5;
    const flame2 = new THREE.Sprite(flameMat.clone());
    flame2.material.opacity = 0.85;
    flame2.scale.set(1.8, 2.6, 1);
    flame2.position.set(0.4, 1.15, 0.12);
    const light = new THREE.PointLight(0xff7a22, 12, 9, 2);
    light.position.y = 1.2;
    g.add(disc, glow, flame, flame2, light);
    g.userData.flame = flame;
    g.userData.flame2 = flame2;
    g.userData.light = light;
    group.add(g);
    return g;
  }, 10);

  const active = [];
  let clock = 0;

  // --------------------------------------------------------------- helpers --
  function spawn(kind, opts = {}) {
    const lane = opts.lane ?? 1;
    const x = opts.x ?? LANES[lane];
    const z = opts.z ?? -60;
    let obj;
    const e = {
      kind,
      x,
      y: 0,
      z,
      lane,
      active: true,
      hit: false,
      t: 0,
      seed: rng(),
      spin: 0,
      params: opts,
    };
    switch (kind) {
      case KIND.COIN: {
        obj = poolCoin.acquire();
        if (!obj) return null;
        e.y = opts.y ?? 0.95;
        e.size = 0.36;
        break;
      }
      case KIND.STAR: {
        obj = poolStar.acquire();
        if (!obj) return null;
        e.y = opts.y ?? 1.25;
        e.size = 0.55;
        break;
      }
      case KIND.CRATE: {
        obj = poolCrate.acquire();
        if (!obj) return null;
        e.size = opts.size ?? 0.9;
        e.y = e.size * 0.5;
        e.hp = 1;
        break;
      }
      case KIND.ROCK: {
        obj = poolRock.acquire();
        if (!obj) return null;
        e.size = opts.size ?? 1.05;
        e.y = e.size * 0.62;
        e.hp = 1;
        break;
      }
      case KIND.BARRIER: {
        obj = poolBarrier.acquire();
        if (!obj) return null;
        e.size = 1.1;
        e.y = 0.55;
        e.jumpable = true;
        break;
      }
      case KIND.BLOCKADE: {
        obj = poolBlockade.acquire();
        if (!obj) return null;
        e.size = 1.7;
        e.y = 1.7;
        break;
      }
      case KIND.ROCKET: {
        obj = poolRocket.acquire();
        if (!obj) return null;
        e.size = 0.8;
        e.y = opts.y ?? 1.15;
        e.speedMul = opts.speedMul ?? 1.5;
        e.bobPhase = rng() * TAU;
        break;
      }
      case KIND.FIRE: {
        obj = poolFire.acquire();
        if (!obj) return null;
        e.size = 1.0;
        e.y = 0;
        break;
      }
      default:
        return null;
    }
    obj.visible = true;
    obj.position.set(e.x, e.y, e.z);
    obj.rotation.set(0, 0, 0);
    e.obj = obj;
    if (kind === KIND.CRATE) {
      obj.scale.setScalar(e.size);
      obj.rotation.y = rng.range(-0.3, 0.3);
    } else if (kind === KIND.ROCK) {
      obj.scale.set(e.size, e.size * 0.86, e.size);
      obj.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
    } else if (kind === KIND.COIN) {
      obj.scale.setScalar(1);
    } else if (kind === KIND.BARRIER) {
      obj.scale.set(1, 1, 1);
    } else if (kind === KIND.BLOCKADE) {
      obj.scale.set(1, 1, 1);
      obj.rotation.y = rng.range(-0.06, 0.06);
    } else if (kind === KIND.ROCKET) {
      obj.scale.setScalar(1.15);
      obj.rotation.y = Math.PI; // nose toward the player
    }
    active.push(e);
    return e;
  }

  function despawn(e) {
    if (!e || !e.active) return;
    e.active = false;
    switch (e.kind) {
      case KIND.COIN: poolCoin.release(e.obj); break;
      case KIND.STAR: poolStar.release(e.obj); break;
      case KIND.CRATE: poolCrate.release(e.obj); break;
      case KIND.ROCK: poolRock.release(e.obj); break;
      case KIND.BARRIER: poolBarrier.release(e.obj); break;
      case KIND.BLOCKADE: poolBlockade.release(e.obj); break;
      case KIND.ROCKET: poolRocket.release(e.obj); break;
      case KIND.FIRE: poolFire.release(e.obj); break;
      default: break;
    }
  }

  /**
   * Moves everything toward the player and animates it.
   * `worldSpeed` is the metres/second the street moves.
   */
  function update(dt, worldSpeed, playerZ, onPass) {
    clock += dt;
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      if (!e.active) {
        active.splice(i, 1);
        continue;
      }
      e.t += dt;
      e.z += worldSpeed * dt * (e.kind === KIND.ROCKET ? e.speedMul : 1);

      // per kind animation
      switch (e.kind) {
        case KIND.COIN: {
          e.obj.rotation.z += dt * 3.4; // faces the camera and spins
          e.obj.position.y = e.y + Math.sin(clock * 3 + e.seed * TAU) * 0.1;
          break;
        }
        case KIND.STAR: {
          e.obj.position.y = e.y + Math.sin(clock * 2.2 + e.seed * TAU) * 0.16;
          const s = 1.7 + Math.sin(clock * 5 + e.seed) * 0.16;
          e.obj.scale.setScalar(s);
          break;
        }
        case KIND.ROCKET: {
          e.obj.position.y = e.y + Math.sin(clock * 6 + e.bobPhase) * 0.06;
          const flame = e.obj.userData.flame;
          if (flame) flame.scale.set(2.0 + Math.random() * 0.7, 2.0 + Math.random() * 0.7, 1);
          const smoke = e.obj.userData.smoke;
          if (smoke) {
            smoke.scale.setScalar(1.2 + (e.t * 0.8) % 1.6);
            smoke.material.opacity = 0.4 * clamp(1 - ((e.t * 0.8) % 1.6) / 1.6, 0, 1);
            smoke.lookAt(e.obj.position.x, e.obj.position.y + 1.2, e.obj.position.z + 8);
          }
          break;
        }
        case KIND.FIRE: {
          const flame = e.obj.userData.flame;
          const flame2 = e.obj.userData.flame2;
          if (flame) {
            const f = 0.9 + Math.sin(clock * 11 + e.seed * TAU) * 0.14;
            flame.scale.set(3.0 * f, 3.9 * f, 1);
            if (flame2) {
              const f2 = 0.85 + Math.sin(clock * 17 + e.seed * TAU + 1.7) * 0.2;
              flame2.scale.set(1.8 * f2, 2.6 * f2, 1);
            }
          }
          const light = e.obj.userData.light;
          if (light) light.intensity = 12 + Math.sin(clock * 15 + e.seed * TAU) * 3.2;
          break;
        }
        default:
          break;
      }
      e.obj.position.z = e.z;
      e.obj.position.x = e.x;

      // recycle once it is behind the player
      if (e.z > playerZ + 26) {
        despawn(e);
        active.splice(i, 1);
        continue;
      }
      // notify the game when the object passes the player's plane
      if (!e.passed && e.z > playerZ + 0.6) {
        e.passed = true;
        if (onPass) onPass(e);
      }
    }
  }

  function clear() {
    for (const e of active) despawn(e);
    active.length = 0;
  }

  return {
    group,
    spawn,
    despawn,
    update,
    clear,
    active,
    get count() {
      return active.length;
    },
  };
}
