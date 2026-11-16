// Tigtog music engine (Web Audio, no samples): Ethiopian/Eritrean pentatonic
// scales (ቅኝት), 6/8 and 4/4 dance rhythms, synthesized krar / masinko /
// washint melody voices, kebero drums, shaker, clap and a bass line.

/** Semitone offsets of each qenet, from the root. */
export const SCALES = {
  tizitaMajor: [0, 2, 4, 7, 9],
  tizitaMinor: [0, 2, 3, 7, 8],
  batiMajor: [0, 4, 5, 7, 11],
  batiMinor: [0, 3, 5, 7, 10],
  ambassel: [0, 1, 5, 7, 8],
  anchihoye: [0, 1, 5, 6, 9],
};

/**
 * Rhythms. A bar has `stepsPerBar` sixteenth-ish steps; `bpm` counts beats of
 * `stepsPerBeat` steps (a dotted quarter in 6/8, a quarter in 4/4).
 * Drum patterns list the steps (within one bar) where each sound hits.
 */
export const RHYTHMS = {
  guayla: { stepsPerBar: 12, stepsPerBeat: 6, bpm: 100, low: [0, 6], high: [3, 5, 9, 11], shaker: [0, 2, 4, 6, 8, 10], clap: [3, 9] },
  eskista: { stepsPerBar: 12, stepsPerBeat: 6, bpm: 112, low: [0, 7], high: [3, 6, 9, 10], shaker: [0, 2, 4, 6, 8, 10], clap: [6] },
  chikchika: { stepsPerBar: 12, stepsPerBeat: 6, bpm: 126, low: [0, 6], high: [2, 3, 8, 9], shaker: [0, 1, 2, 4, 6, 7, 8, 10], clap: [3, 9] },
  ballad: { stepsPerBar: 16, stepsPerBeat: 4, bpm: 72, low: [0, 10], high: [4, 12], shaker: [0, 2, 4, 6, 8, 10, 12, 14], clap: [] },
};

// masinko = Amharic ማሲንቆ / Tigrinya ጭራ-ዋጣ (ዋጣ); washint = ዋሽንት / ሸምበቆ.
export const INSTRUMENTS = ["krar", "masinko", "washint", "embilta"];

/** Melody grid shape: 2 bars, one column per 2 steps, 10 rows (2 octaves). */
export const ROWS = 10;
export const BARS_IN_LOOP = 2;
export const columnsFor = (rhythm) => (RHYTHMS[rhythm].stepsPerBar * BARS_IN_LOOP) / 2;

const ROOT_MIDI = 57; // A3
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function rowToMidi(scale, row) {
  const s = SCALES[scale];
  return ROOT_MIDI + 12 * Math.floor(row / s.length) + s[row % s.length];
}

