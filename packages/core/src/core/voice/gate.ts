/** How the microphone decides when to send. */
export type VoiceActivation = "push-to-talk" | "open-mic";

export type VoiceGateOptions = {
  activation: VoiceActivation;

  /**
   * Open mic only: the level (0..1, see `levelFromRms`) a frame must reach
   * to open the gate.
   */
  threshold: number;

  /**
   * Open mic only: how long the gate stays open after the last frame over
   * the threshold. Speech dips under any threshold between words; without
   * this the end of every word is cut.
   */
  holdMs: number;

  /**
   * Push-to-talk only: how long the gate stays open after the key comes
   * up. A finger leaves the key a little before the last syllable ends.
   */
  releaseMs: number;
};

export const DEFAULT_VOICE_GATE: VoiceGateOptions = {
  activation: "push-to-talk",
  // About -39 dBFS: over a quiet room, under a normal speaking voice.
  threshold: 0.35,
  holdMs: 400,
  releaseMs: 150,
};

/**
 * Once open, the level has to fall this far under the threshold to count as
 * silence, so a voice hovering at the threshold does not chatter the gate.
 */
const HYSTERESIS = 0.04;

export type VoiceGateStep = {
  /** Whether this frame is sent. */
  isOpen: boolean;
  /** The gate opened on this frame: an utterance starts. */
  didOpen: boolean;
  /** The gate closed on this frame: the previous frame was the last. */
  didClose: boolean;
};

/**
 * Decides, one captured frame at a time, whether the microphone is sending.
 * Pure: it is told the frame's level and the time, and keeps no clock.
 */
export class VoiceGate {
  options: VoiceGateOptions;

  /** A closed switch in front of everything: nothing passes while muted. */
  isMuted = false;

  /** Whether the talk key is down (push-to-talk). */
  isKeyHeld = false;

  /** Open whatever the level or the key says (the microphone test). */
  isForcedOpen = false;

  private isOpen = false;

  private lastLoudAt = Number.NEGATIVE_INFINITY;

  private keyReleasedAt = Number.NEGATIVE_INFINITY;

  private wasKeyHeld = false;

  constructor(options: Partial<VoiceGateOptions> = {}) {
    this.options = { ...DEFAULT_VOICE_GATE, ...options };
  }

  get isSending() {
    return this.isOpen;
  }

  /** Take one frame's `level` (0..1) captured at `nowMs`. */
  step(level: number, nowMs: number): VoiceGateStep {
    const wasOpen = this.isOpen;
    this.isOpen = this.wantsOpen(level, nowMs);
    return {
      isOpen: this.isOpen,
      didOpen: this.isOpen && !wasOpen,
      didClose: !this.isOpen && wasOpen,
    };
  }

  /** Close at once, forgetting any tail still running. */
  reset() {
    this.isOpen = false;
    this.lastLoudAt = Number.NEGATIVE_INFINITY;
    this.keyReleasedAt = Number.NEGATIVE_INFINITY;
    this.wasKeyHeld = false;
  }

  private wantsOpen(level: number, nowMs: number): boolean {
    if (this.isMuted) {
      this.wasKeyHeld = this.isKeyHeld;
      return false;
    }
    if (this.isForcedOpen) return true;
    const { activation, threshold, holdMs, releaseMs } = this.options;

    if (activation === "push-to-talk") {
      if (this.wasKeyHeld && !this.isKeyHeld) this.keyReleasedAt = nowMs;
      this.wasKeyHeld = this.isKeyHeld;
      return this.isKeyHeld || nowMs - this.keyReleasedAt < releaseMs;
    }

    const bar = this.isOpen ? threshold - HYSTERESIS : threshold;
    if (level >= bar) {
      this.lastLoudAt = nowMs;
      return true;
    }
    return nowMs - this.lastLoudAt < holdMs;
  }
}
