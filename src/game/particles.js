// ---------------------------------------------------------------------------
// Lightweight GPU-friendly particle system used for dust, splinters, sparks,
// coin pops, smoke puffs and shockwave rings. Everything is pooled; a particle
// is a single draw-call-free point sprite inside one BufferGeometry.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { TAU, makeRng, clamp } from '../core/mathx.js';
import { makeGlowTexture, makeSmokeTexture, makeShockwaveTexture } from './textures.js';

const MAX_POINTS = 900;
const MAX_SPRITES = 40;

export function createParticles(scene, { quality = 'high' } = {}) {
  const rng = makeRng(9182);
  const smokeLimit = quality === 'low' ? 0 : quality === 'medium' ? 10 : 24;

  // ------------------------------------------------------------ point pool --
  const positions = new Float32Array(MAX_POINTS * 3);
  const colors = new Float32Array(MAX_POINTS * 3);
  const sizes = new Float32Array(MAX_POINTS);
  const alphas = new Float32Array(MAX_POINTS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('psize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('palpha', new THREE.BufferAttribute(alphas, 1));
  geo.setDrawRange(0, 0);

  const glow = makeGlowTexture(64, '255,255,255');
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: glow },
      scale: { value: window.innerHeight * 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float psize;
      attribute float palpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float scale;
      void main() {
        vColor = color;
        vAlpha = palpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, psize * scale / max(0.001, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        if (t.a * vAlpha <= 0.004) discard;
        gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // particles are stored in plain objects and copied into the buffers
  const pool = [];
  const live = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    pool.push({
      px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1,
      size: 1, drag: 1.4, gravity: -9, grow: 0,
      r: 1, g: 1, b: 1, fade: 1, additive: true,
      alive: false,
    });
  }

  // ------------------------------------------------------------ sprite pool --
  const shockTex = makeShockwaveTexture(256);
  const smokeTex = makeSmokeTexture(128, 21);
  const sprites = [];
  for (let i = 0; i < MAX_SPRITES; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shockTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    m.visible = false;
    scene.add(m);
    sprites.push({ mesh: m, life: 0, maxLife: 1, from: 1, to: 4, kind: 'ring', delay: 0 });
  }
  const smokes = [];
  for (let i = 0; i < smokeLimit; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0xb0a6bb, opacity: 0.5 }),
    );
    m.visible = false;
    scene.add(m);
    smokes.push({ mesh: m, life: 0, maxLife: 1, vy: 0.6, scale: 1 });
  }

  function emit(opts) {
    const p = pool.pop();
    if (!p) return;
    p.px = opts.x; p.py = opts.y; p.pz = opts.z;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0; p.vz = opts.vz || 0;
    p.life = opts.life || 0.6;
    p.maxLife = p.life;
    p.size = opts.size || 0.2;
    p.drag = opts.drag ?? 1.6;
    p.gravity = opts.gravity ?? -9;
    p.grow = opts.grow ?? 0;
    p.r = opts.r ?? 1; p.g = opts.g ?? 0.9; p.b = opts.b ?? 0.7;
    p.fade = opts.fade ?? 1;
    p.alive = true;
    live.push(p);
  }

  // ------------------------------------------------------------- presets ----
  const api = {
    /**
     * Chunky debris burst (crates, rocks, dust).
     * @param {THREE.Vector3} pos
     */
    burst(pos, { count = 16, color = [0.75, 0.6, 0.4], speed = 5, size = 0.18, gravity = -14, life = 0.8, spread = 1 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const up = rng() * 0.9 + 0.2;
        const sp = speed * (0.4 + rng() * 0.9);
        emit({
          x: pos.x + (rng() - 0.5) * 0.4 * spread,
          y: pos.y + rng() * 0.5 * spread,
          z: pos.z + (rng() - 0.5) * 0.4 * spread,
          vx: Math.cos(a) * sp,
          vy: up * sp,
          vz: Math.sin(a) * sp * 0.7 - 1.5,
          life: life * (0.6 + rng() * 0.8),
          size: size * (0.6 + rng() * 0.9),
          gravity,
          drag: 1.2,
          r: color[0] * (0.8 + rng() * 0.4),
          g: color[1] * (0.8 + rng() * 0.4),
          b: color[2] * (0.8 + rng() * 0.4),
        });
      }
    },

    /** Bright sparks e.g. metal impacts. */
    sparks(pos, { count = 18, color = [1, 0.85, 0.45], speed = 8, life = 0.45 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const sp = speed * (0.5 + rng());
        emit({
          x: pos.x, y: pos.y, z: pos.z,
          vx: Math.cos(a) * sp,
          vy: rng() * sp,
          vz: Math.sin(a) * sp * 0.6 - 2,
          life: life * (0.5 + rng()),
          size: 0.09 + rng() * 0.08,
          gravity: -16,
          drag: 1.0,
          r: color[0], g: color[1], b: color[2],
        });
      }
    },

    /** Glowing coin / star pickup trail. */
    sparkle(pos, { count = 10, color = [1, 0.85, 0.35], spread = 0.5 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        emit({
          x: pos.x + (rng() - 0.5) * spread,
          y: pos.y + (rng() - 0.5) * spread,
          z: pos.z + (rng() - 0.5) * spread,
          vx: Math.cos(a) * 1.6,
          vy: rng() * 2.4,
          vz: Math.sin(a) * 1.4,
          life: 0.35 + rng() * 0.35,
          size: 0.13 + rng() * 0.1,
          gravity: -1.5,
          drag: 2.2,
          r: color[0], g: color[1], b: color[2],
        });
      }
    },

    /** Soft dust kicked up by footfalls and landings. */
    dust(pos, { count = 12, color = [0.55, 0.5, 0.46], speed = 2.4, size = 0.3 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const sp = speed * (0.3 + rng());
        emit({
          x: pos.x + (rng() - 0.5) * 0.6,
          y: pos.y + rng() * 0.2,
          z: pos.z + (rng() - 0.5) * 0.5,
          vx: Math.cos(a) * sp,
          vy: 0.4 + rng() * 1.4,
          vz: Math.sin(a) * sp * 0.8,
          life: 0.5 + rng() * 0.6,
          size: size * (0.6 + rng()),
          gravity: -1.2,
          drag: 2.6,
          r: color[0], g: color[1], b: color[2],
          grow: 0.9,
        });
      }
    },

    /** Ground shockwave ring used by the smash attack. */
    shockwave(pos, { scale = 5, life = 0.5, color = 0xffd9a0 } = {}) {
      const s = sprites.find((x) => !x.mesh.visible);
      if (!s) return;
      s.mesh.visible = true;
      s.mesh.position.set(pos.x, 0.08, pos.z);
      s.mesh.rotation.set(-Math.PI / 2, 0, 0);
      s.mesh.material.color.setHex(color);
      s.mesh.material.opacity = 0.95;
      s.from = 0.6;
      s.to = scale;
      s.maxLife = life;
      s.life = life;
      s.kind = 'ring';
    },

    /** Slow drifting smoke column (explosions, rocket trails). */
    smoke(pos, { scale = 2.4, life = 1.4, vy = 0.9, color = 0xb0a6bb } = {}) {
      const s = smokes.find((x) => !x.mesh.visible);
      if (!s) return;
      s.mesh.visible = true;
      s.mesh.position.copy(pos);
      s.mesh.material.color.setHex(color);
      s.mesh.material.opacity = 0.5;
      s.mesh.rotation.z = rng() * TAU;
      s.mesh.scale.setScalar(scale * 0.5);
      s.maxLife = life;
      s.life = life;
      s.vy = vy;
      s.scale = scale;
    },

    /** Full explosion: flash + sparks + smoke + ring. */
    explosion(pos, { scale = 1, color = [1, 0.72, 0.3] } = {}) {
      api.sparks(pos, { count: 26 * scale, color, speed: 11 * scale, life: 0.6 });
      api.burst(pos, { count: 14 * scale, color: [0.4, 0.36, 0.34], speed: 6 * scale, size: 0.22, gravity: -18, life: 0.9 });
      api.shockwave(pos, { scale: 6 * scale, life: 0.45, color: 0xff9a40 });
      for (let i = 0; i < 3 * scale; i++) {
        api.smoke(new THREE.Vector3(pos.x + (rng() - 0.5) * 0.8, pos.y + rng() * 0.6, pos.z + (rng() - 0.5) * 0.8), {
          scale: 2.6 * scale,
          life: 1.2 + rng(),
          vy: 0.7 + rng(),
          color: 0x6e6472,
        });
      }
    },

    update(dt, cameraPos) {
      // points
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          live.splice(i, 1);
          pool.push(p);
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vz *= damp;
        p.vy *= damp;
        p.vy += p.gravity * dt;
        p.px += p.vx * dt;
        p.py += p.vy * dt;
        p.pz += p.vz * dt;
        if (p.py < 0.02) {
          p.py = 0.02;
          p.vy = Math.abs(p.vy) * 0.22;
          p.vx *= 0.6;
          p.vz *= 0.6;
        }
        const t = p.life / p.maxLife;
        positions[n * 3] = p.px;
        positions[n * 3 + 1] = p.py;
        positions[n * 3 + 2] = p.pz;
        colors[n * 3] = p.r;
        colors[n * 3 + 1] = p.g;
        colors[n * 3 + 2] = p.b;
        sizes[n] = p.size * (p.grow > 0 ? 1 + (1 - t) * p.grow * 2 : 1);
        alphas[n] = clamp(t * p.fade, 0, 1);
        n++;
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.psize.needsUpdate = true;
      geo.attributes.palpha.needsUpdate = true;
      if (cameraPos) mat.uniforms.scale.value = window.innerHeight * 0.5;

      // rings
      for (const s of sprites) {
        if (!s.mesh.visible) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.visible = false;
          continue;
        }
        const t = 1 - s.life / s.maxLife;
        const sc = s.from + (s.to - s.from) * Math.sqrt(t);
        s.mesh.scale.setScalar(sc);
        s.mesh.material.opacity = (1 - t) * 0.9;
      }

      // smoke
      for (const s of smokes) {
        if (!s.mesh.visible) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.visible = false;
          continue;
        }
        const t = 1 - s.life / s.maxLife;
        s.mesh.position.y += s.vy * dt;
        s.mesh.scale.setScalar(s.scale * (0.5 + t * 1.3));
        s.mesh.material.opacity = (1 - t) * 0.45;
        if (cameraPos) s.mesh.lookAt(cameraPos.x, cameraPos.y, cameraPos.z);
        s.mesh.rotation.z += dt * 0.4;
      }
    },

    reset() {
      for (const p of live) {
        p.alive = false;
        pool.push(p);
      }
      live.length = 0;
      for (const s of sprites) s.mesh.visible = false;
      for (const s of smokes) s.mesh.visible = false;
      geo.setDrawRange(0, 0);
    },
  };

  return api;
}
