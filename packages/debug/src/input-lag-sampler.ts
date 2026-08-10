export type InputLagSamplerOptions = {
  historySize?: number;
  publishIntervalMs?: number;
  /** How long a reading stays on the bar once input stops. Past it the sampler
   * reports nothing rather than a number the player is no longer generating. */
  stalenessMs?: number;
  eventTypes?: readonly string[];
};

/** Measures how far behind the player's input the client is running: from the
 * hardware timestamp the browser stamped on an event to the frame that first
 * gets to act on it.
 *
 * This is a floor, not the whole story. The compositor and the display add
 * their own queue after the frame is built, and no API exposes that to a page,
 * so the number here is deliberately named for the span it can actually see. */
export class InputLagSampler {
  private readonly historySize: number;
  private readonly publishIntervalMs: number;
  private readonly stalenessMs: number;
  private readonly eventTypes: readonly string[];
  private readonly samples: number[] = [];
  private readonly sortScratch: number[] = [];
  private readonly listener: (event: Event) => void;

  private pendingInputAt: number | null = null;
  private lastSampleAt = 0;
  private lastPublishAt = 0;
  private publishedMedianMs: number | null = null;
  private publishedP95Ms: number | null = null;

  constructor(options: InputLagSamplerOptions = {}) {
    this.historySize = options.historySize ?? 60;
    this.publishIntervalMs = options.publishIntervalMs ?? 200;
    this.stalenessMs = options.stalenessMs ?? 1000;
    this.eventTypes = options.eventTypes ?? [
      "pointermove",
      "pointerdown",
      "keydown",
    ];

    this.listener = (event: Event) => {
      // Oldest wins: within one frame the earliest unserved input is the one
      // that has been waiting longest, and that wait is the honest reading.
      if (this.pendingInputAt === null) this.pendingInputAt = event.timeStamp;
    };

    if (typeof window !== "undefined") {
      for (const type of this.eventTypes) {
        window.addEventListener(type, this.listener, {
          capture: true,
          passive: true,
        });
      }
    }
  }

  sample(): void {
    const now = performance.now();

    if (this.pendingInputAt !== null) {
      this.samples.push(now - this.pendingInputAt);
      if (this.samples.length > this.historySize) this.samples.shift();
      this.pendingInputAt = null;
      this.lastSampleAt = now;
    }

    if (now - this.lastPublishAt < this.publishIntervalMs) return;
    this.lastPublishAt = now;

    if (
      this.samples.length === 0 ||
      now - this.lastSampleAt > this.stalenessMs
    ) {
      this.samples.length = 0;
      this.publishedMedianMs = null;
      this.publishedP95Ms = null;
      return;
    }

    const sorted = this.sortScratch;
    sorted.length = 0;
    for (const ms of this.samples) sorted.push(ms);
    sorted.sort((a, b) => a - b);

    this.publishedMedianMs = Math.round(sorted[sorted.length >> 1] * 10) / 10;
    this.publishedP95Ms =
      Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] * 10) / 10;
  }

  /** Null when the player has not moved or typed recently -- there is nothing
   * to measure, which is a different statement from "zero lag". */
  get medianMs(): number | null {
    return this.publishedMedianMs;
  }

  get p95Ms(): number | null {
    return this.publishedP95Ms;
  }

  dispose(): void {
    if (typeof window === "undefined") return;
    for (const type of this.eventTypes) {
      window.removeEventListener(type, this.listener, { capture: true });
    }
  }
}
