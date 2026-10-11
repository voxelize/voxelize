// Paradise's soundscape, composed in the browser like the music: a soft
// sustained chord that breathes, a murmuring stream, wind chimes that ring
// now and then, and birdsong. Quiet, with no recordings.

/** mulberry32: small, seeded, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chime notes: a high major pentatonic, so any two ring well together. */
export const CHIME_NOTES = [84, 86, 88, 91, 93, 96];

/** The next chime: when (seconds from now) and which note (MIDI). */
export function nextChime(random: () => number): { after: number; midi: number; strength: number } {
  return {
    after: 2.5 + random() * 6,
    midi: CHIME_NOTES[Math.floor(random() * CHIME_NOTES.length)],
    strength: 0.25 + random() * 0.35,
  };
}

/** A bird's phrase: a few quick chirps sweeping between two pitches. */
export function birdPhrase(random: () => number): { after: number; chirps: { at: number; from: number; to: number; length: number }[] } {
  const base = 2200 + random() * 1800;
  const count = 2 + Math.floor(random() * 4);
  const chirps = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const length = 0.05 + random() * 0.08;
    const up = random() < 0.6;
    chirps.push({ at, from: up ? base : base * 1.5, to: up ? base * 1.5 : base, length });
    at += length + 0.04 + random() * 0.08;
  }
  return { after: 4 + random() * 10, chirps };
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class ParadiseAmbience {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private volume = 0.4;
  private timers: number[] = [];
  private random = rng(Date.now());

  setVolume(v: number) {
    this.volume = v;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.5);
  }

  /** Start after a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 0.35;
    this.out.connect(ctx.destination);
    this.pad();
    this.stream();
    this.chimes();
    this.birds();
  }

  stop() {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    void this.ctx?.suspend();
  }

  private later(seconds: number, run: () => void) {
    this.timers.push(window.setTimeout(run, seconds * 1000));
  }

  /** A soft F-major-seventh chord whose loudness breathes slowly. */
  private pad() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 0.03;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    for (const midi of [53, 57, 60, 64]) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = frequency(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start();
      }
    }
    filter.connect(gain).connect(this.out!);
  }

  /** Filtered noise, gently swelling: the rivers of honey and wine. */
  private stream() {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 700;
    band.Q.value = 0.8;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.11;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 250;
    swell.connect(swellDepth).connect(band.frequency);
    swell.start();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(band).connect(gain).connect(this.out!);
    src.start();
  }

  private chimes() {
    const { after, midi, strength } = nextChime(this.random);
    this.later(after, () => {
      const ctx = this.ctx;
      if (ctx && !document.hidden) {
        const t = ctx.currentTime;
        // A bell: a fundamental and two inharmonic partials, dying away.
        for (const [ratio, level] of [[1, 1], [2.76, 0.4], [5.4, 0.15]] as const) {
          const osc = ctx.createOscillator();
          osc.frequency.value = frequency(midi) * ratio;
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.0001, t);
          env.gain.exponentialRampToValueAtTime(0.12 * strength * level, t + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 / ratio);
          osc.connect(env).connect(this.out!);
          osc.start(t);
          osc.stop(t + 4);
        }
      }
      this.chimes();
    });
  }

  private birds() {
    const { after, chirps } = birdPhrase(this.random);
    this.later(after, () => {
      const ctx = this.ctx;
      if (ctx && !document.hidden) {
        const t0 = ctx.currentTime;
        for (const c of chirps) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(c.from, t0 + c.at);
          osc.frequency.exponentialRampToValueAtTime(c.to, t0 + c.at + c.length);
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.0001, t0 + c.at);
          env.gain.exponentialRampToValueAtTime(0.05, t0 + c.at + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0001, t0 + c.at + c.length);
          osc.connect(env).connect(this.out!);
          osc.start(t0 + c.at);
          osc.stop(t0 + c.at + c.length + 0.05);
        }
      }
      this.birds();
    });
  }
}
