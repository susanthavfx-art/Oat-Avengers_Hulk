// ---------------------------------------------------------------------------
// The destroyed city: an endless scrolling street corridor framed by ruined
// buildings, rubble piles, downed street lights, burning barrels, embers and a
// smoky sky. Everything recycles around the player so the run is endless.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { RENDER, LANES } from './config.js';
import { makeRng, lerp, clamp, TAU } from '../core/mathx.js';
import {
  makeRoadTexture,
  makeRubbleFieldTexture,
  makeFacadeTexture,
  makeSmokeTexture,
  makeGlowTexture,
} from './textures.js';

const ROAD_WIDTH = 11.6;
const FRAME = 300; // length of the recycled scenery corridor

/** Simple helper that keeps a pool of wrappable props in sync with the player. */
function wrapAround(obj, playerZ, range, startOffset = 0) {
  const half = range / 2;
  const rel = obj.position.z - playerZ;
  if (rel < -half) obj.position.z += range;
  else if (rel > half) obj.position.z -= range;
  void startOffset;
}

export function createWorld(scene, { anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const rng = makeRng(90210);
  const updaters = [];

  // ---------------------------------------------------------------- sky -----
  const skyTex = new THREE.TextureLoader().load('./assets/tex/sky.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
  });
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyGeo = new THREE.SphereGeometry(520, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      map: { value: skyTex },
      tint: { value: new THREE.Color(0x8e8ab0) },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 tint;
      uniform float time;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        // map sphere uv -> panorama, with a slow drift so the clouds move
        vec2 uv = vec2(vUv.x * 2.2 + time * 0.004, clamp(vUv.y * 1.18 - 0.02, 0.0, 1.0));
        vec3 c = texture2D(map, uv).rgb;
        // darken the zenith, keep the horizon glowing
        float h = smoothstep(0.0, 0.65, vUv.y);
        c *= mix(0.55, 1.15, h);
        c = mix(c, c * tint, 0.35);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  group.add(sky);
  updaters.push((dt, pz) => {
    sky.position.set(0, 0, pz);
    skyMat.uniforms.time.value += dt;
  });

  // distant city silhouette plates around the corridor
  const panoramaTex = new THREE.TextureLoader().load('./assets/tex/city_panorama.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
  });
  panoramaTex.colorSpace = THREE.SRGBColorSpace;
  const panoMat = new THREE.MeshBasicMaterial({
    map: panoramaTex,
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const pano = new THREE.Mesh(new THREE.PlaneGeometry(760, 190, 1, 1), panoMat);
  pano.position.set(0, 44, -300);
  group.add(pano);
  updaters.push((dt, pz) => {
    pano.position.z = pz - 300;
  });

  // ------------------------------------------------------------- ground -----
  const roadTex = makeRoadTexture(512, 7);
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(3, 40);
  roadTex.anisotropy = anisotropy;

  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    color: 0xc2bcb8,
    roughness: 0.92,
    metalness: 0.02,
  });
  const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, 620, 1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  road.position.y = 0;
  group.add(road);
  updaters.push((dt, pz) => {
    // snap-scroll the road so the texture never visibly slides
    road.position.z = pz - 200;
    roadTex.offset.y = (road.position.z * roadTex.repeat.y) / 620 % 1;
    void dt;
  });

  // gritty shoulders either side of the street
  const rubTex = makeRubbleFieldTexture(512, 21);
  rubTex.wrapS = rubTex.wrapT = THREE.RepeatWrapping;
  rubTex.repeat.set(4, 60);
  rubTex.anisotropy = anisotropy;
  const shoulderMat = new THREE.MeshStandardMaterial({ map: rubTex, roughness: 0.98, metalness: 0 });
  for (const side of [-1, 1]) {
    const g2 = new THREE.PlaneGeometry(46, 620, 1, 1);
    g2.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g2, shoulderMat);
    m.position.set(side * (ROAD_WIDTH / 2 + 23), -0.06, 0);
    m.receiveShadow = true;
    group.add(m);
    updaters.push((dt, pz) => {
      m.position.z = pz - 200;
      void dt;
    });
  }

  // lane markings (dashed, worn)
  const laneMat = new THREE.MeshStandardMaterial({
    color: 0xd9d2b6,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
  });
  const dashGeo = new THREE.PlaneGeometry(0.16, 3.4);
  dashGeo.rotateX(-Math.PI / 2);
  const dashCount = 90;
  const dashes = new THREE.InstancedMesh(dashGeo, laneMat, dashCount * 2);
  dashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dashes.receiveShadow = false;
  group.add(dashes);
  const dashZ = new Float32Array(dashCount * 2);
  for (let i = 0; i < dashCount; i++) {
    const z = -i * 7 + 10;
    for (let lane = 0; lane < 2; lane++) {
      const idx = i * 2 + lane;
      dashZ[idx] = z;
      const x = (LANES[lane] + LANES[lane + 1]) / 2;
      const m = new THREE.Matrix4();
      m.makeTranslation(x, 0.012, z);
      dashes.setMatrixAt(idx, m);
    }
  }
  dashes.instanceMatrix.needsUpdate = true;
  updaters.push((dt, pz) => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < dashCount; i++) {
      let z = dashZ[i * 2] - pz;
      const wrapped = ((z % 630) + 630) % 630;
      for (let lane = 0; lane < 2; lane++) {
        const idx = i * 2 + lane;
        const x = (LANES[lane] + LANES[lane + 1]) / 2;
        m.makeTranslation(x, 0.012, pz + wrapped - 315);
        dashes.setMatrixAt(idx, m);
      }
    }
    dashes.instanceMatrix.needsUpdate = true;
    void dt;
  });

  // ---------------------------------------------------------- buildings -----
  const facadeTex = makeFacadeTexture(256, 3);
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  facadeTex.repeat.set(2, 3);
  facadeTex.anisotropy = anisotropy;

  const buildingMats = [
    new THREE.MeshStandardMaterial({ map: facadeTex, color: 0x8d8880, roughness: 0.95, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ map: facadeTex, color: 0x6f6a66, roughness: 0.98, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ map: facadeTex, color: 0x9a8f80, roughness: 0.93, metalness: 0.02 }),
  ];
  const windowMats = new THREE.MeshStandardMaterial({
    color: 0xffb057,
    emissive: 0xff8a2a,
    emissiveIntensity: 1.5,
    roughness: 0.5,
  });

  const buildingPool = [];
  const BUILDINGS = 26;
  for (let i = 0; i < BUILDINGS; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const w = rng.range(7, 15);
    const d = rng.range(9, 20);
    const h = rng.range(9, 34) * (rng.chance(0.2) ? 1.4 : 1);
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, buildingMats[i % buildingMats.length]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(side * rng.range(ROAD_WIDTH / 2 + 8, ROAD_WIDTH / 2 + 26), h / 2 - rng.range(0, 2.5), -i * 16 - 20);
    mesh.rotation.y = rng.range(-0.18, 0.18);
    group.add(mesh);

    // add a broken top chunk for silhouette interest
    if (rng.chance(0.6)) {
      const cw = w * rng.range(0.3, 0.6);
      const ch = rng.range(1.5, 4.5);
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, d * rng.range(0.3, 0.7)), mesh.material);
      chunk.position.set(rng.range(-w * 0.25, w * 0.25), h / 2 + ch / 2 - 0.4, rng.range(-d * 0.2, d * 0.2));
      chunk.rotation.y = rng.range(-0.4, 0.4);
      chunk.castShadow = true;
      mesh.add(chunk);
    }

    // a few glowing windows as points of light — cheap emissive quads
    const windowRows = Math.floor(h / 3.2);
    const litCount = Math.max(1, Math.floor(windowRows * rng.range(0.2, 0.5)));
    for (let k = 0; k < litCount; k++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8), windowMats);
      const yy = rng.range(-h / 2 + 1.5, h / 2 - 1.5);
      const facing = -side; // face toward the road
      q.position.set(facing * (w / 2 + 0.03), yy, rng.range(-d / 2 + 1, d / 2 - 1));
      q.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.add(q);
    }
    buildingPool.push(mesh);
  }
  updaters.push(() => {
    for (const b of buildingPool) wrapAround(b, 0, FRAME);
  });

  // -------------------------------------------------- leaning rubble piles ---
  const rubbleMat = new THREE.MeshStandardMaterial({ map: makeRockTextureSafe(anisotropy), color: 0x8b8681, roughness: 1, metalness: 0 });
  const rubbleGeo = new THREE.DodecahedronGeometry(1, 0);
  const RUBBLE = 80;
  const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, RUBBLE);
  rubble.castShadow = true;
  rubble.receiveShadow = true;
  group.add(rubble);
  const rubbleData = [];
  for (let i = 0; i < RUBBLE; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -Math.floor(i / 2) * (FRAME / (RUBBLE / 2)) - 5;
    rubbleData.push({
      x: side * rng.range(ROAD_WIDTH / 2 + 0.9, ROAD_WIDTH / 2 + 10),
      y: rng.range(-0.5, 0.3),
      z,
      s: rng.range(0.3, 1.75),
      rx: rng.range(0, TAU),
      ry: rng.range(0, TAU),
      rz: rng.range(0, TAU),
    });
  }
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  updaters.push(() => {
    for (let i = 0; i < RUBBLE; i++) {
      const d = rubbleData[i];
      const rel = ((d.z % FRAME) + FRAME) % FRAME;
      tmpP.set(d.x, d.y, d.z + FRAME - rel - FRAME / 2);
      tmpE.set(d.rx, d.ry, d.rz);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(d.s, d.s * 0.8, d.s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      rubble.setMatrixAt(i, tmpM);
    }
    rubble.instanceMatrix.needsUpdate = true;
  });

  // ------------------------------------------------------ street furniture --
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: 0.7, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const lampGeo = new THREE.BoxGeometry(1.1, 0.22, 0.4);
  const POLES = 16;
  const poles = [];
  for (let i = 0; i < POLES; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.5;
    pole.castShadow = true;
    const arm = new THREE.Mesh(lampGeo, poleMat);
    arm.position.set(side * 0.55, 6.9, 0);
    pole.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), poleMat));
    pole.children[pole.children.length - 1].position.set(side * 0.5, 6.4, 0);
    g.add(pole, arm);
    // some poles are knocked over
    const fallen = rng.chance(0.35);
    if (fallen) {
      g.rotation.z = side * rng.range(0.9, 1.35);
      g.rotation.x = rng.range(-0.3, 0.3);
      g.position.y = 0;
    }
    g.position.set(side * (ROAD_WIDTH / 2 + 1.6), 0, -i * 18 - 8);
    group.add(g);
    poles.push(g);
  }
  updaters.push(() => {
    for (const p of poles) wrapAround(p, 0, FRAME);
  });

  // burning barrels: warm point lights + flame billboards
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a3a2a, roughness: 0.8, metalness: 0.5, emissive: 0x812200, emissiveIntensity: 0.6 });
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10);
  const glowTex = makeGlowTexture(128, '255,170,80');
  const flameMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const barrels = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(side * (ROAD_WIDTH / 2 + rng.range(0.8, 6)), 0.52, -i * 32 - 12);
    b.castShadow = true;
    group.add(b);
    const flame = new THREE.Sprite(flameMat.clone());
    flame.material.opacity = 0.85;
    flame.scale.set(2.2, 3.0, 1);
    flame.position.copy(b.position).add(new THREE.Vector3(0, 1.1, 0));
    group.add(flame);
    const light = new THREE.PointLight(0xff8a3a, 14, 16, 2);
    light.position.copy(b.position).add(new THREE.Vector3(0, 1.4, 0));
    group.add(light);
    barrels.push({ b, flame, light, phase: rng() * TAU, base: b.position.x });
  }
  updaters.push((dt, pz, time) => {
    for (const bl of barrels) {
      wrapAround(bl.b, 0, FRAME);
      const relz = bl.b.position.z;
      bl.flame.position.set(bl.b.position.x, 1.5 + Math.sin(time * 9 + bl.phase) * 0.08, relz);
      const f = 0.86 + Math.sin(time * 13 + bl.phase) * 0.1 + Math.sin(time * 27 + bl.phase * 2) * 0.05;
      bl.flame.scale.set(2.2 * f, 3.1 * f, 1);
      bl.light.position.set(bl.b.position.x, 1.6, relz);
      bl.light.intensity = 12 + Math.sin(time * 17 + bl.phase) * 3.5;
      void pz;
    }
  });

  // -------------------------------------------------------- smoke & dust ----
  const smokeTex = makeSmokeTexture(128, 5);
  const smokeMat = new THREE.MeshBasicMaterial({
    map: smokeTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.22,
    color: 0x9a92a8,
  });
  const SMOKE = 34;
  const smoke = [];
  for (let i = 0; i < SMOKE; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), smokeMat);
    const side = rng.chance(0.5) ? -1 : 1;
    s.position.set(side * rng.range(4, 34), rng.range(4, 18), -rng.range(0, FRAME));
    s.scale.setScalar(rng.range(8, 26));
    group.add(s);
    smoke.push({ s, drift: rng.range(0.4, 1.6), phase: rng() * TAU, spin: rng.range(-0.05, 0.05) });
  }
  updaters.push((dt, pz, time) => {
    for (const sm of smoke) {
      sm.s.position.z += dt * sm.drift;
      sm.s.position.x += Math.sin(time * 0.3 + sm.phase) * dt * 0.6;
      sm.s.rotation.z += dt * sm.spin;
      sm.s.rotation.y = Math.atan2(sm.s.position.x, 12) * 0.15;
      const rel = sm.s.position.z - 0;
      if (rel > 40) {
        sm.s.position.z -= 40 + FRAME;
        sm.s.position.x = (rng.chance(0.5) ? -1 : 1) * rng.range(4, 34);
        sm.s.position.y = rng.range(4, 18);
      }
      void pz;
    }
  });

  // floating embers
  const emberCount = 260;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(emberCount * 3);
  const emberVel = new Float32Array(emberCount * 3);
  for (let i = 0; i < emberCount; i++) {
    emberPos[i * 3] = rng.range(-26, 26);
    emberPos[i * 3 + 1] = rng.range(0, 16);
    emberPos[i * 3 + 2] = -rng.range(0, FRAME);
    emberVel[i * 3] = rng.range(-0.4, 0.4);
    emberVel[i * 3 + 1] = rng.range(0.2, 1.1);
    emberVel[i * 3 + 2] = rng.range(0.1, 0.9);
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const emberMat = new THREE.PointsMaterial({
    color: 0xffb066,
    size: 0.16,
    map: glowTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.9,
    sizeAttenuation: true,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  group.add(embers);
  updaters.push((dt, pz, time) => {
    const pa = emberGeo.attributes.position.array;
    for (let i = 0; i < emberCount; i++) {
      pa[i * 3] += emberVel[i * 3] * dt + Math.sin(time + i) * dt * 0.3;
      pa[i * 3 + 1] += emberVel[i * 3 + 1] * dt;
      pa[i * 3 + 2] += emberVel[i * 3 + 2] * dt;
      if (pa[i * 3 + 1] > 17) pa[i * 3 + 1] = -0.5;
      if (pa[i * 3 + 2] > 30) pa[i * 3 + 2] = -FRAME;
      if (Math.abs(pa[i * 3]) > 30) pa[i * 3] *= -0.95;
    }
    emberGeo.attributes.position.needsUpdate = true;
    void pz;
  });

  // --------------------------------------------------------- debris bits ----
  // small chunks that stream past the player for a sense of speed
  const debrisCount = 120;
  const debrisGeo = new THREE.IcosahedronGeometry(0.12, 0);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 1, metalness: 0 });
  const debris = new THREE.InstancedMesh(debrisGeo, debrisMat, debrisCount);
  group.add(debris);
  const debrisData = [];
  for (let i = 0; i < debrisCount; i++) {
    debrisData.push({
      x: rng.range(-ROAD_WIDTH / 2 - 6, ROAD_WIDTH / 2 + 6),
      y: rng.range(0.05, 0.5),
      z: -rng.range(0, FRAME),
      s: rng.range(0.4, 1.6),
      spin: rng.range(-3, 3),
    });
  }
  updaters.push((dt) => {
    for (let i = 0; i < debrisCount; i++) {
      const d = debrisData[i];
      d.z += dt * 18;
      if (d.z > 26) d.z -= FRAME;
      tmpP.set(d.x, d.y, d.z);
      tmpE.set(d.spin * d.z * 0.05, d.spin * d.z * 0.03, 0);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(d.s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      debris.setMatrixAt(i, tmpM);
    }
    debris.instanceMatrix.needsUpdate = true;
  });

  // ground fog band near the horizon
  const fogPlaneMat = new THREE.MeshBasicMaterial({
    map: smokeTex,
    color: 0x8a7f9c,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const groundFog = new THREE.Mesh(new THREE.PlaneGeometry(120, 30), fogPlaneMat);
  groundFog.position.set(0, 2.4, -70);
  group.add(groundFog);
  updaters.push((dt, pz, time) => {
    groundFog.position.z = -70 + Math.sin(time * 0.2) * 3;
    groundFog.material.opacity = 0.13 + Math.sin(time * 0.6) * 0.03;
    void dt; void pz;
  });

  function update(dt, playerZ, time) {
    for (const u of updaters) u(dt, playerZ, time);
  }

  return { group, update, roadWidth: ROAD_WIDTH };
}

/** Lazy import shim so the rock texture is created once, with anisotropy. */
let _rockTexCache = null;
function makeRockTextureSafe(aniso) {
  if (!_rockTexCache) {
    // imported lazily to keep the module graph simple
    _rockTexCache = makeRockTextureImpl();
  }
  _rockTexCache.anisotropy = aniso;
  return _rockTexCache;
}
function makeRockTextureImpl() {
  // duplicated minimal rock generator (avoids a circular import with textures.js)
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rng = makeRng(33);
  g.fillStyle = '#6b6a68';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng() * 3 + 0.4;
    const v = 60 + rng() * 120;
    g.fillStyle = `rgba(${v},${v},${v * 0.95},${0.2 + rng() * 0.5})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { RENDER, lerp, clamp };