/** A pleasant random melody: a stepwise walk that lands on the root at the end. */
export function generateMelody(rhythm, rand = Math.random) {
  const cols = columnsFor(rhythm);
  const perBar = cols / BARS_IN_LOOP;
  const beat = RHYTHMS[rhythm].stepsPerBeat / 2; // columns per beat
  const notes = new Set();
  let row = 5 + Math.floor(rand() * 3) - 1;
  for (let c = 0; c < cols; c++) {
    const onBeat = c % beat === 0;
    const last = c === cols - 1 || c === cols - 2;
    if (!onBeat && rand() < 0.45) continue;
    if (last) { if (c === cols - 2) notes.add(`${rand() < 0.5 ? 5 : 0}:${c}`); continue; }
    const leap = rand() < 0.15 ? (rand() < 0.5 ? -3 : 3) : Math.floor(rand() * 3) - 1;
    row = Math.max(0, Math.min(ROWS - 1, row + leap));
    if (c % perBar === 0 && rand() < 0.5) row = rand() < 0.5 ? 5 : 2; // anchor phrase starts
    notes.add(`${row}:${c}`);
  }
  return notes;
}

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.scale = "tizitaMajor";
    this.rhythm = "guayla";
    this.instrument = "krar";
    this.bpm = RHYTHMS.guayla.bpm;
    this.notes = generateMelody("guayla");
    this.playing = false;
    this.onStep = null; // (column) => void, for the UI playhead
    this._timer = null;
  }

  /** Create the audio graph (must be called from a user gesture). */
  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // Everything audible also goes to the recorder and analyser.
    this.recordDest = ctx.createMediaStreamDestination();
    comp.connect(this.recordDest);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    comp.connect(this.analyser);
    this.reverb = this._makeReverb();
    this.reverb.connect(this.master);
    this._noise = this._makeNoise();
    return ctx;
  }

  get stepDur() {
    return 60 / this.bpm / RHYTHMS[this.rhythm].stepsPerBeat;
  }
  get barDur() {
    return this.stepDur * RHYTHMS[this.rhythm].stepsPerBar;
  }

  /** Current bar and fraction through it, relative to the last start(). */
  position() {
    if (!this.playing || !this.ctx) return { bar: 0, frac: 0, time: 0 };
    const time = Math.max(0, this.ctx.currentTime - this.startTime);
    const bars = time / this.barDur;
    return { bar: Math.floor(bars), frac: bars % 1, time };
  }

  async start() {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.stop();
    this.playing = true;
    this.step = 0;
    this.startTime = ctx.currentTime + 0.08;
    this.nextTime = this.startTime;
    const tick = () => {
      while (this.nextTime < ctx.currentTime + 0.12) {
        this._scheduleStep(this.step, this.nextTime);
        this.nextTime += this.stepDur;
        this.step++;
      }
    };
    tick();
    this._timer = setInterval(tick, 25);
  }

  stop() {
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
  }

  _scheduleStep(step, time) {
    const r = RHYTHMS[this.rhythm];
    const inBar = step % r.stepsPerBar;
    const loopStep = step % (r.stepsPerBar * BARS_IN_LOOP);

    if (r.low.includes(inBar)) this._lowKebero(time);
    if (r.high.includes(inBar)) this._highKebero(time);
    if (r.shaker.includes(inBar)) this._shaker(time, inBar % r.stepsPerBeat === 0 ? 0.12 : 0.06);
    if (r.clap.includes(inBar)) this._clap(time);

    // Bass: root on the downbeat, fifth on the second beat.
    if (inBar === 0) this._bass(ROOT_MIDI - 24, time, this.stepDur * r.stepsPerBeat * 0.9);
    if (inBar === r.stepsPerBar / 2) this._bass(ROOT_MIDI - 17, time, this.stepDur * r.stepsPerBeat * 0.8);

    if (loopStep % 2 === 0) {
      const col = loopStep / 2;
      const cols = columnsFor(this.rhythm);
      for (const key of this.notes) {
        const [row, c] = key.split(":").map(Number);
        if (c !== col) continue;
        // Hold until the next column that has a note (max 3 columns).
        let len = 1;
        while (len < 3 && ![...Array(ROWS).keys()].some((rr) => this.notes.has(`${rr}:${(col + len) % cols}`))) len++;
        this._melody(rowToMidi(this.scale, row), time, len * 2 * this.stepDur);
      }
      if (this.onStep) {
        const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
        setTimeout(() => this.playing && this.onStep?.(col), delay);
      }
    }
  }

  // ------------------------------------------------------------ voices
  _env(time, attack, peak, decay, sustainUntil) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + attack);
    if (sustainUntil) {
      g.gain.setValueAtTime(peak, sustainUntil);
      g.gain.exponentialRampToValueAtTime(0.0001, sustainUntil + decay);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    }
    return g;
  }

  _osc(type, freq, time, stopAt, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.connect(dest);
    o.start(time);
    o.stop(stopAt);
    return o;
  }

  _vibrato(osc, time, stopAt, rate, depthHz) {
    const lfo = this.ctx.createOscillator();
    const amt = this.ctx.createGain();
    lfo.frequency.value = rate;
    amt.gain.setValueAtTime(0, time);
    amt.gain.linearRampToValueAtTime(depthHz, time + 0.25);
    lfo.connect(amt);
    amt.connect(osc.frequency);
    lfo.start(time);
    lfo.stop(stopAt);
  }

  _melody(midi, time, dur) {
    const f = midiToHz(midi + 12);
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    out.connect(send);
    send.connect(this.reverb);

    if (this.instrument === "krar") {
      // Plucked lyre: bright attack, filter closes quickly.
      const g = this._env(time, 0.004, 0.32, Math.min(1.2, dur + 0.5));
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(4200, time);
      lp.frequency.exponentialRampToValueAtTime(700, time + 0.35);
      lp.connect(g);
      g.connect(out);
      const end = time + dur + 0.7;
      this._osc("sawtooth", f, time, end, lp);
      const o2 = this._osc("triangle", f * 2.003, time, end, lp);
      o2.detune.value = 4;
    } else if (this.instrument === "masinko") {
      // Bowed one-string fiddle: slow attack, nasal band, wide vibrato.
      const end = time + dur;
      const g = this._env(time, 0.06, 0.22, 0.12, end);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400;
      bp.Q.value = 0.9;
      bp.connect(g);
      g.connect(out);
      const o = this._osc("sawtooth", f, time, end + 0.15, bp);
      this._vibrato(o, time, end + 0.15, 6, f * 0.012);
      // Slight scoop into the note.
      o.frequency.setValueAtTime(f * 0.97, time);
      o.frequency.exponentialRampToValueAtTime(f, time + 0.08);
    } else if (this.instrument === "embilta") {
      // Embilta (እምብልታ): end-blown horn. Brassy swell, the filter opens
      // as the note blooms, slight pitch rise at the start.
      const end = time + dur;
      const g = this._env(time, 0.035, 0.2, 0.12, end);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(500, time);
      lp.frequency.exponentialRampToValueAtTime(2400, time + 0.09);
      lp.frequency.exponentialRampToValueAtTime(1500, end + 0.1);
      lp.connect(g);
      g.connect(out);
      const fb = f / 2; // horns sit an octave lower
      const o = this._osc("sawtooth", fb * 0.985, time, end + 0.15, lp);
      o.frequency.exponentialRampToValueAtTime(fb, time + 0.06);
      const sq = ctx.createGain();
      sq.gain.value = 0.35;
      sq.connect(lp);
      this._osc("square", fb * 1.002, time, end + 0.15, sq);
      this._noiseBurst(time, 0.05, 0.05, "bandpass", fb * 4, 2).connect(out);
    } else {
      // Washint / shambeqo (end-blown flute): pure tone + breath noise.
      const end = time + dur;
      const g = this._env(time, 0.05, 0.28, 0.1, end);
      g.connect(out);
      const o = this._osc("sine", f, time, end + 0.12, g);
      this._vibrato(o, time, end + 0.12, 5, f * 0.008);
      const h = ctx.createGain();
      h.gain.value = 0.12;
      h.connect(g);
      this._osc("triangle", f * 2, time, end + 0.12, h);
      const breath = this._noiseBurst(time, dur, 0.05, "bandpass", f * 2, 1);
      breath.connect(out);
    }
  }

  _bass(midi, time, dur) {
    const g = this._env(time, 0.01, 0.35, 0.15, time + dur);
    g.connect(this.master);
    this._osc("sine", midiToHz(midi), time, time + dur + 0.2, g);
    const g2 = this._env(time, 0.01, 0.06, 0.1, time + dur);
    g2.connect(this.master);
    this._osc("triangle", midiToHz(midi + 12), time, time + dur + 0.2, g2);
  }

  _lowKebero(time) {
    const g = this._env(time, 0.002, 0.9, 0.38);
    g.connect(this.master);
    const o = this._osc("sine", 150, time, time + 0.45, g);
    o.frequency.exponentialRampToValueAtTime(52, time + 0.3);
    this._noiseBurst(time, 0.02, 0.25, "lowpass", 1200, 0.7).connect(this.master);
  }

  _highKebero(time) {
    const g = this._env(time, 0.002, 0.45, 0.13);
    g.connect(this.master);
    const o = this._osc("sine", 320, time, time + 0.16, g);
    o.frequency.exponentialRampToValueAtTime(190, time + 0.1);
    this._noiseBurst(time, 0.03, 0.22, "bandpass", 2500, 1.2).connect(this.master);
  }

  _shaker(time, level) {
    this._noiseBurst(time, 0.045, level, "highpass", 7000, 0.7).connect(this.master);
  }

  _clap(time) {
    for (const d of [0, 0.012, 0.024]) {
      this._noiseBurst(time + d, 0.06, 0.28, "bandpass", 1600, 1.1).connect(this.master);
    }
  }

  _noiseBurst(time, dur, level, type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this._env(time, 0.002, level, dur);
    src.connect(f);
    f.connect(g);
    src.start(time, Math.random() * 0.5);
    src.stop(time + dur + 0.05);
    return g;
  }

  _makeNoise() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeReverb() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.6);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }
}
