// ---------------------------------------------------------------------------
// Renderer / scene / camera rig. The look is a moody dusk destroyed city with
// heavy fog, warm rim light and a low sun breaking through the smoke.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { RENDER } from './config.js';
import { clamp, expDamp, TAU } from '../core/mathx.js';

export function createRenderer(canvas, quality = 'high') {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.42;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x191522);
  scene.fog = new THREE.FogExp2(RENDER.fogColor, 0.0078);
  return scene;
}

export function createLighting(scene, quality = 'high') {
  const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x3a2630, quality === 'low' ? 1.9 : 1.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd9a8, 3.1);
  sun.position.set(-16, 22, 24);
  sun.castShadow = quality !== 'low';
  const shadowSize = quality === 'high' ? RENDER.shadowMapSize : quality === 'medium' ? 1024 : 512;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  const s = 22;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  // cool fill from the front so silhouettes stay readable against the fog
  const fill = new THREE.DirectionalLight(0x7aa0ff, 1.05);
  fill.position.set(10, 9, -18);
  scene.add(fill);

  const rim = new THREE.PointLight(0xff8a4a, quality === 'low' ? 0 : 26, 26, 2);
  rim.position.set(0, 6, -14);
  scene.add(rim);

  // A soft key light that rides with the hero so he never disappears into the
  // smoke — cheap, no shadows, purely for readability.
  const heroLight = new THREE.PointLight(0xfff2d6, quality === 'low' ? 14 : 20, 14, 2);
  scene.add(heroLight);

  const heroFill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  scene.add(heroFill);
  scene.add(heroFill.target);

  return { hemi, sun, fill, rim, heroLight, heroFill };
}

const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, RENDER.cameraHeight, RENDER.cameraDistance);
    this.look = new THREE.Vector3(0, RENDER.cameraLookHeight, -6);
    this.shake = 0;
    this.shakeTime = 0;
    this.fovTarget = RENDER.cameraFov;
    this.roll = 0;
    this.baseY = RENDER.cameraHeight;
    // portrait screens need the camera further back and a wider lens so the
    // three lanes stay readable
    this.distanceScale = 1;
    this.fovExtra = 0;
  }

  shakeBy(amount) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  snap(targetX, targetY, targetZ) {
    this.pos.set(targetX * RENDER.cameraLateral, RENDER.cameraHeight, targetZ + RENDER.cameraDistance);
    this.look.set(targetX * 0.5, RENDER.cameraLookHeight + targetY * 0.5, targetZ + RENDER.cameraLookAhead);
  }

  update(dt, player, speedRatio, extra = {}) {
    const px = player.x;
    const py = Math.max(player.y, 0);
    const pz = player.z || 0;

    // follow the player laterally but never fully — keeps the lane readable
    const targetX = px * RENDER.cameraLateral + (extra.lookShift || 0);
    const targetY = RENDER.cameraHeight * (0.9 + this.distanceScale * 0.14) + py * 0.28 + (extra.bob || 0);
    const targetZ = pz + RENDER.cameraDistance * this.distanceScale + speedRatio * 0.7;

    this.pos.x = expDamp(this.pos.x, targetX, 5.2, dt);
    this.pos.y = expDamp(this.pos.y, targetY, 4.4, dt);
    this.pos.z = expDamp(this.pos.z, targetZ, 9.0, dt);

    const lookX = px * 0.62 + (extra.lookShift || 0) * 1.2;
    const lookY = RENDER.cameraLookHeight + py * 0.55;
    const lookZ = pz + RENDER.cameraLookAhead;
    this.look.x = expDamp(this.look.x, lookX, 6.0, dt);
    this.look.y = expDamp(this.look.y, lookY, 5.0, dt);
    this.look.z = expDamp(this.look.z, lookZ, 8.0, dt);

    // camera shake (impact, landing, explosions)
    this.shakeTime += dt;
    const s = this.shake;
    const sx = Math.sin(this.shakeTime * 61.0) * 0.1 * s + Math.sin(this.shakeTime * 23.7) * 0.05 * s;
    const sy = Math.cos(this.shakeTime * 53.0) * 0.1 * s + Math.sin(this.shakeTime * 31.3) * 0.04 * s;
    this.shake = Math.max(0, this.shake - dt * (2.6 + this.shake * 3.0));

    this.camera.position.copy(this.pos);
    this.camera.position.x += sx;
    this.camera.position.y += sy;
    this.camera.lookAt(this.look);

    // subtle bank when sliding between lanes
    this.roll = expDamp(this.roll, -player.lateralVelocity * 0.022, 6, dt);
    this.camera.rotateZ(this.roll);

    const targetFov = RENDER.cameraFov + this.fovExtra + speedRatio * 9;
    this.fovTarget = expDamp(this.fovTarget, targetFov, 3, dt);
    this.camera.fov = this.fovTarget;
    this.camera.updateProjectionMatrix();
  }

  screenShakeFromVector(v) {
    this.shakeBy(clamp(v, 0, 1.4));
  }
}

export { UP, TAU };
