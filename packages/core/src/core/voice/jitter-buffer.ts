/** One frame handed back by the buffer, in the order it was spoken. */
export type OrderedVoiceFrame<T> = {
  seq: number;
  frame: T;
  /** How many frames before this one never arrived. */
  lostBefore: number;
};

export type VoiceJitterBufferOptions = {
  /**
   * How long a frame waits for a missing one before it to turn up. The
   * unreliable lane reorders by a packet or two; past this the missing
   * frame is counted lost and playback moves on.
   */
  maxHoldMs: number;

  /** Past this many waiting frames the oldest gap is given up at once. */
  maxFrames: number;

  /**
   * A frame this far from the one expected is not late or early: its
   * speaker started counting again (a reload, a new microphone).
   */
  resetDistance: number;
};

export const DEFAULT_VOICE_JITTER: VoiceJitterBufferOptions = {
  maxHoldMs: 60,
  maxFrames: 24,
  resetDistance: 1000,
};

const SEQ_MODULO = 2 ** 32;

/** `a - b` on the u32 circle, in -2^31..2^31. */
const seqDelta = (a: number, b: number): number => {
  const delta = (a - b) % SEQ_MODULO;
  if (delta >= SEQ_MODULO / 2) return delta - SEQ_MODULO;
  if (delta < -SEQ_MODULO / 2) return delta + SEQ_MODULO;
  return delta;
};

/**
 * Puts one speaker's frames back in the order they were spoken.
 *
 * Voice arrives on a lane that may drop, repeat or reorder packets. Each
 * frame carries its speaker's counter; this holds a frame that arrived
 * ahead of a missing one for a moment, releases everything in order, drops
 * what arrives after its turn has passed, and says how many frames each
 * gap lost so playback can leave the right amount of silence.
 */
export class VoiceJitterBuffer<T> {
  /** Frames dropped because they arrived after their place was played. */
  lateFrames = 0;

  /** Frames that never arrived in time. */
  lostFrames = 0;

  private options: VoiceJitterBufferOptions;

  private held = new Map<number, { frame: T; arrivedAt: number }>();

  private expected: number | null = null;

  constructor(options: Partial<VoiceJitterBufferOptions> = {}) {
    this.options = { ...DEFAULT_VOICE_JITTER, ...options };
  }

  get size() {
    return this.held.size;
  }

  /** Take a frame that arrived at `nowMs`. */
  push(seq: number, frame: T, nowMs: number) {
    if (this.expected !== null) {
      const ahead = seqDelta(seq, this.expected);
      if (Math.abs(ahead) >= this.options.resetDistance) {
        this.reset();
      } else if (ahead < 0) {
        this.lateFrames += 1;
        return;
      }
    }
    if (this.expected === null) this.expected = seq;
    if (this.held.has(seq)) return;
    this.held.set(seq, { frame, arrivedAt: nowMs });
  }

  /** Every frame whose turn has come by `nowMs`, in order. */
  drain(nowMs: number): OrderedVoiceFrame<T>[] {
    const out: OrderedVoiceFrame<T>[] = [];
    if (this.expected === null) return out;
    let lostBefore = 0;
    while (this.held.size > 0) {
      const next = this.held.get(this.expected);
      if (next) {
        this.held.delete(this.expected);
        out.push({ seq: this.expected, frame: next.frame, lostBefore });
        lostBefore = 0;
        this.expected = (this.expected + 1) % SEQ_MODULO;
        continue;
      }
      // The expected frame is missing. Wait for it only while the oldest
      // frame behind the gap is young and the pile is small.
      let nearest = 0;
      let nearestAhead = Number.POSITIVE_INFINITY;
      let oldestArrival = Number.POSITIVE_INFINITY;
      for (const [seq, held] of this.held) {
        const ahead = seqDelta(seq, this.expected);
        if (ahead < nearestAhead) {
          nearestAhead = ahead;
          nearest = seq;
        }
        if (held.arrivedAt < oldestArrival) oldestArrival = held.arrivedAt;
      }
      const hasWaited = nowMs - oldestArrival >= this.options.maxHoldMs;
      if (!hasWaited && this.held.size <= this.options.maxFrames) break;
      lostBefore += nearestAhead;
      this.lostFrames += nearestAhead;
      this.expected = nearest;
    }
    return out;
  }

  /**
   * Everything still held, in order, gaps or not, leaving the buffer empty:
   * the utterance is over and no missing frame is coming.
   */
  flush(): OrderedVoiceFrame<T>[] {
    const out: OrderedVoiceFrame<T>[] = [];
    if (this.expected !== null) {
      const expected = this.expected;
      const held = Array.from(this.held.entries()).sort(
        ([a], [b]) => seqDelta(a, expected) - seqDelta(b, expected),
      );
      let next = expected;
      for (const [seq, { frame }] of held) {
        const lostBefore = Math.max(0, seqDelta(seq, next));
        this.lostFrames += lostBefore;
        out.push({ seq, frame, lostBefore });
        next = (seq + 1) % SEQ_MODULO;
      }
    }
    this.reset();
    return out;
  }

  /** Forget everything: the next frame pushed starts a new stream. */
  reset() {
    this.held.clear();
    this.expected = null;
  }
}
