// ---------------------------------------------------------------------------
// Fully procedural audio: every sound effect and the music bed are synthesised
// with the WebAudio API at runtime, so the game ships without any audio files.
// ---------------------------------------------------------------------------

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> hz

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.musicPlaying = false;
    this.intensity = 0;
    this.started = false;
    this._noiseBuffer = null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 16;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    // shared noise buffer
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    this.started = true;
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // -- primitives ----------------------------------------------------------

  _env(gainNode, t0, attack, decay, peak, sustain = 0.0001) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + attack + decay);
  }

  _tone({ freq, type = 'sine', dur = 0.2, gain = 0.3, attack = 0.005, slideTo = null, dest = null, delay = 0, detune = 0 }) {
    if (!this.ctx) return null;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.value = detune;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    this._env(g, t0, attack, dur, gain);
    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + attack + dur + 0.05);
    return { osc, g };
  }

  _noise({ dur = 0.3, gain = 0.3, filter = 'lowpass', freq = 900, freqEnd = null, q = 1, attack = 0.004, delay = 0, dest = null }) {
    if (!this.ctx || !this._noiseBuffer) return null;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.value = 1;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 40), t0 + dur);
    const g = this.ctx.createGain();
    this._env(g, t0, attack, dur, gain);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxGain);
    src.start(t0);
    src.stop(t0 + attack + dur + 0.05);
    return { src, g };
  }

  // -- game sounds ---------------------------------------------------------

  jump() {
    this._tone({ freq: 220, slideTo: 460, type: 'triangle', dur: 0.16, gain: 0.16 });
    this._noise({ dur: 0.16, gain: 0.1, filter: 'highpass', freq: 700, freqEnd: 2200 });
  }

  land(intensity = 0.5) {
    this._tone({ freq: 120, slideTo: 46, type: 'sine', dur: 0.16, gain: 0.22 * intensity });
    this._noise({ dur: 0.14, gain: 0.12 * intensity, filter: 'lowpass', freq: 900, freqEnd: 220 });
  }

  swipe() {
    this._noise({ dur: 0.18, gain: 0.1, filter: 'bandpass', freq: 320, freqEnd: 1400, q: 1.4 });
  }

  /** Wind-up whoosh for the smash swing (alias used by gameplay code). */
  smashSwing() {
    this._noise({ dur: 0.26, gain: 0.14, filter: 'bandpass', freq: 240, freqEnd: 1600, q: 1.8 });
    this._tone({ freq: 190, slideTo: 92, type: 'triangle', dur: 0.2, gain: 0.1 });
  }

  /** Short blip when the player switches lanes. */
  lane() {
    this._tone({ freq: 420, slideTo: 520, type: 'sine', dur: 0.07, gain: 0.05 });
  }

  smashImpact(heavy = false) {
    const t = this.time;
    this._noise({ dur: heavy ? 0.34 : 0.2, gain: heavy ? 0.42 : 0.3, filter: 'lowpass', freq: 3200, freqEnd: 180 });
    this._tone({ freq: heavy ? 92 : 120, slideTo: 34, type: 'sine', dur: heavy ? 0.3 : 0.2, gain: heavy ? 0.42 : 0.3 });
    this._tone({ freq: 380, slideTo: 120, type: 'square', dur: 0.06, gain: 0.06 });
    // splintering tail
    this._noise({ dur: 0.22, gain: 0.12, filter: 'highpass', freq: 1400, freqEnd: 5200, delay: 0.03 });
    void t;
  }

  crateBreak() {
    this._noise({ dur: 0.26, gain: 0.3, filter: 'bandpass', freq: 1500, freqEnd: 420, q: 0.9 });
    this._tone({ freq: 160, slideTo: 70, type: 'sawtooth', dur: 0.14, gain: 0.12 });
  }

  rockBreak() {
    this._noise({ dur: 0.34, gain: 0.34, filter: 'lowpass', freq: 2200, freqEnd: 220 });
    this._tone({ freq: 78, slideTo: 28, type: 'sine', dur: 0.3, gain: 0.3 });
  }

  coin() {
    const base = NOTE(84);
    this._tone({ freq: base, type: 'sine', dur: 0.08, gain: 0.12 });
    this._tone({ freq: base * 1.5, type: 'sine', dur: 0.14, gain: 0.1, delay: 0.05 });
  }

  star() {
    [NOTE(88), NOTE(92), NOTE(95), NOTE(100)].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.11, delay: i * 0.055 }));
    this._noise({ dur: 0.5, gain: 0.05, filter: 'highpass', freq: 4000, freqEnd: 8000 });
  }

  hurt() {
    this._tone({ freq: 180, slideTo: 60, type: 'sawtooth', dur: 0.28, gain: 0.22 });
    this._noise({ dur: 0.22, gain: 0.18, filter: 'lowpass', freq: 1400, freqEnd: 200 });
  }

  whoosh() {
    this._noise({ dur: 0.5, gain: 0.14, filter: 'bandpass', freq: 180, freqEnd: 900, q: 2.2 });
  }

  explosion() {
    this._noise({ dur: 0.7, gain: 0.4, filter: 'lowpass', freq: 2600, freqEnd: 90 });
    this._tone({ freq: 64, slideTo: 22, type: 'sine', dur: 0.6, gain: 0.36 });
  }

  rocketLaunch() {
    this._noise({ dur: 0.5, gain: 0.1, filter: 'bandpass', freq: 900, freqEnd: 2600, q: 1.2 });
  }

  combo(level) {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const n = 72 + scale[Math.min(level, scale.length - 1)];
    this._tone({ freq: NOTE(n), type: 'square', dur: 0.1, gain: 0.06 });
  }

  powerup() {
    [NOTE(60), NOTE(67), NOTE(72), NOTE(79), NOTE(84)].forEach((f, i) =>
      this._tone({ freq: f, type: 'sawtooth', dur: 0.18, gain: 0.09, delay: i * 0.07 }));
  }

  gameOver() {
    [NOTE(72), NOTE(68), NOTE(64), NOTE(59)].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.42, gain: 0.16, delay: i * 0.19 }));
    this._noise({ dur: 1.1, gain: 0.06, filter: 'lowpass', freq: 800, freqEnd: 120, delay: 0.2 });
  }

  levelUp() {
    [NOTE(67), NOTE(72), NOTE(76), NOTE(79)].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.1, delay: i * 0.08 }));
  }

  // -- music bed -----------------------------------------------------------

  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    this.musicTimer = 0;
    this.musicGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 1.2);
  }

  stopMusic(fade = 1.0) {
    if (!this.ctx) return;
    this.musicPlaying = false;
    this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade * 0.4);
  }

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  /** Drives a simple dark industrial loop; called each frame. */
  update(dt) {
    if (!this.ctx || !this.musicPlaying) return;
    const bpm = 128 + this.intensity * 26;
    const beat = 60 / bpm;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer += beat / 2; // eighth notes
    const step = this.musicStep++ % 16;
    const t0 = this.ctx.currentTime;
    const mg = this.musicGain;

    // kick on 0, 4, 8, 12 ; snare-ish noise on 4, 12
    if (step % 4 === 0) {
      this._tone({ freq: 110, slideTo: 42, type: 'sine', dur: 0.22, gain: 0.5, dest: mg });
    }
    if (step === 4 || step === 12) {
      this._noise({ dur: 0.12, gain: 0.22, filter: 'bandpass', freq: 1800, q: 1.1, dest: mg });
    }
    if (step % 2 === 1) {
      this._noise({ dur: 0.05, gain: 0.06 + this.intensity * 0.05, filter: 'highpass', freq: 6000, dest: mg });
    }
    // bass ostinato, minor pentatonic movement
    const bassSeq = [0, 0, 3, 0, 5, 0, 3, 7, 0, 0, 3, 0, 8, 7, 5, 3];
    if (step % 2 === 0) {
      const semis = bassSeq[step];
      this._tone({ freq: NOTE(33 + semis), type: 'sawtooth', dur: 0.19, gain: 0.16, dest: mg });
    }
    // pads every bar
    if (step === 0) {
      const chord = [[0, 3, 7], [0, 4, 7], [0, 3, 8], [0, 5, 7]][Math.floor(this.musicStep / 16) % 4];
      chord.forEach((s) => {
        this._tone({ freq: NOTE(45 + s), type: 'triangle', dur: 1.6, gain: 0.05, attack: 0.25, dest: mg });
      });
    }
    // sparse lead stabs when things get hectic
    if (this.intensity > 0.45 && (step === 6 || step === 14)) {
      this._tone({ freq: NOTE(69 + (step === 6 ? 3 : 5)), type: 'square', dur: 0.14, gain: 0.05, dest: mg });
    }
    void t0;
  }
}
