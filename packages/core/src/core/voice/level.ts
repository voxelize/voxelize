/** The quietest sound a level tells apart from silence, in dBFS. */
export const VOICE_LEVEL_FLOOR_DB = -60;

/** Root mean square of a block of samples in -1..1. */
export function rms(samples: ArrayLike<number>): number {
  const count = samples.length;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const sample = samples[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

/**
 * A loudness in 0..1 from an RMS amplitude: 0 at {@link VOICE_LEVEL_FLOOR_DB}
 * and below, 1 at full scale, linear in decibels between. Decibels are how
 * loudness is heard, so a meter and a threshold drawn on this scale move
 * evenly from a whisper to a shout.
 */
export function levelFromRms(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.min(1, Math.max(0, 1 - db / VOICE_LEVEL_FLOOR_DB));
}

/** The dBFS a level in 0..1 stands for. */
export function levelToDb(level: number): number {
  return VOICE_LEVEL_FLOOR_DB * (1 - Math.min(1, Math.max(0, level)));
}

/**
 * A level that rises at once and falls slowly, the way a meter reads: a
 * syllable shows the moment it is spoken and the bar does not flicker to
 * zero between two of them.
 */
export class VoiceLevelMeter {
  /** The current reading, 0..1. */
  value = 0;

  /**
   * @param releasePerSecond How much of the scale the reading may fall in a
   * second.
   */
  constructor(private releasePerSecond = 2.5) {}

  /** Take a new level measured `elapsedMs` after the previous one. */
  push(level: number, elapsedMs: number): number {
    const floor = this.value - (this.releasePerSecond * elapsedMs) / 1000;
    this.value = Math.min(1, Math.max(0, level, floor));
    return this.value;
  }

  /** Let the reading fall for `elapsedMs` with nothing new measured. */
  decay(elapsedMs: number): number {
    return this.push(0, elapsedMs);
  }

  reset() {
    this.value = 0;
  }
}
