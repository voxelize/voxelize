// Original sound effects, synthesised at runtime with Web Audio: filtered
// noise for digging, steps and eating, short tones for hits and pickups.
// No sample files, so every sound is ours.

export type Sound = "dig" | "break" | "place" | "step" | "hit" | "hurt" | "pickup" | "eat" | "craft" | "click";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Browsers start audio only after a user gesture. */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return this.ctx;
  }

  private burst(duration: number, frequency: number, q: number, gain: number, type: BiquadFilterType = "bandpass") {
    const ctx = this.ensure();
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency * (0.9 + Math.random() * 0.2);
    filter.Q.value = q;
    const env = ctx.createGain();
    const t = ctx.currentTime;
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration);
  }

  private tone(frequency: number, duration: number, gain: number, type: OscillatorType = "sine", slide = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * slide, t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  /** `material` shapes digging and placing sounds (rock rings higher). */
  play(sound: Sound, material = "soil") {
    const pitch = material === "rock" || material === "crystal" ? 1800 : material === "wood" ? 900 : material === "glass" ? 3000 : 500;
    switch (sound) {
      case "dig":
        return this.burst(0.08, pitch, 2, 0.25);
      case "break":
        this.burst(0.22, pitch, 1.2, 0.5);
        return this.burst(0.12, pitch * 0.5, 1, 0.3);
      case "place":
        return this.burst(0.12, pitch * 0.6, 1.5, 0.45);
      case "step":
        return this.burst(0.07, pitch * 0.7, 1, 0.12, "lowpass");
      case "hit":
        this.burst(0.1, 700, 3, 0.4);
        return this.tone(220, 0.12, 0.2, "square", 0.6);
      case "hurt":
        return this.tone(180, 0.25, 0.35, "sawtooth", 0.5);
      case "pickup":
        this.tone(660, 0.06, 0.2, "triangle", 1.3);
        return setTimeout(() => this.tone(990, 0.08, 0.18, "triangle", 1.2), 50) && undefined;
      case "eat":
        for (let i = 0; i < 3; i++) setTimeout(() => this.burst(0.06, 1200, 4, 0.2), i * 90);
        return;
      case "craft":
        return this.tone(520, 0.1, 0.15, "triangle", 1.5);
      case "click":
        return this.tone(880, 0.03, 0.08, "square");
    }
  }
}
