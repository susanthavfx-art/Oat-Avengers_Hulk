// ---------------------------------------------------------------------------
// Unified input layer: keyboard, pointer/touch gestures and on-screen buttons
// all funnel into the same intent stream the gameplay code consumes.
// ---------------------------------------------------------------------------

const KEY_MAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'smash',
  KeyS: 'smash',
  KeyJ: 'smash',
  KeyF: 'smash',
  KeyL: 'smash',
  ShiftLeft: 'smash',
  ShiftRight: 'smash',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.axisHeld = new Set();
    this.axisPressed = new Set();
    this.pointerStart = null;
    this.pointerId = null;
    this.swipeHandled = false;
    this.enabled = true;
    this.lastInputWasTouch = false;

    this._onKeyDown = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      // Keep the browser from scrolling / re-clicking focused buttons.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.press(action);
    };
    this._onKeyUp = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      this.release(action);
    };
    this._onBlur = () => {
      this.held.clear();
      this.axisHeld.clear();
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    if (canvas) this._bindPointer(canvas);
    this._bindButtons();
  }

  _bindPointer(canvas) {
    const SWIPE_THRESHOLD = 26; // css pixels
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.lastInputWasTouch = e.pointerType === 'touch';
      this.pointerStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.pointerId = e.pointerId;
      this.swipeHandled = false;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || this.pointerId !== e.pointerId || !this.pointerStart) return;
      const dx = e.clientX - this.pointerStart.x;
      const dy = e.clientY - this.pointerStart.y;
      if (this.swipeHandled) return;
      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 0.9) {
        this.press(dx > 0 ? 'right' : 'left');
        this.swipeHandled = true;
      } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
        this.press(dy > 0 ? 'smash' : 'jump');
        this.swipeHandled = true;
      }
    });

    const endPointer = (e) => {
      if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
      if (this.pointerStart && !this.swipeHandled) {
        const dt = performance.now() - this.pointerStart.t;
        // A quick tap is a jump, a longer press swings.
        this.press(dt < 220 ? 'jump' : 'smash');
      }
      this.pointerStart = null;
      this.pointerId = null;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
  }

  _bindButtons() {
    document.querySelectorAll('[data-action]').forEach((el) => {
      const action = el.dataset.action;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.lastInputWasTouch = true;
        this.press(action);
        el.classList.add('is-down');
      };
      const up = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.release(action);
        el.classList.remove('is-down');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  press(action) {
    if (!this.enabled) return;
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
    if (action === 'left' || action === 'right') {
      if (!this.axisHeld.has(action)) this.axisPressed.add(action);
      this.axisHeld.add(action);
      // Keyboard: left+right → treat the newest as the only one
      const other = action === 'left' ? 'right' : 'left';
      this.axisHeld.delete(other);
    }
  }

  release(action) {
    this.held.delete(action);
    this.axisHeld.delete(action);
    this.released.add(action);
  }

  /** Horizontal intent in [-1,1] from currently held keys. */
  get axis() {
    let v = 0;
    if (this.axisHeld.has('left')) v -= 1;
    if (this.axisHeld.has('right')) v += 1;
    return v;
  }

  /** Consume a one-frame press. */
  consume(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  consumeAxisPress() {
    if (this.axisPressed.size === 0) return 0;
    const hasL = this.axisPressed.has('left');
    const hasR = this.axisPressed.has('right');
    this.axisPressed.clear();
    if (hasL && hasR) return this.lastInputWasTouch ? 0 : 0;
    return hasL ? -1 : hasR ? 1 : 0;
  }

  isDown(action) {
    return this.held.has(action);
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  /** Clears held state, used when pausing or restarting. */
  reset() {
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
    this.axisHeld.clear();
    this.axisPressed.clear();
    this.pointerStart = null;
    this.pointerId = null;
  }
}
