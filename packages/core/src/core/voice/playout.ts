export type VoicePlayoutOptions = {
  /** The delay a quiet connection settles at, in seconds. */
  minDelay: number;

  /** The delay is never grown past this, in seconds. */
  maxDelay: number;

  /**
   * How far ahead of the clock audio may be queued before a frame is
   * dropped to catch up, in seconds on top of the current delay.
   */
  maxLead: number;

  /** How long without an underrun before the delay is eased down, in seconds. */
  calmBeforeShrink: number;
};

export const DEFAULT_VOICE_PLAYOUT: VoicePlayoutOptions = {
  minDelay: 0.06,
  maxDelay: 0.24,
  maxLead: 0.24,
  calmBeforeShrink: 8,
};

/** A silence this long between frames is a new utterance, not an underrun. */
const UTTERANCE_GAP = 0.3;

/** A gap never leaves more silence than this many frames. */
const MAX_GAP_FRAMES = 3;

/**
 * Decides when each decoded frame of one speaker starts playing.
 *
 * Frames arrive in bursts (the network, a busy main thread) and must leave
 * as an unbroken stream, so each one is queued a short delay ahead of the
 * clock and the next starts exactly where it ends. When the queue runs dry
 * in the middle of an utterance the delay was too short for this
 * connection: it grows, and eases back once things have been calm. When a
 * burst puts the queue too far ahead, frames are dropped until it is back,
 * so a conversation never drifts seconds behind.
 */
export class VoicePlayout {
  /** How many times the queue ran dry mid-utterance. */
  underruns = 0;

  /** Frames dropped to catch up with the clock. */
  droppedFrames = 0;

  private options: VoicePlayoutOptions;

  private delay: number;

  /** When the last queued frame ends; nothing queued before the first. */
  private playhead = Number.NEGATIVE_INFINITY;

  private lastUnderrunAt = Number.NEGATIVE_INFINITY;

  private lastShrinkAt = Number.NEGATIVE_INFINITY;

  constructor(options: Partial<VoicePlayoutOptions> = {}) {
    this.options = { ...DEFAULT_VOICE_PLAYOUT, ...options };
    this.delay = this.options.minDelay;
  }

  /** The delay new utterances currently start with, in seconds. */
  get currentDelay() {
    return this.delay;
  }

  /**
   * When a frame `duration` seconds long that was decoded at clock time
   * `now` should start, or `null` to drop it. `lostBefore` frames were lost
   * ahead of it and leave that much silence.
   */
  schedule(now: number, duration: number, lostBefore = 0): number | null {
    const { minDelay, maxDelay, maxLead, calmBeforeShrink } = this.options;

    if (this.playhead <= now) {
      const silence = now - this.playhead;
      if (silence < UTTERANCE_GAP) {
        // Ran dry between two frames of the same utterance.
        this.underruns += 1;
        this.lastUnderrunAt = now;
        this.lastShrinkAt = now;
        this.delay = Math.min(maxDelay, this.delay * 1.5 + 0.01);
      } else if (
        now - this.lastUnderrunAt >= calmBeforeShrink &&
        now - this.lastShrinkAt >= calmBeforeShrink
      ) {
        this.lastShrinkAt = now;
        this.delay = Math.max(minDelay, this.delay * 0.8);
      }
      this.playhead = now + this.delay;
    } else {
      this.playhead += Math.min(lostBefore, MAX_GAP_FRAMES) * duration;
    }

    if (this.playhead - now > this.delay + maxLead) {
      this.droppedFrames += 1;
      return null;
    }

    const startAt = this.playhead;
    this.playhead += duration;
    return startAt;
  }

  /** Forget the queue: the next frame starts a new utterance. */
  reset() {
    this.playhead = Number.NEGATIVE_INFINITY;
  }
}
