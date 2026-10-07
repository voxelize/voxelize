// Background music, composed at runtime: short calm pieces from a seeded
// generator (a scale and a tempo per mood, a slow melody over held chords),
// played with soft Web Audio voices and a gentle echo, then minutes of
// silence before the next. No recordings, so every note is ours.

export type Mood = "day" | "night" | "underworld" | "sky";

export type Note = { at: number; midi: number; length: number; velocity: number; voice: "lead" | "pad" };
export type Piece = { mood: Mood; seconds: number; notes: Note[] };

/** Scale steps and root per mood: bright, hushed, dark, airy. */
const MOODS: Record<Mood, { root: number; scale: number[]; beat: number }> = {
  day: { root: 60, scale: [0, 2, 4, 7, 9], beat: 0.75 },
  night: { root: 57, scale: [0, 3, 5, 7, 10], beat: 1.0 },
  underworld: { root: 50, scale: [0, 1, 5, 7, 8], beat: 1.2 },
  sky: { root: 64, scale: [0, 2, 4, 6, 9], beat: 0.85 },
};

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

/** The mood for where the player is and the time of day (0..1, 0.25 sunrise). */
export function moodFor(dimension: string, dayFraction: number): Mood {
  if (dimension === "underworld") return "underworld";
  if (dimension === "sky") return "sky";
  const t = ((dayFraction % 1) + 1) % 1;
  return t > 0.22 && t < 0.78 ? "day" : "night";
}

/**
 * One piece: four phrases of eight beats, a melody that steps through the
 * mood's scale (mostly by neighbours, sometimes a leap, ending on the root)
 * over a held chord per phrase.
 */
export function compose(seed: number, mood: Mood): Piece {
  const { root, scale, beat } = MOODS[mood];
  const random = rng(seed);
  const notes: Note[] = [];
  const pitch = (degree: number) => {
    const octave = Math.floor(degree / scale.length);
    const step = ((degree % scale.length) + scale.length) % scale.length;
    return root + 12 * octave + scale[step];
  };
  let degree = scale.length; // start an octave up
  const phrases = 4;
  const chords = [0, 3, 1, 4].map((d) => (d + Math.floor(random() * 2)) % scale.length);
  for (let p = 0; p < phrases; p++) {
    const start = p * 8 * beat;
    const chord = chords[p];
    for (const d of [0, 2]) notes.push({ at: start, midi: pitch(chord + d) - 12, length: 8 * beat, velocity: 0.22, voice: "pad" });
    let t = 0;
    while (t < 8) {
      const last = p === phrases - 1 && t >= 6;
      const length = last ? 8 - t : random() < 0.3 ? 2 : 1;
      if (last) degree = scale.length;
      else if (random() < 0.15) degree += random() < 0.5 ? -2 : 2;
      else degree += random() < 0.5 ? -1 : 1;
      degree = Math.max(1, Math.min(scale.length * 2, degree));
      if (random() > 0.18 || last) {
        notes.push({ at: start + t * beat, midi: pitch(degree), length: length * beat * 0.95, velocity: 0.3 + random() * 0.15, voice: "lead" });
      }
      t += length;
    }
  }
  return { mood, seconds: phrases * 8 * beat + 3, notes };
}

/** Seconds of silence between pieces: 1.5 to 4 minutes. */
export function pauseAfter(random: () => number): number {
  return 90 + random() * 150;
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private volume = 0.4;
  private mood: Mood = "day";
  private timer: number | undefined;
  private playing = false;
  private random = rng(Date.now());

  setVolume(v: number) {
    this.volume = v;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.3);
    if (v > 0 && this.ctx && !this.playing && this.timer === undefined) this.schedule(5);
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  /** Start after a user gesture (browsers keep audio off until one). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume * 0.5;
    // A soft echo: the dry signal plus a filtered, fading repeat.
    const delay = this.ctx.createDelay(2);
    delay.delayTime.value = 0.45;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.3;
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1800;
    this.out.connect(this.ctx.destination);
    this.out.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(this.ctx.destination);
    this.schedule(8);
  }

  stop() {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    void this.ctx?.suspend();
  }

  private schedule(seconds: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.play();
    }, seconds * 1000);
  }

  private play() {
    if (!this.ctx || !this.out) return;
    if (this.volume <= 0 || document.hidden) return this.schedule(30);
    const piece = compose(Math.floor(this.random() * 2 ** 31), this.mood);
    const t0 = this.ctx.currentTime + 0.2;
    for (const n of piece.notes) this.voice(n, t0);
    this.playing = true;
    this.schedule(piece.seconds + pauseAfter(this.random));
    window.setTimeout(() => (this.playing = false), piece.seconds * 1000);
  }

  private voice(n: Note, t0: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = n.voice === "pad" ? "triangle" : "sine";
    osc.frequency.value = frequency(n.midi);
    const env = ctx.createGain();
    const start = t0 + n.at;
    const attack = n.voice === "pad" ? 1.2 : 0.04;
    const end = start + n.length;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(n.velocity, start + attack);
    env.gain.setTargetAtTime(0, Math.max(start + attack, end - (n.voice === "pad" ? 1.5 : 0.3)), n.voice === "pad" ? 0.6 : 0.25);
    osc.connect(env).connect(this.out!);
    osc.start(start);
    osc.stop(end + 3);
  }
}
