export type FrameSamplerOptions = {
  historySize?: number;
  publishIntervalMs?: number;
};

export class FrameSampler {
  readonly historySize: number;

  private readonly publishIntervalMs: number;
  private readonly frameTimes: number[] = [];
  private readonly sortScratch: number[] = [];
  private lastFrameAt: number | null = null;
  private lastPublishAt = 0;
  private publishedFps = 0;
  private publishedFrameMs = 0;
  private publishedP95FrameMs = 0;
  private publishedWorstFrameMs = 0;
  private publishedDroppedFrames = 0;
  private publishedRevision = 0;
  private isResumingAfterPause = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(options: FrameSamplerOptions = {}) {
    this.historySize = options.historySize ?? 80;
    this.publishIntervalMs = options.publishIntervalMs ?? 200;

    // Owned here rather than by the host: a sampler that has to be told about
    // its own blind spot is one every new consumer forgets to tell.
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") this.noteRenderingResumed();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  // The one interval the sampler refuses, and it refuses it on a fact rather
  // than on the gap's size: rendering that stopped and restarted leaves dead
  // time nobody waited on. Judging that by duration instead would also swallow
  // a genuine multi-second stall, which is the reading that matters most.
  noteRenderingResumed(): void {
    this.isResumingAfterPause = true;
  }

  dispose(): void {
    if (!this.visibilityHandler) return;
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.visibilityHandler = null;
  }

  update(): void {
    const now = performance.now();
    const previous = this.lastFrameAt;
    this.lastFrameAt = now;

    if (this.isResumingAfterPause) {
      this.isResumingAfterPause = false;
      return;
    }

    // An interval needs two frames to exist; the first call has only one.
    if (previous === null) return;

    const frameMs = now - previous;
    if (frameMs <= 0) return;

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > this.historySize) this.frameTimes.shift();

    if (now - this.lastPublishAt < this.publishIntervalMs) return;
    this.lastPublishAt = now;
    this.publish();
  }

  get fps(): number {
    return this.publishedFps;
  }

  get frameMs(): number {
    return this.publishedFrameMs;
  }

  get p95FrameMs(): number {
    return this.publishedP95FrameMs;
  }

  get worstFrameMs(): number {
    return this.publishedWorstFrameMs;
  }

  /** Refreshes missed across the history window, counted against the cadence
   * the client is actually holding. This is what separates a steady 60 from a
   * 60 that hitches: the rate is identical and only this number moves. */
  get droppedFrames(): number {
    return this.publishedDroppedFrames;
  }

  // Bumped once per publish so renderers can skip redrawing a stale graph.
  get revision(): number {
    return this.publishedRevision;
  }

  get frames(): readonly number[] {
    return this.frameTimes;
  }

  private publish(): void {
    const sorted = this.sortScratch;
    sorted.length = 0;
    for (const ms of this.frameTimes) sorted.push(ms);
    sorted.sort((a, b) => a - b);

    // The median, not the mean: a mean lets one stall dictate the reading for
    // the whole window, so the bar reports a slowdown that stopped a second
    // ago and cannot say when it happened. The stall is not lost -- it lands
    // in p95, the worst reading, and the dropped count.
    const median = sorted[sorted.length >> 1];
    if (median <= 0) return;

    this.publishedFrameMs = Math.round(median * 10) / 10;
    this.publishedFps = Math.round(1000 / median);
    this.publishedP95FrameMs =
      Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] * 10) / 10;
    this.publishedWorstFrameMs =
      Math.round(sorted[sorted.length - 1] * 10) / 10;

    let dropped = 0;
    for (const ms of this.frameTimes) {
      const refreshes = Math.round(ms / median);
      if (refreshes > 1) dropped += refreshes - 1;
    }
    this.publishedDroppedFrames = dropped;
    this.publishedRevision += 1;
  }
}
