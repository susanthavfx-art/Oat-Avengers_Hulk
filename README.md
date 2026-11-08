# Hulk Smash Run 🟢💥

An endless 3D runner built around the rigged **Hulk** model already in this repo
(`Model.glb`). The big guy sprints down an endless ruined city street, smashing
crates and boulders, collecting coins and stars, hurdling rubble and dodging
rockets.

**Play:** open `index.html` from any static web server (GitHub Pages works out of
the box — the workflow in `.github/workflows/static.yml` publishes the repo root).

```bash
# local preview
python3 -m http.server 8000
# then browse http://localhost:8000
```

> A server is required (ES modules + `fetch` of the GLB); opening the file
> directly with `file://` will not work in most browsers.

---

## Controls

| Action          | Keyboard                | Touch                        |
| --------------- | ----------------------- | ---------------------------- |
| Move left/right | `←` `→` or `A` `D`      | Swipe left/right, ◀ ▶ buttons |
| Jump            | `↑` / `W` / `Space`     | Swipe up, tap, JUMP button    |
| Smash           | `↓` / `S` / `F` / `Shift` | Swipe down, hold, SMASH button |
| Pause           | `P` / `Esc`             | ⏸ button                     |
| Mute            | `M`                     | 🔊 button                    |

Combat is intentionally simple to read at speed: **down/smash** while a crate or
boulder is in front of you destroys it for points and loot; hitting one without
smashing costs a heart.

---

## What's in the game

- **Endless run** — the hero never stops running; the world scrolls past and
  speeds up continuously (15.5 → 34 u/s) with milestone banners.
- **Looping run animation** — the authored `dash` clip from `Model.glb` is the
  sprint; its loop seam is smoothed at load. Jump tuck, smash swings and the
  stagger when hit are additive layers on top of it, so the source animation is
  never thrown away.
- **Smashing** — wooden crates and rocks shatter into debris particles, drop
  coins, and feed the combo multiplier.
- **Collectibles** — spinning Hulk medallion coins and rare star pickups
  (star = points + a speed boost).
- **Obstacles** — jump barriers and burning ground, dodge blockades and homing
  rockets. Clearing a hazard at the last second awards a *near miss* bonus.
- **3-lane movement** with fast, readable lane slides and a camera that banks
  into the turn.
- **Destroyed city environment** — scrolling cracked road, ruined facades with
  lit windows, leaning rubble piles, toppled street lights, burning barrels with
  real point lights, drifting smoke, embers, a parallax skyline and a stormy
  dusk sky dome.
- **Procedural audio** — every SFX and the industrial music bed are synthesised
  with WebAudio; no audio files are shipped.
- **Quality tiers** — `?q=low|medium|high` (default auto-detects). Low disables
  shadows and thins out particles for integrated/software GPUs.

Scoring: coins 12, stars 65, crate 35, boulder 55, jumped barrier 18, near miss
22, plus distance. Combos build a multiplier up to ×12.

---

## Tech

- Plain ES modules, **no build step**. [three.js r180](https://threejs.org) is
  vendored under `vendor/three/` (MIT) so GitHub Pages can serve it directly.
- `src/core/` — math helpers, input (keyboard/pointer/on-screen), WebAudio synth.
- `src/game/` — `game.js` orchestrates; `hero.js` owns the Hulk rig;
  `world.js` builds the city; `entities.js` pools obstacles/collectibles;
  `director.js` composes spawn *patterns*; `particles.js` handles VFX;
  `renderer.js` sets up the look; `textures.js` draws procedural materials.
- `src/ui/hud.js` + `styles/game.css` — the DOM HUD and screens.

### Debug / tooling hooks

- `?manual=1` — stops the internal `requestAnimationFrame` loop so a test
  harness can call `window.__game.step(dt, render)` deterministically.
- `window.__game` exposes the live game object (score, entities, hero state).

`herodiag.html`, `herostage.html`, `ikcheck.html`, `clipstudy.html`,
`axisnum.html` and friends are the rig-inspection tools used while building the
run cycle; they are not part of the game.

---

## Credits

Hulk model © MARVEL — used here under the terms of the Oateo "Oat Avengers"
campaign assets provided in this repository.
