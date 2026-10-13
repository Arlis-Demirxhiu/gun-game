// Every sound is synthesized with WebAudio: filtered noise bursts and oscillators.

const SHOTS = {
  pistol: { vol: 0.7, dur: 0.13, f: 4200, f2: 800, thump: 190, thumpDur: 0.08, tail: 0.3 },
  deagle: { vol: 1.0, dur: 0.25, f: 3000, f2: 450, thump: 105, thumpDur: 0.16, tail: 0.6 },
  smg: { vol: 0.55, dur: 0.09, f: 3600, f2: 900, thump: 160, thumpDur: 0.06, tail: 0.22 },
  rifle: { vol: 0.9, dur: 0.17, f: 2500, f2: 450, thump: 115, thumpDur: 0.11, tail: 0.45 },
  rifle2: { vol: 0.8, dur: 0.14, f: 3000, f2: 600, thump: 135, thumpDur: 0.09, tail: 0.4 },
  awp: { vol: 1.3, dur: 0.45, f: 2100, f2: 260, thump: 75, thumpDur: 0.32, tail: 1.1 },
  scout: { vol: 1.05, dur: 0.3, f: 2800, f2: 380, thump: 95, thumpDur: 0.2, tail: 0.8 },
  sniper: { vol: 1.1, dur: 0.26, f: 2300, f2: 330, thump: 85, thumpDur: 0.2, tail: 0.75 },
  shotgun: { vol: 1.25, dur: 0.32, f: 1700, f2: 220, thump: 70, thumpDur: 0.24, tail: 0.7 },
  mg: { vol: 0.95, dur: 0.15, f: 2300, f2: 420, thump: 105, thumpDur: 0.1, tail: 0.4 },
  silenced: { vol: 0.32, dur: 0.07, f: 2600, f2: 1300, thump: 260, thumpDur: 0.04, tail: 0.06 },
};

export class Sound {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  listener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  out(pos, vol = 1) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.1;
      p.maxDistance = 300;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noise(dest, t0, dur, { type = 'lowpass', f = 1000, f2 = null, q = 0.8, vol = 1, attack = 0.002 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  tone(dest, t0, dur, { type = 'sine', f = 440, f2 = null, vol = 0.5, attack = 0.003 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  shot(kind, pos) {
    if (!this.ctx) return;
    const P = SHOTS[kind] || SHOTS.rifle;
    const t = this.ctx.currentTime;
    const d = this.out(pos, P.vol);
    this.noise(d, t, P.dur, { f: P.f, f2: P.f2, vol: 1 });
    this.noise(d, t, 0.03, { type: 'highpass', f: 3000, vol: 0.5 });
    this.tone(d, t, P.thumpDur, { f: P.thump, f2: 40, vol: 0.9 });
    this.noise(d, t + 0.02, P.tail, { f: 700, f2: 180, vol: 0.18, attack: 0.02 });
  }

  click(t0, f = 1800, vol = 0.25) {
    const d = this.out(null, 1);
    this.noise(d, t0, 0.04, { type: 'bandpass', f, q: 3, vol });
    this.tone(d, t0, 0.03, { type: 'square', f: f / 3, vol: vol * 0.3 });
  }

  dry() { if (this.ctx) this.click(this.ctx.currentTime, 2400, 0.2); }
  draw() { if (this.ctx) this.click(this.ctx.currentTime, 1400, 0.15); }
  zoom() { if (this.ctx) this.click(this.ctx.currentTime, 3000, 0.12); }

  reload(dur) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.click(t + dur * 0.15, 1200, 0.3);
    this.click(t + dur * 0.55, 1600, 0.35);
    this.click(t + dur * 0.85, 2200, 0.3);
  }

  step(pos, vol = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, vol);
    this.noise(d, t, 0.09, { f: 500 + Math.random() * 300, f2: 150, vol: 0.8 });
  }

  land() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(this.out(null, 0.6), t, 0.15, { f: 400, f2: 80, vol: 1 });
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(null, 0.7);
    this.noise(d, t, 0.18, { f: 300, f2: 90, vol: 1 });
    this.tone(d, t, 0.15, { type: 'sawtooth', f: 160, f2: 70, vol: 0.2 });
  }

  headshot(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.9);
    this.tone(d, t, 0.25, { type: 'triangle', f: 1900, f2: 1500, vol: 0.5 });
    this.tone(d, t, 0.2, { type: 'sine', f: 3100, f2: 2600, vol: 0.2 });
  }

