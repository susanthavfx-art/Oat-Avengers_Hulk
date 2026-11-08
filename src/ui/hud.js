// ---------------------------------------------------------------------------
// HUD + screens. Keeps the DOM out of the game loop: the game only pushes
// values in here and this module decides what actually changed.
// ---------------------------------------------------------------------------

import { clamp } from '../core/mathx.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const els = {
    screenStart: $('screen-start'),
    screenPause: $('screen-pause'),
    screenOver: $('screen-over'),
    score: $('hud-score'),
    stars: $('hud-stars'),
    coins: $('hud-coins'),
    dist: $('hud-dist'),
    bonus: $('hud-bonus'),
    speedFill: $('hud-speed-fill'),
    combo: $('hud-combo'),
    comboValue: $('hud-combo-value'),
    comboFill: $('hud-combo-fill'),
    toast: $('toast'),
    finalScore: $('final-score'),
    finalDistance: $('final-distance'),
    finalCoins: $('final-coins'),
    finalStars: $('final-stars'),
    finalBest: $('final-best'),
    best: $('hud-best'),
    loading: $('loading'),
    loadingFill: $('loading-fill'),
    popups: $('popups'),
    stage: $('stage-banner'),
    soundBtn: $('btn-sound'),
    pauseBtn: $('btn-pause'),
    hint: $('hud-hint'),
    meter: $('hud-rage-wrap'),
    hearts: $('hud-hearts'),
  };

  let lastScore = -1;
  let lastHealth = -1;
  let lastCombo = -1;
  let toastTimer = 0;
  let popupId = 0;

  function setText(el, v) {
    if (el && el.textContent !== String(v)) el.textContent = v;
  }

  function showScreen(name) {
    for (const key of ['screenStart', 'screenPause', 'screenOver']) {
      const el = els[key];
      if (!el) continue;
      const want = key === name;
      el.classList.toggle('is-open', want);
      el.setAttribute('aria-hidden', want ? 'false' : 'true');
    }
  }

  function setLoading(p, label) {
    if (!els.loading) return;
    if (els.loadingFill) els.loadingFill.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    if (label && els.loadingLabel) els.loadingLabel.textContent = label;
    els.loading.classList.toggle('is-done', p >= 1);
  }

  function update(state) {
    if (state.score !== lastScore) {
      lastScore = state.score;
      setText(els.score, Math.floor(state.score).toLocaleString('en-US'));
    }
    setText(els.stars, state.stars);
    setText(els.coins, state.coins);
    setText(els.dist, `${Math.floor(state.distance)}m`);
    if (els.best) setText(els.best, Math.floor(state.best).toLocaleString('en-US'));
    if (els.speedFill) els.speedFill.style.transform = `scaleX(${clamp(state.speedRatio, 0.02, 1)})`;
    if (els.bonus) {
      els.bonus.textContent = state.bonus ? `x${state.bonus}` : '';
      els.bonus.classList.toggle('is-visible', !!state.bonus);
    }
    if (state.combo !== lastCombo) {
      lastCombo = state.combo;
      if (els.combo) {
        els.combo.classList.toggle('is-visible', state.combo > 0);
        setText(els.comboValue, state.combo > 0 ? `${state.combo} HIT` : '');
        setText(els.comboFill, '');
      }
    }
    if (els.comboFill) els.comboFill.style.transform = `scaleX(${clamp(state.comboTimer, 0, 1)})`;
    if (els.hint) els.hint.classList.toggle('is-hidden', state.distance > 60);
    if (els.hearts && state.health !== lastHealth) {
      lastHealth = state.health;
      const pips = els.hearts.querySelectorAll('i');
      pips.forEach((p, i) => p.classList.toggle('dead', i >= state.health));
      if (state.health <= 1) els.hearts.classList.add('is-critical');
      else els.hearts.classList.remove('is-critical');
    }
  }

  function toast(msg, ms = 1600, kind = '') {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.className = `toast is-visible ${kind}`;
    clearTimeout(toastTimer);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.className = 'toast';
    }, ms);
  }

  function stageBanner(title, sub, ms = 2400) {
    if (!els.stage) return;
    els.stage.innerHTML = `<strong>${title}</strong><span>${sub || ''}</span>`;
    els.stage.classList.add('is-visible');
    setTimeout(() => els.stage.classList.remove('is-visible'), ms);
  }

  /** Floating +points text anchored to a screen position. */
  function popup(x, y, text, kind = '') {
    if (!els.popups) return;
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.id = String(popupId++);
    els.popups.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function setSoundIcon(muted) {
    if (!els.soundBtn) return;
    els.soundBtn.classList.toggle('is-muted', !!muted);
    els.soundBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  function showGameOver(state) {
    setText(els.finalScore, Math.floor(state.score).toLocaleString('en-US'));
    setText(els.finalDistance, `${Math.floor(state.distance)} m`);
    setText(els.finalCoins, state.coins);
    setText(els.finalStars, state.stars);
    setText(els.finalBest, Math.floor(state.best).toLocaleString('en-US'));
    showScreen('screenOver');
  }

  function hideLoading() {
    if (!els.loading) return;
    els.loading.classList.add('is-gone');
    // belt and braces: the fade needs animation frames, which a paused tab
    // (or the deterministic test harness) may not produce.
    setTimeout(() => {
      if (els.loading) els.loading.style.display = 'none';
    }, 600);
  }

  function pulseMeter(kind) {
    if (!els.meter) return;
    els.meter.classList.remove('is-hit');
    void els.meter.offsetWidth;
    els.meter.classList.add('is-hit');
    els.meter.dataset.kind = kind;
  }

  return {
    els,
    update,
    showScreen,
    showGameOver,
    setLoading,
    hideLoading,
    toast,
    stageBanner,
    popup,
    setSoundIcon,
    pulseMeter,
  };
}