  hit() {
    if (!this.ctx) return;
    this.noise(this.out(null, 0.35), this.ctx.currentTime, 0.07, { f: 900, f2: 200, vol: 1 });
  }

  knife(result) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(null, 0.5);
    this.noise(d, t, 0.2, { type: 'bandpass', f: 2200, f2: 700, q: 2, vol: 0.8, attack: 0.03 });
    if (result === 'flesh') this.noise(d, t + 0.05, 0.12, { f: 400, f2: 100, vol: 1.2 });
    if (result === 'wall') this.tone(d, t + 0.04, 0.12, { type: 'triangle', f: 2600, f2: 1800, vol: 0.3 });
  }

  beep(pos) {
    if (!this.ctx) return;
    this.tone(this.out(pos, 0.9), this.ctx.currentTime, 0.1, { type: 'square', f: 2700, vol: 0.25 });
  }

  plantTick() {
    if (!this.ctx) return;
    this.tone(this.out(null, 0.5), this.ctx.currentTime, 0.06, { type: 'square', f: 1100 + Math.random() * 600, vol: 0.2 });
  }

  explosion(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 3);
    this.noise(d, t, 2.6, { f: 1600, f2: 60, vol: 1 });
    this.tone(d, t, 1.8, { f: 70, f2: 22, vol: 1 });
    this.noise(d, t, 0.25, { type: 'highpass', f: 1500, vol: 0.6 });
  }

  // ----- grenades -----

  throw() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.click(t, 2600, 0.2); // pin
    this.noise(this.out(null, 0.4), t + 0.12, 0.18, { type: 'bandpass', f: 1200, f2: 500, q: 1.5, vol: 0.7, attack: 0.04 });
  }

  bounce(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.6);
    this.tone(d, t, 0.08, { type: 'triangle', f: 900 + Math.random() * 400, f2: 500, vol: 0.4 });
    this.noise(d, t, 0.05, { f: 1500, vol: 0.4 });
  }

  heBlast(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 2.2);
    this.noise(d, t, 1.3, { f: 2200, f2: 90, vol: 1 });
    this.tone(d, t, 0.9, { f: 95, f2: 30, vol: 0.9 });
    this.noise(d, t, 0.12, { type: 'highpass', f: 2000, vol: 0.7 });
  }

  flashPop(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 2);
    this.noise(d, t, 0.35, { type: 'highpass', f: 1800, vol: 1 });
    this.tone(d, t, 0.25, { f: 220, f2: 60, vol: 0.6 });
  }

  // Ear ringing after being flashed.
  ring(amount) {
    if (!this.ctx) return;
    this.tone(this.out(null, 0.25 * amount), this.ctx.currentTime, 0.6 + 2.5 * amount, { type: 'sine', f: 3900, f2: 3700, vol: 0.5, attack: 0.05 });
  }

  smokePop(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 1.2);
    this.noise(d, t, 0.15, { f: 600, vol: 0.6 });
    this.noise(d, t + 0.05, 2.8, { type: 'bandpass', f: 3500, f2: 1800, q: 0.6, vol: 0.45, attack: 0.2 });
  }

  pickup() { if (this.ctx) this.click(this.ctx.currentTime, 900, 0.35); }

  buy() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.click(t, 1000, 0.3);
    this.click(t + 0.08, 1500, 0.3);
  }

  // Radio voice lines through the browser's speech synth, for that announcer feel.
  say(text) {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.75;
      u.volume = 0.8;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => /Daniel|Alex|Fred|Google UK English Male/.test(x.name)) || voices.find((x) => x.lang.startsWith('en'));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* speech is optional */
    }
  }
}
